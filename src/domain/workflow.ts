// Workflow engine: every state change is one FSM transition from docs/workflow.md §5 (v3.4).
// perform() is pure with respect to its input: it clones the db, applies the action atomically and returns the new db.
import { checkCompletedAttachments } from './completedAudit.ts';
import { PRIORITY_LABEL, SLOT_DEF, STATUS_LABEL, STATUS_STEP, WORKING_STATUSES, stepIndex } from './constants.ts';
import { DomainError, fail } from './errors.ts';
import { buildFileName, buildStoragePath, validateUpload } from './files.ts';
import {
  accountants,
  admins,
  authorize,
  canDeleteAttachment,
  canUploadToSlot,
  findUser,
  isAdmin,
  leaders as allLeaders,
  requesters,
  theAccountant,
  type RequestActionKey,
} from './permissions.ts';
import type {
  Attachment,
  Db,
  PaymentMethod,
  PaymentRequest,
  Priority,
  Slot,
  Status,
  TimelineAction,
  User,
} from './types.ts';

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export interface DraftFields {
  title: string;
  projectId: string;
  categoryId: string;
  requesterNameId: string;
  vendorId: string;
  requestedAmount: number;
  hasInvoice: boolean;
  note: string;
}

export interface FileMeta {
  fileName: string;
  size: number;
  mimeType: string;
}

interface Versioned {
  id: string;
  version: number;
}

export type WorkflowAction =
  | { type: 'CREATE_REQUEST'; fields: DraftFields; assignedRequesterId?: string }
  | ({ type: 'UPDATE_INFO'; fields: DraftFields } & Versioned)
  | { type: 'ATTACH'; id: string; slot: Slot; files: FileMeta[] }
  | { type: 'DETACH'; attachmentId: string }
  | ({ type: 'SUBMIT'; confirmed: boolean } & Versioned)
  | ({ type: 'CANCEL' } & Versioned)
  | ({ type: 'LEADER_APPROVE'; confirmed: boolean; note?: string } & Versioned)
  | ({ type: 'LEADER_REJECT' | 'LEADER_RETURN'; reason: string } & Versioned)
  | ({ type: 'SUBMIT_ADVANCE'; confirmed: boolean; advanceAmount: number } & Versioned)
  | ({ type: 'FINANCE_APPROVE'; confirmed: boolean; priority: Priority | null; accountantNameId: string; note?: string } & Versioned)
  | ({ type: 'PAY_ADVANCE'; checkedDocs: boolean; paid: boolean; method: PaymentMethod | null; paidDate: string } & Versioned)
  | ({ type: 'SUBMIT_SETTLEMENT'; confirmed: boolean; settlementAmount: number } & Versioned)
  | ({ type: 'PAY_FINAL'; checkedDocs: boolean; completed: boolean; method: PaymentMethod | null; paidDate: string } & Versioned)
  | ({ type: 'COMPLETE_INVOICE' } & Versioned)
  | { type: 'TRANSFER'; items: Versioned[]; toRequesterId: string; reason: string }
  | ({ type: 'FORCE'; toStatus: Status; reason: string } & Versioned)
  | ({ type: 'ADMIN_CANCEL' | 'DELETE_REQUEST'; reason: string } & Versioned)
  | ({ type: 'REOPEN'; reason: string; toStatus?: Status } & Versioned)
  | ({ type: 'ARCHIVE' | 'RESTORE' } & Versioned)
  | { type: 'COMMENT'; id: string; content: string }
  | { type: 'NOTIFY_MISSING_DOCS'; id: string; note?: string };

export interface WorkflowResult {
  requestId?: string;
  attachments?: Attachment[];
  removedAttachmentIds?: string[];
  /** Resulting status after T10 (COMPLETED or DOCUMENT_SUPPLEMENT_REQUIRED). */
  status?: Status;
  message: string;
  /** Admin privilege executed despite a risky condition (workflow §5.2 — warn, never block). */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by admin.ts / jobs.ts)
// ---------------------------------------------------------------------------

export function nextId(db: Db, prefix: string): string {
  db.idCounter += 1;
  return `${prefix}-${db.idCounter}`;
}

export function audit(
  db: Db,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  detail: string,
  now: Date,
): void {
  db.audit.push({ id: nextId(db, 'log'), actorId, action, entity, entityId, detail, createdAt: now.toISOString() });
}

export function notify(
  db: Db,
  userIds: (string | null | undefined)[],
  requestId: string | null,
  title: string,
  message: string,
  now: Date,
): void {
  const unique = [...new Set(userIds.filter((u): u is string => !!u))];
  for (const userId of unique) {
    db.notifications.push({
      id: nextId(db, 'ntf'),
      userId,
      requestId,
      title,
      message,
      read: false,
      createdAt: now.toISOString(),
    });
  }
}

export function getRequest(db: Db, id: string): PaymentRequest {
  const pr = db.requests.find((r) => r.id === id);
  if (!pr) fail('ERR_NOT_FOUND', 'Không tìm thấy phiếu');
  return pr;
}

export function getActor(db: Db, actorId: string): User {
  const user = findUser(db, actorId);
  if (!user) fail('ERR_FORBIDDEN', 'Phiên đăng nhập không hợp lệ');
  if (user.status !== 'ACTIVE') fail('ERR_ACCOUNT_LOCKED', 'Tài khoản đang bị khóa');
  return user;
}

function checkVersion(pr: PaymentRequest, version: number): void {
  if (pr.version !== version) {
    fail('ERR_VERSION_CONFLICT', `Phiếu ${pr.code} vừa được người khác cập nhật. Vui lòng tải lại và thử lại.`);
  }
}

function requireReason(reason: string | undefined, label = 'lý do'): string {
  const r = (reason ?? '').trim();
  if (!r) fail('ERR_REASON_REQUIRED', `Bắt buộc nhập ${label}`);
  return r;
}

function requireTick(ok: boolean, what: string): void {
  if (!ok) fail('ERR_PAYMENT_NO_CONFIRM', `Chưa tick ô ☑ ${what}`);
}

function slotFiles(db: Db, pr: PaymentRequest, slot: Slot): Attachment[] {
  return db.attachments.filter((a) => a.requestId === pr.id && a.slot === slot);
}

function requireSlots(db: Db, pr: PaymentRequest, slots: Slot[]): void {
  const missing = slots.filter((s) => slotFiles(db, pr, s).length === 0).map((s) => SLOT_DEF[s].label);
  if (missing.length) fail('ERR_DOC_INCOMPLETE', `Thiếu file bắt buộc: ${missing.join(', ')}`);
}

function transition(
  db: Db,
  pr: PaymentRequest,
  action: TimelineAction,
  to: Status | null,
  actorId: string | null,
  reason: string | null,
  now: Date,
): void {
  pr.timeline.push({
    id: nextId(db, 'tl'),
    action,
    fromStatus: pr.status,
    toStatus: to,
    actorId,
    reason,
    createdAt: now.toISOString(),
  });
  if (to) {
    pr.status = to;
    pr.completedAt = to === 'COMPLETED' ? now.toISOString() : null;
  }
  touch(pr, now);
}

function touch(pr: PaymentRequest, now: Date): void {
  pr.version += 1;
  pr.updatedAt = now.toISOString();
}

function timelineNote(db: Db, pr: PaymentRequest, action: TimelineAction, actorId: string | null, reason: string | null, now: Date): void {
  pr.timeline.push({
    id: nextId(db, 'tl'),
    action,
    fromStatus: pr.status,
    toStatus: pr.status,
    actorId,
    reason,
    createdAt: now.toISOString(),
  });
  touch(pr, now);
}

function addComment(db: Db, pr: PaymentRequest, authorId: string, content: string, mentions: string[], now: Date): void {
  db.comments.push({
    id: nextId(db, 'cmt'),
    requestId: pr.id,
    authorId,
    content,
    mentions: mentions.filter((m) => m !== authorId),
    createdAt: now.toISOString(),
  });
}

function stepText(status: Status): string {
  return `${STATUS_STEP[status]} ${STATUS_LABEL[status]}`;
}

function nextRequestCode(db: Db, now: Date): string {
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Lấy mã lớn nhất đang có của tháng làm sàn: bộ đếm lệch thì mã sẽ trùng, và
  // hai phiếu khác nhau mang cùng một mã còn tệ hơn lỗi khi tạo.
  const prefix = `PYC-${ym}-`;
  let floor = 0;
  for (const r of db.requests) {
    if (!r.code.startsWith(prefix)) continue;
    floor = Math.max(floor, Number(r.code.slice(-4)) || 0);
  }
  const n = Math.max(db.seq[ym] ?? 0, floor) + 1;
  db.seq[ym] = n;
  return `PYC-${ym}-${String(n).padStart(4, '0')}`;
}

function validateDraftFields(db: Db, f: DraftFields, forCreate: boolean): DraftFields {
  const title = f.title.trim();
  const missing: string[] = [];
  if (!title) missing.push('Nội dung chi');
  if (!f.projectId) missing.push('Dự án');
  if (!f.categoryId) missing.push('Hạng mục chi');
  if (!f.requesterNameId) missing.push('Người yêu cầu');
  if (!f.vendorId) missing.push('Nhà cung cấp');
  if (missing.length) fail('ERR_REQUIRED_FIELD', `Thiếu thông tin bắt buộc: ${missing.join(', ')}`);
  if (!Number.isFinite(f.requestedAmount) || f.requestedAmount <= 0) {
    fail('ERR_AMOUNT_NOT_POSITIVE', 'Tổng số tiền đề nghị phải lớn hơn 0');
  }
  if (forCreate) {
    const live = (list: { id: string; deleted: boolean }[], id: string) => list.some((x) => x.id === id && !x.deleted);
    if (
      !live(db.projects, f.projectId) ||
      !live(db.categories, f.categoryId) ||
      !live(db.requesterNames, f.requesterNameId) ||
      !live(db.vendors, f.vendorId)
    ) {
      fail('ERR_REQUIRED_FIELD', 'Có danh mục đã bị xóa hoặc không tồn tại, vui lòng chọn lại');
    }
  }
  return { ...f, title, note: f.note.trim() };
}

/** B2 has no department routing: blocked only when no Leader account is active (workflow §6.6). */
function requireLeaders(db: Db, pr: PaymentRequest): User[] {
  const list = allLeaders(db);
  if (list.length === 0) {
    fail('ERR_NO_LEADER', 'Hệ thống chưa có tài khoản Lãnh đạo đang hoạt động để duyệt B2. Đã báo Admin.', {
      title: 'Chưa có Lãnh đạo duyệt B2',
      message: `Phiếu ${pr.code} không gửi được lên B2 vì không có tài khoản Lãnh đạo đang hoạt động.`,
      requestId: pr.id,
    });
  }
  return list;
}

// ---------------------------------------------------------------------------
// Số tiền ở B6: Còn lại phải chi = Tổng đề nghị − Đã chi thêm − Đã tạm ứng.
// Cột settlementAmount giữ nguyên tên nhưng nay mang nghĩa "Đã chi thêm".
// ---------------------------------------------------------------------------

export function remainingOf(pr: PaymentRequest): number {
  if (pr.settlementAmount === null) return 0;
  return Math.max(0, pr.requestedAmount - pr.settlementAmount - (pr.advanceAmount ?? 0));
}

/** Trần của ô "Đã chi thêm"; vượt mức này thì Còn lại phải chi sẽ âm. */
export function spendBudget(requested: number, advance: number): number {
  return Math.max(0, requested - advance);
}

/** Thông báo lỗi cho ô "Đã chi thêm" ở B6, hoặc null khi giá trị hợp lệ. */
export function settlementError(requested: number, advance: number, extra: number): string | null {
  if (!Number.isFinite(extra)) return null;
  if (extra < 0) return 'Đã chi thêm không được âm';
  const budget = spendBudget(requested, advance);
  if (extra > budget) {
    return `Đã chi thêm không được lớn hơn ${budget.toLocaleString('vi-VN')} ₫ (Tổng đề nghị − Đã tạm ứng)`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// perform()
// ---------------------------------------------------------------------------

export function perform(input: Db, actorId: string, action: WorkflowAction, now: Date): { db: Db; result: WorkflowResult } {
  const db: Db = structuredClone(input);
  const actor = getActor(db, actorId);
  const result = apply(db, actor, action, now);
  return { db, result };
}

function guard(db: Db, actor: User, id: string, version: number, key: RequestActionKey): PaymentRequest {
  const pr = getRequest(db, id);
  authorize(db, actor, pr, key);
  checkVersion(pr, version);
  return pr;
}

function apply(db: Db, actor: User, action: WorkflowAction, now: Date): WorkflowResult {
  const me = actor.id;
  switch (action.type) {
    // ----- B1 --------------------------------------------------------------
    case 'CREATE_REQUEST': {
      if (!['REQUESTER', 'ADMIN'].includes(actor.role)) {
        fail('ERR_FORBIDDEN', 'Chỉ nhân viên cung ứng (hoặc Admin) được tạo phiếu');
      }
      const fields = validateDraftFields(db, action.fields, true);
      let assignedRequesterId = me;
      if (isAdmin(actor)) {
        const target = findUser(db, action.assignedRequesterId) ?? requesters(db)[0];
        if (!target || target.status !== 'ACTIVE' || target.role !== 'REQUESTER') {
          fail('ERR_REQUIRED_FIELD', 'Admin tạo phiếu phải chọn nhân viên cung ứng phụ trách');
        }
        assignedRequesterId = target.id;
      }
      const pr: PaymentRequest = {
        id: nextId(db, 'pr'),
        code: nextRequestCode(db, now),
        status: 'DRAFT',
        version: 1,
        createdBy: me,
        createdByRole: actor.role,
        assignedRequesterId,
        assignedAccountantId: null,
        accountantNameId: null,
        ...fields,
        advanceAmount: null,
        settlementAmount: null,
        priority: null,
        invoiceDueStartAt: null,
        lateInvoice: false,
        lastLateReminderOn: null,
        resubmitted: false,
        transactions: [],
        timeline: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: null,
        archivedAt: null,
      };
      pr.timeline.push({
        id: nextId(db, 'tl'),
        action: 'CREATE',
        fromStatus: null,
        toStatus: 'DRAFT',
        actorId: me,
        reason: null,
        createdAt: now.toISOString(),
      });
      db.requests.push(pr);
      audit(db, me, 'CREATE', 'payment_request', pr.id, `Tạo phiếu ${pr.code}`, now);
      return { requestId: pr.id, message: `Đã lưu nháp phiếu ${pr.code}` };
    }

    case 'UPDATE_INFO': {
      const pr = guard(db, actor, action.id, action.version, 'EDIT_DRAFT');
      const fields = validateDraftFields(db, action.fields, false);
      Object.assign(pr, fields);
      touch(pr, now);
      audit(db, me, 'UPDATE', 'payment_request', pr.id, `Cập nhật thông tin phiếu ${pr.code}`, now);
      return { requestId: pr.id, message: 'Đã lưu thông tin phiếu' };
    }

    // ----- Attachments -----------------------------------------------------
    case 'ATTACH': {
      const pr = getRequest(db, action.id);
      if (!canUploadToSlot(actor, pr, action.slot)) {
        fail('ERR_FILE_LOCKED', `Ô "${SLOT_DEF[action.slot].label}" không mở cho bạn ở bước hiện tại`);
      }
      if (action.files.length === 0) fail('ERR_REQUIRED_FIELD', 'Chưa chọn file');
      const folder = SLOT_DEF[action.slot].folder;
      // Names are unique per request folder of the day (workflow §8.3).
      const taken = new Set(
        db.attachments.filter((a) => a.requestId === pr.id && a.folder === folder).map((a) => a.fileName),
      );
      const created: Attachment[] = action.files.map((f) => {
        validateUpload(f.fileName, f.size, db.config);
        const fileName = buildFileName(f.fileName, now, taken);
        taken.add(fileName);
        return {
          id: nextId(db, 'att'),
          requestId: pr.id,
          slot: action.slot,
          stage: pr.status,
          folder,
          fileName,
          storagePath: buildStoragePath(folder, pr.code, fileName, now),
          size: f.size,
          mimeType: f.mimeType || 'application/octet-stream',
          uploadedBy: me,
          uploadedAt: now.toISOString(),
        };
      });
      db.attachments.push(...created);
      touch(pr, now);
      audit(db, me, 'UPLOAD', 'attachment', pr.id, `${pr.code}: tải lên ${created.length} file vào "${SLOT_DEF[action.slot].label}"`, now);
      return { requestId: pr.id, attachments: created, message: `Đã tải lên ${created.length} file` };
    }

    case 'DETACH': {
      const att = db.attachments.find((a) => a.id === action.attachmentId);
      if (!att) fail('ERR_NOT_FOUND', 'Không tìm thấy file');
      const pr = getRequest(db, att.requestId);
      if (!canDeleteAttachment(actor, pr, att)) fail('ERR_FILE_LOCKED', 'File đã bị khóa theo bước, không thể xóa');
      db.attachments = db.attachments.filter((a) => a.id !== att.id);
      touch(pr, now);
      audit(db, me, 'DELETE_FILE', 'attachment', pr.id, `${pr.code}: xóa file "${att.fileName}"`, now);
      return { requestId: pr.id, removedAttachmentIds: [att.id], message: 'Đã xóa file' };
    }

    // ----- T1 / T2 ---------------------------------------------------------
    case 'SUBMIT': {
      const pr = guard(db, actor, action.id, action.version, 'SUBMIT');
      requireTick(action.confirmed, 'Gửi Lãnh đạo');
      validateDraftFields(db, pr, false);
      requireSlots(db, pr, ['REQUEST_FORM', 'QUOTATION_COMPARISON']);
      const list = requireLeaders(db, pr);
      transition(db, pr, 'T1', 'LEADER_APPROVAL', me, null, now);
      notify(
        db,
        list.map((l) => l.id),
        pr.id,
        'Phiếu chờ Lãnh đạo duyệt (B2)',
        `${pr.code} – ${pr.title}${pr.resubmitted ? ' (gửi lại)' : ''}`,
        now,
      );
      audit(db, me, 'T1', 'payment_request', pr.id, `${pr.code}: gửi Lãnh đạo`, now);
      return { requestId: pr.id, message: 'Đã gửi Lãnh đạo duyệt (B2)' };
    }

    case 'CANCEL': {
      // Hủy đơn chỉ có ở B1 và không cần nhập lý do (workflow §6.5). Phiếu ở B1
      // chưa ai duyệt, chưa phát sinh tiền hay trách nhiệm, nên giữ lại một bản
      // ghi "Đã hủy" chỉ làm rác hàng đợi "Phiếu của tôi". Xóa hẳn, đúng tinh
      // thần "hủy rồi thì tạo phiếu mới".
      const pr = guard(db, actor, action.id, action.version, 'CANCEL');
      const removed = db.attachments.filter((a) => a.requestId === pr.id).map((a) => a.id);
      db.requests = db.requests.filter((r) => r.id !== pr.id);
      db.attachments = db.attachments.filter((a) => a.requestId !== pr.id);
      db.comments = db.comments.filter((c) => c.requestId !== pr.id);
      db.notifications = db.notifications.filter((n) => n.requestId !== pr.id);
      // Vẫn ghi nhật ký: phiếu biến mất khỏi giao diện nhưng Admin tra được ai hủy.
      audit(db, me, 'T2', 'payment_request', pr.id, `${pr.code}: hủy ở B1 — xóa khỏi hệ thống`, now);
      return { removedAttachmentIds: removed, message: `Đã hủy và xóa phiếu ${pr.code}` };
    }

    // ----- B2 --------------------------------------------------------------
    case 'LEADER_APPROVE': {
      const pr = guard(db, actor, action.id, action.version, 'LEADER_APPROVE');
      requireTick(action.confirmed, 'Lãnh đạo duyệt');
      transition(db, pr, 'T3', 'ADVANCE_PREPARATION', me, action.note?.trim() || null, now);
      notify(db, [pr.assignedRequesterId], pr.id, 'Lãnh đạo đã duyệt', `${pr.code}: mời nộp hồ sơ tạm ứng (B3)`, now);
      audit(db, me, 'T3', 'payment_request', pr.id, `${pr.code}: Lãnh đạo duyệt`, now);
      return { requestId: pr.id, message: 'Đã duyệt, chuyển B3' };
    }

    case 'LEADER_REJECT':
    case 'LEADER_RETURN': {
      const key = action.type;
      const pr = guard(db, actor, action.id, action.version, key);
      const reject = key === 'LEADER_REJECT';
      const reason = requireReason(action.reason, reject ? 'lý do từ chối' : 'nội dung cần bổ sung');
      transition(db, pr, reject ? 'T4' : 'T5', reject ? 'REJECTED' : 'DRAFT', me, reason, now);
      if (!reject) pr.resubmitted = true;
      notify(
        db,
        [pr.assignedRequesterId],
        pr.id,
        reject ? 'Lãnh đạo từ chối phiếu' : 'Lãnh đạo trả lại phiếu',
        `${pr.code}: ${reason}`,
        now,
      );
      audit(db, me, reject ? 'T4' : 'T5', 'payment_request', pr.id, `${pr.code}: ${reject ? 'từ chối' : 'trả lại'} – ${reason}`, now);
      return { requestId: pr.id, message: reject ? 'Đã từ chối phiếu' : 'Đã trả phiếu về B1' };
    }

    // ----- B3 --------------------------------------------------------------
    case 'SUBMIT_ADVANCE': {
      const pr = guard(db, actor, action.id, action.version, 'SUBMIT_ADVANCE');
      requireTick(action.confirmed, 'Hoàn tất HS tạm ứng');
      const amt = action.advanceAmount;
      if (!Number.isFinite(amt) || amt <= 0) fail('ERR_ADV_ZERO', 'Số tiền tạm ứng phải lớn hơn 0');
      if (amt > pr.requestedAmount) fail('ERR_ADV_EXCEED_TOTAL', 'Số tiền tạm ứng không được vượt Tổng đề nghị');
      requireSlots(db, pr, ['PURCHASE_ORDER', 'ADVANCE_REQUEST']);
      pr.advanceAmount = amt;
      transition(db, pr, 'T6', 'COORDINATION', me, null, now);
      notify(
        db,
        db.users.filter((u) => u.role === 'FINANCE_MANAGER' && u.status === 'ACTIVE').map((u) => u.id),
        pr.id,
        'Phiếu chờ TPTC duyệt (B4)',
        `${pr.code} – ${pr.title}`,
        now,
      );
      audit(db, me, 'T6', 'payment_request', pr.id, `${pr.code}: hoàn tất HS tạm ứng`, now);
      return { requestId: pr.id, message: 'Đã hoàn tất hồ sơ tạm ứng, chuyển TPTC (B4)' };
    }

    // ----- B4: TPTC duyệt và chuyển Kế toán (workflow §5.3) -----------------
    case 'FINANCE_APPROVE': {
      const pr = guard(db, actor, action.id, action.version, 'FINANCE_APPROVE');
      requireTick(action.confirmed, 'TPTC duyệt và chuyển Kế toán');
      if (!action.priority) fail('ERR_REQUIRED_FIELD', 'Chọn Độ ưu tiên');
      if (!action.accountantNameId) fail('ERR_REQUIRED_FIELD', 'Chọn Nhân viên kế toán tiếp nhận');
      const who = db.accountantNames.find((x) => x.id === action.accountantNameId && !x.deleted);
      if (!who) fail('ERR_NOT_FOUND', 'Nhân viên kế toán không hợp lệ hoặc đã bị xóa');
      const accountant = theAccountant(db);
      if (!accountant) {
        fail('ERR_NO_ACCOUNTANT', 'Không còn tài khoản Kế toán đang hoạt động. Đã báo Admin.', {
          title: 'Chưa có Kế toán nhận phiếu',
          message: `Phiếu ${pr.code} không chuyển được sang B5 vì không có tài khoản Kế toán đang hoạt động.`,
          requestId: pr.id,
        });
      }
      pr.assignedAccountantId = accountant.id;
      pr.accountantNameId = action.accountantNameId;
      pr.priority = action.priority;
      const note = action.note?.trim();
      transition(db, pr, 'T7', 'ADVANCE_PAYMENT', me, note || null, now);
      if (note) addComment(db, pr, me, `[TÀI CHÍNH ĐIỀU PHỐI] ${note}`, [accountant.id], now);
      notify(
        db,
        [accountant.id],
        pr.id,
        'Phiếu đã chuyển cho bạn để thực hiện tạm ứng (B5)',
        `${pr.code} – ưu tiên ${PRIORITY_LABEL[action.priority]}, TPTC giao cho ${who.name}`,
        now,
      );
      audit(db, me, 'T7', 'payment_request', pr.id, `${pr.code}: TPTC duyệt, giao ${who.name}`, now);
      return { requestId: pr.id, message: `Đã duyệt và giao phiếu cho ${who.name} (B5)` };
    }

    // ----- B5 --------------------------------------------------------------
    case 'PAY_ADVANCE': {
      const pr = guard(db, actor, action.id, action.version, 'PAY_ADVANCE');
      requireTick(action.checkedDocs, 'Đã kiểm tra hồ sơ');
      requireTick(action.paid, 'Đã thanh toán tạm ứng');
      if (!action.method) fail('ERR_REQUIRED_FIELD', 'Chọn hình thức chi');
      if (!action.paidDate) fail('ERR_REQUIRED_FIELD', 'Nhập ngày chi');
      requireSlots(db, pr, ['ADVANCE_PROOF']);
      pr.transactions.push({
        id: nextId(db, 'txn'),
        kind: 'ADVANCE',
        amount: pr.advanceAmount ?? 0,
        method: action.method,
        paidDate: action.paidDate,
        createdBy: me,
        createdAt: now.toISOString(),
      });
      transition(db, pr, 'T8', 'AFTER_ADVANCE', me, null, now);
      notify(db, [pr.assignedRequesterId], pr.id, 'Đã chi tạm ứng', `${pr.code}: mời hoàn tất hồ sơ ĐN thanh toán (B6)`, now);
      audit(db, me, 'T8', 'payment_request', pr.id, `${pr.code}: đã chi tạm ứng`, now);
      return { requestId: pr.id, message: 'Đã ghi nhận chi tạm ứng (B6)' };
    }

    // ----- B6 --------------------------------------------------------------
    case 'SUBMIT_SETTLEMENT': {
      const pr = guard(db, actor, action.id, action.version, 'SUBMIT_SETTLEMENT');
      requireTick(action.confirmed, 'Hoàn tất HS ĐN thanh toán');
      const amt = action.settlementAmount;
      // 0 là hợp lệ: không chi thêm đồng nào ngoài khoản đã tạm ứng.
      if (!Number.isFinite(amt) || amt < 0) fail('ERR_REQUIRED_FIELD', 'Nhập số tiền Đã chi thêm (0 nếu không chi thêm)');
      const adv = pr.advanceAmount ?? 0;
      const budget = spendBudget(pr.requestedAmount, adv);
      if (amt > budget) {
        fail('ERR_SETTLE_OVER_BUDGET', `Đã chi thêm không được lớn hơn ${budget.toLocaleString('vi-VN')} ₫ (Tổng đề nghị − Đã tạm ứng)`);
      }
      requireSlots(db, pr, ['DELIVERY_RECORD', 'PAYMENT_REQUEST_DOC']);
      pr.settlementAmount = amt;
      transition(db, pr, 'T9', 'FINAL_PAYMENT', me, null, now);
      notify(
        db,
        [pr.assignedAccountantId],
        pr.id,
        'Phiếu chờ thanh toán (B7)',
        `${pr.code}: còn lại phải chi ${remainingOf(pr).toLocaleString('vi-VN')} ₫`,
        now,
      );
      audit(db, me, 'T9', 'payment_request', pr.id, `${pr.code}: hoàn tất HS ĐN thanh toán`, now);
      return { requestId: pr.id, message: 'Đã gửi kế toán thanh toán (B7)' };
    }

    // ----- B7 → AUTO_VERIFY → COMPLETED | B8 (one atomic step) -------------
    case 'PAY_FINAL': {
      const pr = guard(db, actor, action.id, action.version, 'PAY_FINAL');
      requireTick(action.checkedDocs, 'Đã kiểm tra HS hoàn ứng');
      requireTick(action.completed, 'HOÀN THÀNH');
      if (!action.paidDate) fail('ERR_REQUIRED_FIELD', 'Nhập ngày chi');
      const remaining = remainingOf(pr);
      if (remaining > 0) {
        if (!action.method) fail('ERR_REQUIRED_FIELD', 'Chọn hình thức chi đợt cuối');
        if (slotFiles(db, pr, 'FINAL_PROOF').length === 0) {
          fail('ERR_FINAL_NO_PROOF', 'Còn lại > 0: bắt buộc đính kèm UNC / Phiếu chi đợt cuối');
        }
        pr.transactions.push({
          id: nextId(db, 'txn'),
          kind: 'FINAL',
          amount: remaining,
          method: action.method,
          paidDate: action.paidDate,
          createdBy: me,
          createdAt: now.toISOString(),
        });
      }
      transition(db, pr, 'T10', null, me, null, now);
      const hasInvoiceFile = slotFiles(db, pr, 'INVOICE').length > 0;
      if (!pr.hasInvoice || hasInvoiceFile) {
        transition(db, pr, 'T11', 'COMPLETED', null, null, now);
        notify(db, [pr.assignedRequesterId], pr.id, 'Phiếu đã hoàn thành', `${pr.code} – ${pr.title}`, now);
      } else {
        transition(db, pr, 'T12', 'DOCUMENT_SUPPLEMENT_REQUIRED', null, null, now);
        pr.invoiceDueStartAt = now.toISOString();
        notify(
          db,
          [pr.assignedRequesterId],
          pr.id,
          'Cần bổ sung hóa đơn (B8)',
          `${pr.code}: đã thanh toán dứt điểm, hạn nộp hóa đơn ${db.config.invoiceDeadlineWorkingDays} ngày làm việc`,
          now,
        );
      }
      audit(db, me, 'T10', 'payment_request', pr.id, `${pr.code}: thanh toán đợt cuối → ${pr.status}`, now);
      return {
        requestId: pr.id,
        status: pr.status,
        message: pr.status === 'COMPLETED' ? 'Phiếu đã Hoàn thành' : 'Đã thanh toán; phiếu chuyển B8 chờ bổ sung hóa đơn',
      };
    }

    // ----- B8 --------------------------------------------------------------
    case 'COMPLETE_INVOICE': {
      const pr = guard(db, actor, action.id, action.version, 'COMPLETE_INVOICE');
      requireSlots(db, pr, ['INVOICE']);
      transition(db, pr, 'T13', 'COMPLETED', me, null, now);
      pr.lateInvoice = false;
      notify(db, [pr.assignedAccountantId], pr.id, 'Đã bổ sung hóa đơn', `${pr.code}: mời đối chiếu hóa đơn`, now);
      audit(db, me, 'T13', 'payment_request', pr.id, `${pr.code}: bổ sung hóa đơn → Hoàn thành`, now);
      return { requestId: pr.id, message: 'Đã bổ sung hóa đơn — phiếu Hoàn thành' };
    }

    // ----- A4 (Admin) ------------------------------------------------------
    case 'TRANSFER': {
      const reason = requireReason(action.reason);
      if (action.items.length === 0) fail('ERR_REQUIRED_FIELD', 'Chưa chọn phiếu cần chuyển giao');
      const target = findUser(db, action.toRequesterId);
      if (!target || target.status !== 'ACTIVE' || target.role !== 'REQUESTER') {
        fail('ERR_REQUIRED_FIELD', 'Người nhận phải là nhân viên cung ứng đang hoạt động');
      }
      const prs = action.items.map((it) => guard(db, actor, it.id, it.version, 'TRANSFER'));
      for (const pr of prs) {
        if (pr.assignedRequesterId === target.id) fail('ERR_REQUIRED_FIELD', `${pr.code} đang thuộc nhân viên này`);
      }
      for (const pr of prs) {
        const oldId = pr.assignedRequesterId;
        pr.assignedRequesterId = target.id;
        timelineNote(db, pr, 'A4', me, `${findUser(db, oldId)?.fullName ?? '?'} → ${target.fullName}: ${reason}`, now);
        notify(db, [oldId, target.id], pr.id, 'Chuyển giao phiếu', `${pr.code} chuyển sang ${target.fullName}`, now);
        audit(db, me, 'A4', 'payment_request', pr.id, `${pr.code}: chuyển giao → ${target.username} – ${reason}`, now);
      }
      return { message: `Đã chuyển giao ${prs.length} phiếu cho ${target.fullName}` };
    }

    // ----- A1 / A2 / A3 / delete (Admin, warn but never block) -------------
    case 'FORCE': {
      const pr = guard(db, actor, action.id, action.version, 'FORCE');
      const reason = requireReason(action.reason);
      const to = action.toStatus;
      if (to === pr.status) fail('ERR_INVALID_TRANSITION', 'Trạng thái đích trùng trạng thái hiện tại');
      const warning = paymentSkipWarning(pr, to);
      if ((to === 'ADVANCE_PAYMENT' || to === 'FINAL_PAYMENT') && !pr.assignedAccountantId) {
        pr.assignedAccountantId = theAccountant(db)?.id ?? null;
      }
      transition(db, pr, 'A1', to, me, reason, now);
      if (to === 'DOCUMENT_SUPPLEMENT_REQUIRED' && !pr.invoiceDueStartAt) pr.invoiceDueStartAt = now.toISOString();
      notify(db, [pr.assignedRequesterId, pr.assignedAccountantId], pr.id, 'Admin ép chuyển bước', `${pr.code} → ${stepText(to)}: ${reason}`, now);
      audit(db, me, 'A1', 'payment_request', pr.id, `${pr.code}: ép chuyển → ${to} – ${reason}`, now);
      return { requestId: pr.id, message: `Đã chuyển phiếu sang ${stepText(to)}`, warning };
    }

    case 'ADMIN_CANCEL': {
      const pr = guard(db, actor, action.id, action.version, 'ADMIN_CANCEL');
      const reason = requireReason(action.reason);
      const warning = pr.transactions.length
        ? `Phiếu đã phát sinh ${pr.transactions.length} giao dịch chi — cần đối chiếu lại sổ quỹ.`
        : undefined;
      transition(db, pr, 'A2', 'CANCELLED', me, reason, now);
      notify(db, [pr.assignedRequesterId, pr.assignedAccountantId], pr.id, 'Admin hủy phiếu', `${pr.code}: ${reason}`, now);
      audit(db, me, 'A2', 'payment_request', pr.id, `${pr.code}: Admin hủy – ${reason}`, now);
      return { requestId: pr.id, message: 'Đã hủy phiếu', warning };
    }

    case 'REOPEN': {
      const pr = guard(db, actor, action.id, action.version, 'REOPEN');
      const reason = requireReason(action.reason);
      const to = action.toStatus ?? 'DRAFT';
      transition(db, pr, 'A3', to, me, reason, now);
      if (to === 'DRAFT') pr.resubmitted = true;
      notify(db, [pr.assignedRequesterId, pr.assignedAccountantId], pr.id, 'Admin mở lại phiếu', `${pr.code} → ${stepText(to)}: ${reason}`, now);
      audit(db, me, 'A3', 'payment_request', pr.id, `${pr.code}: mở lại → ${to} – ${reason}`, now);
      return { requestId: pr.id, message: `Đã mở lại phiếu về ${stepText(to)}` };
    }

    case 'DELETE_REQUEST': {
      const pr = guard(db, actor, action.id, action.version, 'DELETE');
      const reason = requireReason(action.reason);
      const removed = db.attachments.filter((a) => a.requestId === pr.id).map((a) => a.id);
      db.requests = db.requests.filter((r) => r.id !== pr.id);
      db.attachments = db.attachments.filter((a) => a.requestId !== pr.id);
      db.comments = db.comments.filter((c) => c.requestId !== pr.id);
      audit(db, me, 'DELETE', 'payment_request', pr.id, `Xóa phiếu ${pr.code} – ${reason}`, now);
      return { removedAttachmentIds: removed, message: `Đã xóa phiếu ${pr.code}` };
    }

    // ----- Lưu trữ (A5) ----------------------------------------------------
    // Chế độ demo trên trình duyệt không có NAS, nên chỉ đổi nhãn; file vẫn nằm
    // trong IndexedDB. Việc dọn đĩa thật do máy chủ làm khi chạy cùng backend.
    case 'ARCHIVE': {
      const pr = guard(db, actor, action.id, action.version, 'ARCHIVE');
      if (pr.archivedAt) throw new DomainError('ERR_ALREADY_ARCHIVED', `Phiếu ${pr.code} đã được lưu trữ trước đó`);
      pr.archivedAt = now.toISOString();
      pr.version += 1;
      audit(db, me, 'ARCHIVE', 'payment_request', pr.id, `Lưu trữ ${pr.code}: dọn file đính kèm khỏi máy chủ`, now);
      return { message: `Đã lưu trữ phiếu ${pr.code}` };
    }

    case 'RESTORE': {
      const pr = guard(db, actor, action.id, action.version, 'RESTORE');
      if (!pr.archivedAt) throw new DomainError('ERR_NOT_ARCHIVED', `Phiếu ${pr.code} chưa được lưu trữ`);
      pr.archivedAt = null;
      pr.version += 1;
      audit(db, me, 'RESTORE', 'payment_request', pr.id, `Phục hồi ${pr.code} từ NAS`, now);
      return { message: `Đã phục hồi phiếu ${pr.code}` };
    }

    // ----- Comments --------------------------------------------------------
    case 'COMMENT': {
      const pr = getRequest(db, action.id);
      authorize(db, actor, pr, 'COMMENT');
      const content = action.content.trim();
      if (!content) fail('ERR_REQUIRED_FIELD', 'Nội dung comment trống');
      const handles = [...content.matchAll(/@([A-Za-z0-9._-]+)/g)].map((m) => m[1].toLowerCase());
      const mentioned = db.users.filter((u) => handles.includes(u.username.toLowerCase()) && u.id !== me);
      addComment(db, pr, me, content, mentioned.map((u) => u.id), now);
      notify(db, mentioned.map((u) => u.id), pr.id, `${actor.fullName} nhắc đến bạn`, `${pr.code}: ${content.slice(0, 120)}`, now);
      audit(db, me, 'COMMENT', 'payment_request', pr.id, `${pr.code}: comment`, now);
      return { requestId: pr.id, message: 'Đã gửi comment' };
    }

    // ----- Completed-request document audit --------------------------------
    case 'NOTIFY_MISSING_DOCS': {
      const pr = getRequest(db, action.id);
      const result = checkCompletedAttachments(db, pr);
      if (result.isComplete) {
        return { requestId: pr.id, message: 'Phiếu đã có đầy đủ chứng từ, không cần gửi thông báo' };
      }
      const missingLabels = result.missingDocuments.map((m) => `${m.label} (${m.department})`).join(', ');
      const targets = new Set<string>();
      const departments: string[] = [];
      if (result.hasProcurementMissing) {
        departments.push('Phòng Cung Ứng');
        if (pr.assignedRequesterId) targets.add(pr.assignedRequesterId);
      }
      if (result.hasAccountingMissing) {
        departments.push('Phòng Kế Toán');
        if (pr.assignedAccountantId) targets.add(pr.assignedAccountantId);
        for (const a of accountants(db)) targets.add(a.id);
      }
      const note = action.note?.trim();
      notify(
        db,
        [...targets],
        pr.id,
        'Yêu cầu bổ sung chứng từ phiếu hoàn thành',
        `${pr.code}: Thiếu ${missingLabels}. ${note || 'Vui lòng kiểm tra và bổ sung chứng từ còn thiếu.'}`,
        now,
      );
      const lines = result.missingDocuments.map((d) => `- ${d.label} [${d.department}]: ${d.description}`).join('\n');
      addComment(
        db,
        pr,
        me,
        `[KIỂM TRA CHỨNG TỪ HOÀN THÀNH]\nPhiếu đã hoàn thành nhưng thiếu các chứng từ sau:\n${lines}\n${note ? `Ghi chú đôn đốc: ${note}\n` : ''}Đề nghị ${departments.join(' và ')} kiểm tra và bổ sung theo quy định.`,
        [...targets],
        now,
      );
      audit(db, me, 'NOTIFY_MISSING_DOCS', 'payment_request', pr.id, `${pr.code}: thông báo thiếu chứng từ tới ${departments.join(', ')}`, now);
      return { requestId: pr.id, message: `Đã gửi thông báo thiếu chứng từ tới ${departments.join(' và ')}` };
    }
  }
}

/**
 * A1 may move a request past a money-out step that has no transaction yet.
 * Per workflow §5.2 this only warns — Admin is never blocked.
 */
export function paymentSkipWarning(pr: PaymentRequest, to: Status): string | undefined {
  const target = stepIndex(to);
  if (target < 0) return undefined;
  const hasAdvance = pr.transactions.some((t) => t.kind === 'ADVANCE');
  const hasFinal = pr.transactions.some((t) => t.kind === 'FINAL');
  if (target > stepIndex('ADVANCE_PAYMENT') && !hasAdvance) {
    return 'Phiếu vượt qua bước chi tạm ứng (B5) mà chưa có giao dịch chi nào được ghi nhận.';
  }
  if (target > stepIndex('FINAL_PAYMENT') && !hasFinal && remainingOf(pr) > 0) {
    return 'Phiếu vượt qua bước thanh toán (B7) mà chưa có giao dịch chi đợt cuối.';
  }
  return undefined;
}

/** Statuses Admin may force a request into (A1). */
export const FORCE_TARGETS: Status[] = [...WORKING_STATUSES, 'COMPLETED', 'CANCELLED', 'REJECTED'];

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export { admins };
