// Payment requests and the full FSM (workflow §5). Every transition runs inside one
// transaction that re-checks status + version, so two clients can never double-process a step.
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { archiveStoredFiles, removeStoredFiles, restoreStoredFiles } from '../files/files';
import {
  ACTION_FROM,
  type ActionKey,
  type Actor,
  type Slot,
  type Status,
  assertSettlement,
  authorize,
  fail,
  missingDocsOf,
  paymentSkipWarning,
  remainingOf,
  requireReason,
  requireTick,
  SLOT_DEF,
  STATUS_STEP,
} from '../common/domain';
import type {
  CreateRequestDto,
  FinanceApproveDto,
  ForceDto,
  PayAdvanceDto,
  PayFinalDto,
  ReasonDto,
  SubmitAdvanceDto,
  SubmitDto,
  TransferDto,
  UpdateRequestDto,
  VersionDto,
} from './requests.dto';

type Tx = Prisma.TransactionClient;

const DETAIL_INCLUDE = {
  project: true,
  category: true,
  requesterName: true,
  vendor: true,
  accountantName: true,
  createdBy: { select: { id: true, fullName: true, username: true, role: true } },
  assignedRequester: { select: { id: true, fullName: true, username: true } },
  assignedAccountant: { select: { id: true, fullName: true, username: true } },
  attachments: { include: { uploadedBy: { select: { id: true, fullName: true } } }, orderBy: { uploadedAt: 'asc' } },
  transactions: { include: { createdBy: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } },
  timeline: { include: { actor: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } },
  comments: {
    include: { author: { select: { id: true, fullName: true, username: true } }, mentions: { include: { user: { select: { id: true, username: true } } } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PaymentRequestInclude;

export type QueueKey =
  | 'overview'
  | 'myRequests'
  | 'leaderApproval'
  | 'coordination'
  | 'financeMonitor'
  | 'advancePayments'
  | 'afterAdvance'
  | 'finalPayments'
  | 'supplementInvoice'
  | 'missingInvoices'
  | 'completed'
  | 'all';

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Row-level scoping per workflow §7. "all" (Tra cứu) is readable by everyone. */
  async list(actor: Actor, queue: QueueKey = 'all') {
    const admin = actor.role === 'ADMIN';
    const mineReq = admin ? {} : { assignedRequesterId: actor.id };
    const mineAcc = admin ? {} : { assignedAccountantId: actor.id };
    let where: Prisma.PaymentRequestWhereInput;

    switch (queue) {
      case 'overview':
        where = { ...mineReq, status: { in: ['DRAFT', 'ADVANCE_PREPARATION'] } };
        break;
      case 'myRequests':
        where = { ...mineReq };
        break;
      case 'leaderApproval':
        if (!admin && actor.role !== 'LEADER') return [];
        where = { status: 'LEADER_APPROVAL' };
        break;
      case 'coordination':
        if (!admin && actor.role !== 'FINANCE_MANAGER') return [];
        where = { status: 'COORDINATION' };
        break;
      case 'financeMonitor':
        if (!admin && actor.role !== 'FINANCE_MANAGER') return [];
        where = { status: { in: ['ADVANCE_PAYMENT', 'AFTER_ADVANCE', 'FINAL_PAYMENT', 'DOCUMENT_SUPPLEMENT_REQUIRED'] } };
        break;
      case 'advancePayments':
        where = { ...mineAcc, status: 'ADVANCE_PAYMENT' };
        break;
      case 'finalPayments':
        where = { ...mineAcc, status: 'FINAL_PAYMENT' };
        break;
      case 'missingInvoices':
        where = { ...mineAcc, status: 'DOCUMENT_SUPPLEMENT_REQUIRED' };
        break;
      case 'afterAdvance':
        where = { ...mineReq, status: 'AFTER_ADVANCE' };
        break;
      case 'supplementInvoice':
        where = { ...mineReq, status: 'DOCUMENT_SUPPLEMENT_REQUIRED' };
        break;
      case 'completed':
        where = { status: 'COMPLETED' };
        break;
      default:
        where = {};
    }

    return this.prisma.paymentRequest.findMany({
      where,
      include: {
        project: { select: { name: true } },
        vendor: { select: { name: true } },
        assignedRequester: { select: { id: true, fullName: true } },
        assignedAccountant: { select: { id: true, fullName: true } },
      },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  /**
   * One round trip with everything the UI keeps in memory. The dataset is small by
   * design (one account per department), so a full snapshot beats N+1 detail calls.
   */
  snapshot() {
    return this.prisma.paymentRequest.findMany({ include: DETAIL_INCLUDE, orderBy: { updatedAt: 'desc' } });
  }

  async detail(id: string) {
    const pr = await this.prisma.paymentRequest.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!pr) fail('ERR_NOT_FOUND', 'Không tìm thấy phiếu');
    return pr;
  }

  // -------------------------------------------------------------------------
  // Create / edit
  // -------------------------------------------------------------------------

  async create(actor: Actor, dto: CreateRequestDto) {
    if (actor.role !== 'REQUESTER' && actor.role !== 'ADMIN') {
      fail('ERR_FORBIDDEN', 'Chỉ nhân viên cung ứng (hoặc Admin) được tạo phiếu');
    }
    if (!(dto.requestedAmount > 0)) fail('ERR_AMOUNT_NOT_POSITIVE', 'Tổng số tiền đề nghị phải lớn hơn 0');

    let assignedRequesterId = actor.id;
    if (actor.role === 'ADMIN') {
      const target = dto.assignedRequesterId
        ? await this.prisma.user.findUnique({ where: { id: dto.assignedRequesterId } })
        : await this.prisma.user.findFirst({ where: { role: 'REQUESTER', status: 'ACTIVE' } });
      if (!target || target.role !== 'REQUESTER' || target.status !== 'ACTIVE') {
        fail('ERR_REQUIRED_FIELD', 'Admin tạo phiếu phải chọn nhân viên cung ứng phụ trách');
      }
      assignedRequesterId = target.id;
    }

    return this.prisma.$transaction(async (tx) => {
      const code = await this.nextCode(tx);
      const pr = await tx.paymentRequest.create({
        data: {
          code,
          status: 'DRAFT',
          createdById: actor.id,
          createdByRole: actor.role,
          assignedRequesterId,
          projectId: dto.projectId,
          categoryId: dto.categoryId,
          requesterNameId: dto.requesterNameId,
          vendorId: dto.vendorId,
          title: dto.title.trim(),
          note: (dto.note ?? '').trim(),
          hasInvoice: dto.hasInvoice ?? true,
          requestedAmount: new Prisma.Decimal(dto.requestedAmount),
          timeline: { create: { action: 'CREATE', toStatus: 'DRAFT', actorId: actor.id } },
        },
      });
      await this.audit(tx, actor.id, 'CREATE', 'payment_request', pr.id, `Tạo phiếu ${pr.code}`);
      return { id: pr.id, code: pr.code, message: `Đã lưu nháp phiếu ${pr.code}` };
    });
  }

  /** PYC-YYYYMM-NNNN, allocated under the row lock of the month counter. */
  private async nextCode(tx: Tx): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Bộ đếm có thể lệch khỏi thực tế: khôi phục một phần từ bản sao lưu, dọn dữ liệu
    // bằng tay, hay nhập lại phiếu cũ. Khi đó mã quay về 0001 và trùng mã đã có, khiến
    // MỌI lần tạo phiếu hỏng với lỗi 500 khó hiểu cho tới khi ai đó sửa bảng đếm.
    // Lấy mã lớn nhất đang có của tháng làm sàn để bộ đếm tự chỉnh lại.
    const highest = await tx.paymentRequest.findFirst({
      where: { code: { startsWith: `PYC-${ym}-` } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    // Mã cố định bề rộng và đệm số 0 nên sắp xếp theo chuỗi trùng với sắp xếp theo số.
    const floor = highest ? Number(highest.code.slice(-4)) || 0 : 0;

    const row = await tx.requestSequence.upsert({
      where: { yearMonth: ym },
      create: { yearMonth: ym, lastValue: floor + 1 },
      update: { lastValue: { increment: 1 } },
    });
    if (row.lastValue > floor) return `PYC-${ym}-${String(row.lastValue).padStart(4, '0')}`;

    const fixed = await tx.requestSequence.update({ where: { yearMonth: ym }, data: { lastValue: floor + 1 } });
    return `PYC-${ym}-${String(fixed.lastValue).padStart(4, '0')}`;
  }

  async update(actor: Actor, id: string, dto: UpdateRequestDto) {
    return this.tx(actor, id, dto.version, 'EDIT_DRAFT', async (tx, pr) => {
      if (!(dto.requestedAmount > 0)) fail('ERR_AMOUNT_NOT_POSITIVE', 'Tổng số tiền đề nghị phải lớn hơn 0');
      await tx.paymentRequest.update({
        where: { id },
        data: {
          projectId: dto.projectId,
          categoryId: dto.categoryId,
          requesterNameId: dto.requesterNameId,
          vendorId: dto.vendorId,
          title: dto.title.trim(),
          note: (dto.note ?? '').trim(),
          hasInvoice: dto.hasInvoice,
          requestedAmount: new Prisma.Decimal(dto.requestedAmount),
          version: { increment: 1 },
        },
      });
      await this.audit(tx, actor.id, 'UPDATE', 'payment_request', id, `Cập nhật thông tin phiếu ${pr.code}`);
      return { message: 'Đã lưu thông tin phiếu' };
    });
  }

  // -------------------------------------------------------------------------
  // Transitions T1 → T13
  // -------------------------------------------------------------------------

  /** T1 — DRAFT → LEADER_APPROVAL. */
  async submit(actor: Actor, id: string, dto: SubmitDto) {
    // Checked before the transaction: a rollback would otherwise discard the Admin alert.
    const leaders = await this.prisma.user.findMany({ where: { role: 'LEADER', status: 'ACTIVE' } });
    if (leaders.length === 0) {
      const found = await this.prisma.paymentRequest.findUnique({ where: { id } });
      await this.alertAdminsNow(
        'Chưa có Lãnh đạo duyệt B2',
        `Phiếu ${found?.code ?? id} không gửi được lên B2 vì không có tài khoản Lãnh đạo đang hoạt động.`,
        id,
      );
      fail('ERR_NO_LEADER', 'Hệ thống chưa có tài khoản Lãnh đạo đang hoạt động để duyệt B2. Đã báo Admin.');
    }
    return this.tx(actor, id, dto.version, 'SUBMIT', async (tx, pr) => {
      requireTick(dto.confirmed, 'Gửi Lãnh đạo');
      await this.requireSlots(tx, id, ['REQUEST_FORM', 'QUOTATION_COMPARISON']);
      await this.move(tx, pr, 'T1', 'LEADER_APPROVAL', actor.id, null);
      await this.notify(tx, leaders.map((l) => l.id), id, 'Phiếu chờ Lãnh đạo duyệt (B2)', `${pr.code} – ${pr.title}${pr.resubmitted ? ' (gửi lại)' : ''}`);
      await this.audit(tx, actor.id, 'T1', 'payment_request', id, `${pr.code}: gửi Lãnh đạo`);
      return { message: 'Đã gửi Lãnh đạo duyệt (B2)' };
    });
  }

  /** T2 — hủy đơn ở B1, không cần lý do (workflow §6.5). */
  /**
   * T2 — hủy ở B1. Phiếu chưa ai duyệt, chưa phát sinh tiền hay trách nhiệm, nên
   * xóa hẳn thay vì để lại bản ghi "Đã hủy" làm rác hàng đợi của NV cung ứng.
   * Nhật ký vẫn giữ để Admin tra được ai đã hủy.
   */
  async cancel(actor: Actor, id: string, dto: VersionDto) {
    // Đọc đường dẫn file trước: cascade xóa sạch hàng attachment, sau transaction
    // không còn cách nào biết file nào thuộc phiếu này.
    const paths = (
      await this.prisma.attachment.findMany({ where: { requestId: id }, select: { storagePath: true } })
    ).map((a) => a.storagePath);

    const result = await this.tx(actor, id, dto.version, 'CANCEL', async (tx, pr) => {
      await tx.paymentRequest.delete({ where: { id } });
      await this.audit(
        tx,
        actor.id,
        'T2',
        'payment_request',
        id,
        `${pr.code}: hủy ở B1 — xóa khỏi hệ thống${paths.length ? ` (kèm ${paths.length} file đính kèm)` : ''}`,
      );
      return { message: `Đã hủy và xóa phiếu ${pr.code}` };
    });

    // Chỉ đụng ổ đĩa sau khi transaction chắc chắn thành công.
    removeStoredFiles(paths);
    return result;
  }

  /** T3 — Lãnh đạo duyệt. */
  leaderApprove(actor: Actor, id: string, dto: SubmitDto) {
    return this.tx(actor, id, dto.version, 'LEADER_APPROVE', async (tx, pr) => {
      requireTick(dto.confirmed, 'Lãnh đạo duyệt');
      await this.move(tx, pr, 'T3', 'ADVANCE_PREPARATION', actor.id, dto.note?.trim() || null);
      await this.notify(tx, [pr.assignedRequesterId], id, 'Lãnh đạo đã duyệt', `${pr.code}: mời nộp hồ sơ tạm ứng (B3)`);
      await this.audit(tx, actor.id, 'T3', 'payment_request', id, `${pr.code}: Lãnh đạo duyệt`);
      return { message: 'Đã duyệt, chuyển B3' };
    });
  }

  /** T4 / T5 — từ chối hoặc trả lại, đều bắt buộc lý do. */
  leaderReject(actor: Actor, id: string, dto: ReasonDto, reject: boolean) {
    const key: ActionKey = reject ? 'LEADER_REJECT' : 'LEADER_RETURN';
    return this.tx(actor, id, dto.version, key, async (tx, pr) => {
      const reason = requireReason(dto.reason, reject ? 'lý do từ chối' : 'nội dung cần bổ sung');
      await this.move(tx, pr, reject ? 'T4' : 'T5', reject ? 'REJECTED' : 'DRAFT', actor.id, reason, reject ? {} : { resubmitted: true });
      await this.notify(
        tx,
        [pr.assignedRequesterId],
        id,
        reject ? 'Lãnh đạo từ chối phiếu' : 'Lãnh đạo trả lại phiếu',
        `${pr.code}: ${reason}`,
      );
      await this.audit(tx, actor.id, reject ? 'T4' : 'T5', 'payment_request', id, `${pr.code}: ${reject ? 'từ chối' : 'trả lại'} – ${reason}`);
      return { message: reject ? 'Đã từ chối phiếu' : 'Đã trả phiếu về B1' };
    });
  }

  /** T6 — hoàn tất hồ sơ tạm ứng. */
  submitAdvance(actor: Actor, id: string, dto: SubmitAdvanceDto) {
    return this.tx(actor, id, dto.version, 'SUBMIT_ADVANCE', async (tx, pr) => {
      requireTick(dto.confirmed, 'Hoàn tất HS tạm ứng');
      const amt = dto.advanceAmount;
      if (!(amt > 0)) fail('ERR_ADV_ZERO', 'Số tiền tạm ứng phải lớn hơn 0');
      if (amt > Number(pr.requestedAmount)) fail('ERR_ADV_EXCEED_TOTAL', 'Số tiền tạm ứng không được vượt Tổng đề nghị');
      await this.requireSlots(tx, id, ['PURCHASE_ORDER', 'ADVANCE_REQUEST']);
      await this.move(tx, pr, 'T6', 'COORDINATION', actor.id, null, { advanceAmount: new Prisma.Decimal(amt) });
      const managers = await tx.user.findMany({ where: { role: 'FINANCE_MANAGER', status: 'ACTIVE' } });
      await this.notify(tx, managers.map((m) => m.id), id, 'Phiếu chờ TPTC duyệt (B4)', `${pr.code} – ${pr.title}`);
      await this.audit(tx, actor.id, 'T6', 'payment_request', id, `${pr.code}: hoàn tất HS tạm ứng`);
      return { message: 'Đã hoàn tất hồ sơ tạm ứng, chuyển TPTC (B4)' };
    });
  }

  /** T7 — TPTC duyệt; hệ thống tự gán tài khoản Kế toán duy nhất (workflow §5.3). */
  async financeApprove(actor: Actor, id: string, dto: FinanceApproveDto) {
    const accountant = await this.prisma.user.findFirst({ where: { role: 'ACCOUNTANT', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    if (!accountant) {
      const found = await this.prisma.paymentRequest.findUnique({ where: { id } });
      await this.alertAdminsNow(
        'Chưa có Kế toán nhận phiếu',
        `Phiếu ${found?.code ?? id} không chuyển được sang B5 vì không có tài khoản Kế toán đang hoạt động.`,
        id,
      );
      fail('ERR_NO_ACCOUNTANT', 'Không còn tài khoản Kế toán đang hoạt động. Đã báo Admin.');
    }
    return this.tx(actor, id, dto.version, 'FINANCE_APPROVE', async (tx, pr) => {
      requireTick(dto.confirmed, 'TPTC duyệt và chuyển Kế toán');
      if (!dto.priority) fail('ERR_REQUIRED_FIELD', 'Chọn Độ ưu tiên');
      if (!dto.accountantNameId) fail('ERR_REQUIRED_FIELD', 'Chọn Nhân viên kế toán tiếp nhận');
      const who = await tx.accountantName.findFirst({ where: { id: dto.accountantNameId, deleted: false } });
      if (!who) fail('ERR_NOT_FOUND', 'Nhân viên kế toán không hợp lệ hoặc đã bị xóa');
      const note = dto.note?.trim();
      await this.move(tx, pr, 'T7', 'ADVANCE_PAYMENT', actor.id, note || null, {
        assignedAccountant: { connect: { id: accountant.id } },
        accountantName: { connect: { id: dto.accountantNameId } },
        priority: dto.priority,
      });
      if (note) {
        await tx.comment.create({
          data: {
            requestId: id,
            authorId: actor.id,
            content: `[TÀI CHÍNH ĐIỀU PHỐI] ${note}`,
            mentions: { create: [{ userId: accountant.id }] },
          },
        });
      }
      await this.notify(tx, [accountant.id], id, 'Phiếu đã chuyển cho bạn để thực hiện tạm ứng (B5)', `${pr.code} – ưu tiên ${dto.priority}`);
      await this.audit(tx, actor.id, 'T7', 'payment_request', id, `${pr.code}: TPTC duyệt, chuyển ${accountant.username}`);
      return { message: `Đã duyệt và chuyển phiếu cho ${accountant.fullName} (B5)` };
    });
  }

  /** T8 — chi tạm ứng. */
  payAdvance(actor: Actor, id: string, dto: PayAdvanceDto) {
    return this.tx(actor, id, dto.version, 'PAY_ADVANCE', async (tx, pr) => {
      requireTick(dto.checkedDocs, 'Đã kiểm tra hồ sơ');
      requireTick(dto.paid, 'Đã thanh toán tạm ứng');
      if (!dto.method) fail('ERR_REQUIRED_FIELD', 'Chọn hình thức chi');
      if (!dto.paidDate) fail('ERR_REQUIRED_FIELD', 'Nhập ngày chi');
      await this.requireSlots(tx, id, ['ADVANCE_PROOF']);
      await tx.paymentTransaction.create({
        data: { requestId: id, kind: 'ADVANCE', amount: pr.advanceAmount ?? new Prisma.Decimal(0), method: dto.method, paidDate: dto.paidDate, createdById: actor.id },
      });
      await this.move(tx, pr, 'T8', 'AFTER_ADVANCE', actor.id, null);
      await this.notify(tx, [pr.assignedRequesterId], id, 'Đã chi tạm ứng', `${pr.code}: mời hoàn tất hồ sơ ĐN thanh toán (B6)`);
      await this.audit(tx, actor.id, 'T8', 'payment_request', id, `${pr.code}: đã chi tạm ứng`);
      return { message: 'Đã ghi nhận chi tạm ứng (B6)' };
    });
  }

  /** T9 — hoàn tất hồ sơ ĐN thanh toán; "Đã chi thêm" không vượt Tổng đề nghị − Tạm ứng. */
  submitSettlement(actor: Actor, id: string, dto: SubmitAdvanceDto & { settlementAmount: number }) {
    return this.tx(actor, id, dto.version, 'SUBMIT_SETTLEMENT', async (tx, pr) => {
      requireTick(dto.confirmed, 'Hoàn tất HS ĐN thanh toán');
      const advance = Number(pr.advanceAmount ?? 0);
      const requested = Number(pr.requestedAmount);
      assertSettlement(requested, advance, dto.settlementAmount);
      await this.requireSlots(tx, id, ['DELIVERY_RECORD', 'PAYMENT_REQUEST_DOC']);
      await this.move(tx, pr, 'T9', 'FINAL_PAYMENT', actor.id, null, { settlementAmount: new Prisma.Decimal(dto.settlementAmount) });
      const remaining = remainingOf(requested, advance, dto.settlementAmount);
      await this.notify(tx, [pr.assignedAccountantId], id, 'Phiếu chờ thanh toán (B7)', `${pr.code}: còn lại phải chi ${remaining.toLocaleString('vi-VN')} ₫`);
      await this.audit(tx, actor.id, 'T9', 'payment_request', id, `${pr.code}: hoàn tất HS ĐN thanh toán`);
      return { message: 'Đã gửi kế toán thanh toán (B7)' };
    });
  }

  /** T10 → T11/T12 — thanh toán đợt cuối rồi kiểm tra hóa đơn, trong cùng một transaction. */
  payFinal(actor: Actor, id: string, dto: PayFinalDto) {
    return this.tx(actor, id, dto.version, 'PAY_FINAL', async (tx, pr) => {
      requireTick(dto.checkedDocs, 'Đã kiểm tra HS hoàn ứng');
      requireTick(dto.completed, 'HOÀN THÀNH');
      if (!dto.paidDate) fail('ERR_REQUIRED_FIELD', 'Nhập ngày chi');
      const remaining = remainingOf(Number(pr.requestedAmount), Number(pr.advanceAmount ?? 0), pr.settlementAmount ? Number(pr.settlementAmount) : null);
      if (remaining > 0) {
        if (!dto.method) fail('ERR_REQUIRED_FIELD', 'Chọn hình thức chi đợt cuối');
        await this.requireSlots(tx, id, ['FINAL_PROOF'], 'ERR_FINAL_NO_PROOF');
        await tx.paymentTransaction.create({
          data: { requestId: id, kind: 'FINAL', amount: new Prisma.Decimal(remaining), method: dto.method, paidDate: dto.paidDate, createdById: actor.id },
        });
      }
      await tx.requestTimeline.create({ data: { requestId: id, action: 'T10', fromStatus: pr.status, toStatus: null, actorId: actor.id } });

      const invoices = await tx.attachment.count({ where: { requestId: id, slot: 'INVOICE' } });
      const passes = !pr.hasInvoice || invoices > 0;
      if (passes) {
        await this.move(tx, pr, 'T11', 'COMPLETED', null, null, { completedAt: new Date() });
        await this.notify(tx, [pr.assignedRequesterId], id, 'Phiếu đã hoàn thành', `${pr.code} – ${pr.title}`);
      } else {
        const cfg = await tx.systemConfig.findUnique({ where: { key: 'SYSTEM' } });
        await this.move(tx, pr, 'T12', 'DOCUMENT_SUPPLEMENT_REQUIRED', null, null, { invoiceDueStartAt: new Date() });
        await this.notify(
          tx,
          [pr.assignedRequesterId],
          id,
          'Cần bổ sung hóa đơn (B8)',
          `${pr.code}: đã thanh toán dứt điểm, hạn nộp hóa đơn ${cfg?.invoiceDeadlineWorkingDays ?? 5} ngày làm việc`,
        );
      }
      await this.audit(tx, actor.id, 'T10', 'payment_request', id, `${pr.code}: thanh toán đợt cuối → ${passes ? 'COMPLETED' : 'B8'}`);
      return { status: passes ? 'COMPLETED' : 'DOCUMENT_SUPPLEMENT_REQUIRED', message: passes ? 'Phiếu đã Hoàn thành' : 'Đã thanh toán; phiếu chuyển B8 chờ bổ sung hóa đơn' };
    });
  }

  /** T13 — bổ sung hóa đơn ở B8. */
  completeInvoice(actor: Actor, id: string, dto: VersionDto) {
    return this.tx(actor, id, dto.version, 'COMPLETE_INVOICE', async (tx, pr) => {
      await this.requireSlots(tx, id, ['INVOICE']);
      await this.move(tx, pr, 'T13', 'COMPLETED', actor.id, null, { lateInvoice: false, completedAt: new Date() });
      await this.notify(tx, [pr.assignedAccountantId], id, 'Đã bổ sung hóa đơn', `${pr.code}: mời đối chiếu hóa đơn`);
      await this.audit(tx, actor.id, 'T13', 'payment_request', id, `${pr.code}: bổ sung hóa đơn → Hoàn thành`);
      return { message: 'Đã bổ sung hóa đơn — phiếu Hoàn thành' };
    });
  }

  // -------------------------------------------------------------------------
  // Admin privileges A1–A4 (workflow §5.2) — warn, never block
  // -------------------------------------------------------------------------

  force(actor: Actor, id: string, dto: ForceDto) {
    return this.tx(actor, id, dto.version, 'FORCE', async (tx, pr) => {
      const reason = requireReason(dto.reason);
      if (dto.toStatus === pr.status) fail('ERR_INVALID_TRANSITION', 'Trạng thái đích trùng trạng thái hiện tại');
      const txns = await tx.paymentTransaction.findMany({ where: { requestId: id } });
      const warning = paymentSkipWarning(
        dto.toStatus,
        txns.some((t) => t.kind === 'ADVANCE'),
        txns.some((t) => t.kind === 'FINAL'),
        remainingOf(Number(pr.requestedAmount), Number(pr.advanceAmount ?? 0), pr.settlementAmount ? Number(pr.settlementAmount) : null),
      );
      const extra: Prisma.PaymentRequestUpdateInput = {};
      if ((dto.toStatus === 'ADVANCE_PAYMENT' || dto.toStatus === 'FINAL_PAYMENT') && !pr.assignedAccountantId) {
        const acc = await tx.user.findFirst({ where: { role: 'ACCOUNTANT', status: 'ACTIVE' } });
        if (acc) extra.assignedAccountant = { connect: { id: acc.id } };
      }
      if (dto.toStatus === 'DOCUMENT_SUPPLEMENT_REQUIRED' && !pr.invoiceDueStartAt) extra.invoiceDueStartAt = new Date();
      await this.move(tx, pr, 'A1', dto.toStatus, actor.id, reason, extra);
      await this.notify(tx, [pr.assignedRequesterId, pr.assignedAccountantId], id, 'Admin ép chuyển bước', `${pr.code} → ${STATUS_STEP[dto.toStatus]}: ${reason}`);
      await this.audit(tx, actor.id, 'A1', 'payment_request', id, `${pr.code}: ép chuyển → ${dto.toStatus} – ${reason}`);
      return { message: `Đã chuyển phiếu sang ${STATUS_STEP[dto.toStatus]}`, warning };
    });
  }

  adminCancel(actor: Actor, id: string, dto: ReasonDto) {
    return this.tx(actor, id, dto.version, 'ADMIN_CANCEL', async (tx, pr) => {
      const reason = requireReason(dto.reason);
      const paid = await tx.paymentTransaction.count({ where: { requestId: id } });
      await this.move(tx, pr, 'A2', 'CANCELLED', actor.id, reason);
      await this.notify(tx, [pr.assignedRequesterId, pr.assignedAccountantId], id, 'Admin hủy phiếu', `${pr.code}: ${reason}`);
      await this.audit(tx, actor.id, 'A2', 'payment_request', id, `${pr.code}: Admin hủy – ${reason}`);
      return {
        message: 'Đã hủy phiếu',
        warning: paid > 0 ? `Phiếu đã phát sinh ${paid} giao dịch chi — cần đối chiếu lại sổ quỹ.` : undefined,
      };
    });
  }

  reopen(actor: Actor, id: string, dto: ForceDto) {
    return this.tx(actor, id, dto.version, 'REOPEN', async (tx, pr) => {
      const reason = requireReason(dto.reason);
      const to = dto.toStatus ?? 'DRAFT';
      await this.move(tx, pr, 'A3', to, actor.id, reason, to === 'DRAFT' ? { resubmitted: true, completedAt: null } : { completedAt: null });
      await this.notify(tx, [pr.assignedRequesterId, pr.assignedAccountantId], id, 'Admin mở lại phiếu', `${pr.code} → ${STATUS_STEP[to]}: ${reason}`);
      await this.audit(tx, actor.id, 'A3', 'payment_request', id, `${pr.code}: mở lại → ${to} – ${reason}`);
      return { message: `Đã mở lại phiếu về ${STATUS_STEP[to]}` };
    });
  }

  async transfer(actor: Actor, dto: TransferDto) {
    const reason = requireReason(dto.reason);
    const target = await this.prisma.user.findUnique({ where: { id: dto.toRequesterId } });
    if (!target || target.role !== 'REQUESTER' || target.status !== 'ACTIVE') {
      fail('ERR_REQUIRED_FIELD', 'Người nhận phải là nhân viên cung ứng đang hoạt động');
    }
    for (const item of dto.items) {
      await this.tx(actor, item.id, item.version, 'TRANSFER', async (tx, pr) => {
        if (pr.assignedRequesterId === target.id) fail('ERR_REQUIRED_FIELD', `${pr.code} đang thuộc nhân viên này`);
        const oldId = pr.assignedRequesterId;
        await tx.paymentRequest.update({
          where: { id: pr.id },
          data: { assignedRequesterId: target.id, version: { increment: 1 } },
        });
        await tx.requestTimeline.create({
          data: { requestId: pr.id, action: 'A4', fromStatus: pr.status, toStatus: pr.status, actorId: actor.id, reason },
        });
        await this.notify(tx, [oldId, target.id], pr.id, 'Chuyển giao phiếu', `${pr.code} chuyển sang ${target.fullName}`);
        await this.audit(tx, actor.id, 'A4', 'payment_request', pr.id, `${pr.code}: chuyển giao → ${target.username} – ${reason}`);
        return {};
      });
    }
    return { message: `Đã chuyển giao ${dto.items.length} phiếu cho ${target.fullName}` };
  }

  async remove(actor: Actor, id: string, dto: ReasonDto) {
    // Đọc trước khi xóa: cascade sẽ cuốn sạch hàng attachment nên sau transaction
    // không còn cách nào tra ra file nào thuộc phiếu này.
    const paths = (
      await this.prisma.attachment.findMany({ where: { requestId: id }, select: { storagePath: true } })
    ).map((a) => a.storagePath);

    const result = await this.tx(actor, id, dto.version, 'DELETE', async (tx, pr) => {
      const reason = requireReason(dto.reason, 'lý do xóa');
      // Xóa thật khỏi PostgreSQL. Cascade dọn luôn đính kèm, lịch sử, giao dịch,
      // bình luận và thông báo của phiếu (schema.prisma: onDelete Cascade).
      await tx.paymentRequest.delete({ where: { id } });
      await this.audit(
        tx,
        actor.id,
        'DELETE',
        'payment_request',
        id,
        `Xóa phiếu ${pr.code} – ${reason} (kèm ${paths.length} file đính kèm)`,
      );
      return { message: `Đã xóa phiếu ${pr.code}` };
    });

    // Chỉ đụng tới ổ đĩa sau khi transaction chắc chắn thành công. Xóa file trước
    // mà transaction rollback thì phiếu còn nguyên nhưng chứng từ đã mất vĩnh viễn.
    removeStoredFiles(paths);
    return result;
  }

  // -------------------------------------------------------------------------
  // Lưu trữ (A5): dọn file khỏi đĩa máy chủ, giữ nguyên hồ sơ để còn tra cứu
  // -------------------------------------------------------------------------

  async archive(actor: Actor, id: string, dto: VersionDto) {
    const { pr, paths } = await this.loadForArchive(actor, id, dto.version, 'ARCHIVE');
    if (pr.archivedAt) fail('ERR_ALREADY_ARCHIVED', `Phiếu ${pr.code} đã được lưu trữ trước đó`);
    if (!paths.length) fail('ERR_NOTHING_TO_ARCHIVE', `Phiếu ${pr.code} không có file đính kèm nào để lưu trữ`);

    // Chuyển file TRƯỚC rồi mới đánh dấu. Làm ngược lại thì một lần chép hỏng sẽ để
    // phiếu mang nhãn "đã lưu trữ" trong khi file vẫn nằm trên máy chủ.
    const { moved, bytes, missing } = archiveStoredFiles(paths);

    return this.tx(actor, id, dto.version, 'ARCHIVE', async (tx, cur) => {
      await tx.paymentRequest.update({
        where: { id },
        data: { archivedAt: new Date(), version: { increment: 1 } },
      });
      const mb = (bytes / 1048576).toFixed(1);
      await this.audit(
        tx,
        actor.id,
        'ARCHIVE',
        'payment_request',
        id,
        `Lưu trữ ${cur.code}: chuyển ${moved} file (${mb} MB) sang NAS, xóa khỏi đĩa máy chủ` +
          (missing.length ? ` — ${missing.length} file không tìm thấy ở cả hai nơi` : ''),
      );
      return {
        message:
          `Đã lưu trữ ${moved} file (${mb} MB) của phiếu ${cur.code}` +
          (missing.length ? `. Cảnh báo: ${missing.length} file không tìm thấy` : ''),
      };
    });
  }

  async restore(actor: Actor, id: string, dto: VersionDto) {
    const { pr, paths } = await this.loadForArchive(actor, id, dto.version, 'RESTORE');
    if (!pr.archivedAt) fail('ERR_NOT_ARCHIVED', `Phiếu ${pr.code} chưa được lưu trữ`);

    // Kéo đủ file về trước; hàm này tự dừng nếu thiếu, chưa chép gì cả.
    const { restored } = restoreStoredFiles(paths);

    return this.tx(actor, id, dto.version, 'RESTORE', async (tx, cur) => {
      await tx.paymentRequest.update({ where: { id }, data: { archivedAt: null, version: { increment: 1 } } });
      await this.audit(
        tx,
        actor.id,
        'RESTORE',
        'payment_request',
        id,
        `Phục hồi ${cur.code}: kéo ${restored} file từ NAS về đĩa máy chủ`,
      );
      return { message: `Đã phục hồi ${restored} file của phiếu ${cur.code}` };
    });
  }

  /** Kiểm tra quyền và phiên bản trước khi đụng tới ổ đĩa, vì thao tác file nằm ngoài transaction. */
  private async loadForArchive(actor: Actor, id: string, version: number, key: 'ARCHIVE' | 'RESTORE') {
    const pr = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!pr) fail('ERR_NOT_FOUND', 'Không tìm thấy phiếu');
    authorize(actor, pr as never, key);
    if (pr.version !== version) {
      fail('ERR_VERSION_CONFLICT', `Phiếu ${pr.code} vừa được người khác cập nhật. Vui lòng tải lại và thử lại.`);
    }
    const paths = (
      await this.prisma.attachment.findMany({ where: { requestId: id }, select: { storagePath: true } })
    ).map((a) => a.storagePath);
    return { pr, paths };
  }

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  async comment(actor: Actor, id: string, content: string) {
    const text = (content ?? '').trim();
    if (!text) fail('ERR_REQUIRED_FIELD', 'Nội dung comment trống');
    const pr = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!pr) fail('ERR_NOT_FOUND', 'Không tìm thấy phiếu');
    authorize(actor, pr as never, 'COMMENT');

    const handles = [...text.matchAll(/@([A-Za-z0-9._-]+)/g)].map((m) => m[1].toLowerCase());
    const mentioned = handles.length
      ? await this.prisma.user.findMany({ where: { username: { in: handles, mode: 'insensitive' }, NOT: { id: actor.id } } })
      : [];
    return this.prisma.$transaction(async (tx) => {
      await tx.comment.create({
        data: { requestId: id, authorId: actor.id, content: text, mentions: { create: mentioned.map((u) => ({ userId: u.id })) } },
      });
      const author = await tx.user.findUnique({ where: { id: actor.id } });
      await this.notify(tx, mentioned.map((u) => u.id), id, `${author.fullName} nhắc đến bạn`, `${pr.code}: ${text.slice(0, 120)}`);
      await this.audit(tx, actor.id, 'COMMENT', 'payment_request', id, `${pr.code}: comment`);
      return { message: 'Đã gửi comment' };
    });
  }

  /**
   * Đôn đốc bộ phận còn thiếu chứng từ, dùng ở màn "Phiếu hoàn thành". Áp dụng
   * cho cả phiếu đã khép lẫn phiếu còn ở B8 chờ hóa đơn. Không đổi trạng thái
   * phiếu nên không cần khóa version.
   */
  async notifyMissingDocs(actor: Actor, id: string, note?: string) {
    const pr = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { attachments: { select: { slot: true } } },
    });
    if (!pr) fail('ERR_NOT_FOUND', 'Không tìm thấy phiếu');

    const missing = missingDocsOf(
      {
        requestedAmount: Number(pr.requestedAmount),
        advanceAmount: pr.advanceAmount === null ? null : Number(pr.advanceAmount),
        settlementAmount: pr.settlementAmount === null ? null : Number(pr.settlementAmount),
        hasInvoice: pr.hasInvoice,
      },
      pr.attachments.map((a) => a.slot as Slot),
    );
    if (missing.length === 0) {
      return { message: 'Phiếu đã có đầy đủ chứng từ, không cần gửi thông báo' };
    }

    const targets = new Set<string>();
    const departments: string[] = [];
    if (missing.some((m) => m.deptKind === 'PROCUREMENT')) {
      departments.push('Phòng Cung Ứng');
      if (pr.assignedRequesterId) targets.add(pr.assignedRequesterId);
    }
    if (missing.some((m) => m.deptKind === 'ACCOUNTING')) {
      departments.push('Phòng Kế Toán');
      if (pr.assignedAccountantId) targets.add(pr.assignedAccountantId);
      const kt = await this.prisma.user.findMany({ where: { role: 'ACCOUNTANT', status: 'ACTIVE' }, select: { id: true } });
      for (const u of kt) targets.add(u.id);
    }

    const trimmed = (note ?? '').trim();
    const labels = missing.map((m) => `${m.label} (${m.department})`).join(', ');
    const lines = missing.map((m) => `- ${m.label} [${m.department}]: ${m.description}`).join('\n');
    const ids = [...targets];

    return this.prisma.$transaction(async (tx) => {
      await this.notify(
        tx,
        ids,
        pr.id,
        'Yêu cầu bổ sung chứng từ phiếu hoàn thành',
        `${pr.code}: Thiếu ${labels}. ${trimmed || 'Vui lòng kiểm tra và bổ sung chứng từ còn thiếu.'}`,
      );
      await tx.comment.create({
        data: {
          requestId: pr.id,
          authorId: actor.id,
          content: `[KIỂM TRA CHỨNG TỪ HOÀN THÀNH]
Phiếu thiếu các chứng từ sau:
${lines}
${trimmed ? `Ghi chú đôn đốc: ${trimmed}
` : ''}Đề nghị ${departments.join(' và ')} kiểm tra và bổ sung theo quy định.`,
          mentions: { create: ids.map((userId) => ({ userId })) },
        },
      });
      await this.audit(tx, actor.id, 'NOTIFY_MISSING_DOCS', 'payment_request', pr.id, `${pr.code}: thông báo thiếu chứng từ tới ${departments.join(', ')}`);
      return { message: `Đã gửi thông báo thiếu chứng từ tới ${departments.join(' và ')}` };
    });
  }

  // -------------------------------------------------------------------------
  // Shared internals
  // -------------------------------------------------------------------------

  /**
   * Loads the request, authorizes the action, re-checks `version` and runs `body`
   * in one transaction — the optimistic lock of workflow §6.9.
   */
  private async tx<T>(
    actor: Actor,
    id: string,
    version: number,
    key: ActionKey,
    body: (tx: Tx, pr: Prisma.PaymentRequestGetPayload<object>) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const pr = await tx.paymentRequest.findUnique({ where: { id } });
      if (!pr) fail('ERR_NOT_FOUND', 'Không tìm thấy phiếu');
      authorize(actor, pr as never, key);
      if (pr.version !== version) {
        fail('ERR_VERSION_CONFLICT', `Phiếu ${pr.code} vừa được người khác cập nhật. Vui lòng tải lại và thử lại.`);
      }
      return body(tx, pr);
    });
  }

  private async move(
    tx: Tx,
    pr: { id: string; status: string },
    action: string,
    to: Status,
    actorId: string | null,
    reason: string | null,
    extra: Prisma.PaymentRequestUpdateInput = {},
  ) {
    await tx.requestTimeline.create({
      data: { requestId: pr.id, action: action as never, fromStatus: pr.status as never, toStatus: to, actorId, reason },
    });
    await tx.paymentRequest.update({
      where: { id: pr.id },
      data: { status: to, version: { increment: 1 }, ...extra },
    });
  }

  private async requireSlots(tx: Tx, requestId: string, slots: Slot[], code = 'ERR_DOC_INCOMPLETE') {
    const rows = await tx.attachment.groupBy({ by: ['slot'], where: { requestId, slot: { in: slots as never } }, _count: true });
    const present = new Set(rows.map((r) => r.slot as Slot));
    const missing = slots.filter((s) => !present.has(s)).map((s) => SLOT_DEF[s].label);
    if (missing.length) fail(code, `Thiếu file bắt buộc: ${missing.join(', ')}`);
  }

  private notify(tx: Tx, userIds: (string | null | undefined)[], requestId: string | null, title: string, message: string) {
    const unique = [...new Set(userIds.filter((u): u is string => !!u))];
    if (unique.length === 0) return Promise.resolve({ count: 0 });
    return tx.notification.createMany({ data: unique.map((userId) => ({ userId, requestId, title, message })) });
  }

  /** Sent outside any transaction so a refused action still reaches Admin. */
  private async alertAdminsNow(title: string, message: string, requestId: string | null) {
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    if (admins.length === 0) return;
    await this.prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, requestId, title, message })) });
  }

  private audit(tx: Tx, actorId: string | null, action: string, entity: string, entityId: string | null, detail: string) {
    return tx.auditLog.create({ data: { actorId, action, entity, entityId, detail } });
  }

  /** Exposed so the attachments module can reuse the same guard. */
  static slotsFor(status: Status): Slot[] {
    return (Object.keys(SLOT_DEF) as Slot[]).filter((s) => SLOT_DEF[s].stages.includes(status));
  }

  static actionStatuses(key: ActionKey): Status[] {
    return ACTION_FROM[key];
  }
}
