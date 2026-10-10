// The checkpoint panel for the request's current step (workflow §5.1).
// A button only appears when domain/permissions allows that action for the signed-in role.
import { useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, MessageSquareWarning, Settings2 } from 'lucide-react';
import { navigate } from '../../app/router';
import { useDb, useMe, useNow } from '../../data/hooks';
import { store } from '../../data/store';
import { METHOD_LABEL, PRIORITY_LABEL, SLOT_DEF, STATUS_LABEL, STATUS_STEP } from '../../domain/constants';
import { invoiceCountdown, toDateKey } from '../../domain/dates';
import { can, canManageMaster, leaders as allLeaders, theAccountant, type RequestActionKey } from '../../domain/permissions';
import type { PaymentMethod, PaymentRequest, Priority, Slot } from '../../domain/types';
import { remainingOf, settlementError, spendBudget } from '../../domain/workflow';
import { cx, formatDate, formatMoney } from '../../lib/format';
import { masterName, userName } from '../../lib/lookup';
import { Button, Card, Checkpoint, Field, Input, Modal, MoneyInput, Notice, Select, Textarea } from '../../ui/primitives';
import { attempt } from '../../ui/toast';
import { MasterDataPanel } from '../master-data/MasterDataPanel';
import { AttachmentSlot } from './Attachments';
import { ReasonDialog, type ReasonRequest } from './ReasonDialog';

/** Tên nhân viên Kế toán do TPTC chỉ định ở B4, hiện trên mọi form bên Kế toán. */
function AssignedAccountant({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  if (!pr.accountantNameId) return null;
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
      Kế toán phụ trách: <span className="font-medium text-slate-900">{masterName(db, 'accountantNames', pr.accountantNameId)}</span>
      <span className="text-slate-500"> — do Trưởng phòng Tài chính chỉ định ở B4</span>
    </p>
  );
}

function Panel({ title, children, tone = 'brand' }: { title: ReactNode; children: ReactNode; tone?: 'brand' | 'amber' }) {
  return (
    <Card className={cx('overflow-hidden', tone === 'brand' ? 'border-brand-200' : 'border-amber-200')}>
      <div className={cx('border-b px-5 py-3', tone === 'brand' ? 'border-brand-100 bg-brand-50/60' : 'border-amber-100 bg-amber-50/60')}>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </Card>
  );
}

function Checklist({ items }: { items: { ok: boolean; label: ReactNode }[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {items.map((it, i) => (
        <li key={i} className={cx('flex items-center gap-2', it.ok ? 'text-emerald-700' : 'text-slate-600')}>
          {it.ok ? <CheckCircle2 className="h-4 w-4" /> : <CircleDashed className="h-4 w-4 text-slate-400" />}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function useHasFiles(pr: PaymentRequest) {
  const db = useDb();
  return (slot: Slot) => db.attachments.some((a) => a.requestId === pr.id && a.slot === slot);
}

function run(action: Parameters<typeof store.run>[0]) {
  return attempt(() => store.run(action));
}

function NoReturnHint() {
  return (
    <p className="flex items-center gap-2 text-xs text-slate-500">
      <MessageSquareWarning className="h-3.5 w-3.5" /> Kế toán không có nút trả lại — thiếu sót thì comment @ người phụ trách ở khung bên phải.
    </p>
  );
}

function WaitingNotice({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  let who: string;
  switch (pr.status) {
    case 'LEADER_APPROVAL':
      who = allLeaders(db).map((l) => l.fullName).join(' hoặc ') || 'Lãnh đạo (chưa có tài khoản — báo Admin)';
      break;
    case 'COORDINATION':
      who = 'Trưởng phòng Tài chính';
      break;
    case 'ADVANCE_PAYMENT':
    case 'FINAL_PAYMENT':
      who = userName(db, pr.assignedAccountantId);
      break;
    default:
      who = userName(db, pr.assignedRequesterId);
  }
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm">
      <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
      <p className="text-slate-600">
        Phiếu đang ở{' '}
        <b className="text-slate-900">
          {STATUS_STEP[pr.status]} · {STATUS_LABEL[pr.status]}
        </b>
        , chờ <b className="text-slate-900">{who}</b> xử lý. Bạn xem và tải được mọi file; góp ý bằng comment @.
      </p>
    </div>
  );
}

export function StepActions({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const me = useMe();
  const [reason, setReason] = useState<ReasonRequest | null>(null);
  const allowed = (k: RequestActionKey) => can(db, me, pr, k);

  if (pr.status === 'COMPLETED') {
    return (
      <Notice tone="ok" title="Phiếu đã Hoàn thành">
        Các vai trò nghiệp vụ chỉ xem và tải file. Admin vẫn can thiệp được ở khung Thao tác đặc quyền.
      </Notice>
    );
  }
  if (pr.status === 'CANCELLED' || pr.status === 'REJECTED') {
    const last = [...pr.timeline].reverse().find((t) => t.toStatus === pr.status);
    return (
      <Notice tone="danger" title={pr.status === 'CANCELLED' ? 'Phiếu đã hủy' : 'Phiếu bị từ chối'}>
        {last?.reason ? <p>Lý do: {last.reason}</p> : <p>Hủy ở B1 không cần lý do — cần chi thì tạo phiếu mới.</p>}
        <p className="mt-1">Chỉ Admin mở lại được phiếu (A3).</p>
      </Notice>
    );
  }

  let body: ReactNode = null;
  switch (pr.status) {
    case 'DRAFT':
      if (allowed('SUBMIT')) body = <DraftSubmit pr={pr} onReason={setReason} />;
      break;
    case 'LEADER_APPROVAL':
      if (allowed('LEADER_REJECT')) body = <LeaderReview pr={pr} onReason={setReason} />;
      break;
    case 'ADVANCE_PREPARATION':
      if (allowed('SUBMIT_ADVANCE')) body = <AdvancePrep pr={pr} />;
      break;
    case 'COORDINATION':
      if (allowed('FINANCE_APPROVE')) body = <FinanceApprove pr={pr} />;
      break;
    case 'ADVANCE_PAYMENT':
      if (allowed('PAY_ADVANCE')) body = <PayAdvance pr={pr} />;
      break;
    case 'AFTER_ADVANCE':
      if (allowed('SUBMIT_SETTLEMENT')) body = <Settlement pr={pr} />;
      break;
    case 'FINAL_PAYMENT':
      if (allowed('PAY_FINAL')) body = <FinalPayment pr={pr} />;
      break;
    case 'DOCUMENT_SUPPLEMENT_REQUIRED':
      if (allowed('COMPLETE_INVOICE')) body = <InvoiceSupplement pr={pr} />;
      break;
  }

  return (
    <>
      {body ?? <WaitingNotice pr={pr} />}
      {pr.status === 'DOCUMENT_SUPPLEMENT_REQUIRED' && !body && <InvoiceCountdownNotice pr={pr} />}
      {reason && <ReasonDialog req={reason} onClose={() => setReason(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// B1 — NV cung ứng gửi Lãnh đạo (T1) / Hủy đơn (T2)
// ---------------------------------------------------------------------------

function DraftSubmit({ pr, onReason }: { pr: PaymentRequest; onReason: (r: ReasonRequest) => void }) {
  const db = useDb();
  const has = useHasFiles(pr);
  const [tick, setTick] = useState(false);
  const fieldsOk = !!(pr.title && pr.projectId && pr.categoryId && pr.requesterNameId && pr.vendorId);
  const noLeader = allLeaders(db).length === 0;
  const lastReturn = pr.resubmitted ? [...pr.timeline].reverse().find((t) => t.action === 'T5' || t.action === 'A3') : undefined;

  return (
    <Panel title="B1 · Gửi Lãnh đạo duyệt">
      {lastReturn && (
        <Notice tone="warn" title="Phiếu bị trả lại — cần bổ sung">
          {lastReturn.reason} <span className="opacity-70">({userName(db, lastReturn.actorId)})</span>
        </Notice>
      )}
      {noLeader && <Notice tone="danger">Chưa có tài khoản Lãnh đạo đang hoạt động — gửi sẽ bị chặn và Admin được báo.</Notice>}
      <Checklist
        items={[
          { ok: fieldsOk, label: 'Đủ thông tin bắt buộc' },
          { ok: pr.requestedAmount > 0, label: `Tổng tiền > 0 (${formatMoney(pr.requestedAmount)})` },
          ...(['REQUEST_FORM', 'QUOTATION_COMPARISON'] as Slot[]).map((s) => ({ ok: has(s), label: `File ${SLOT_DEF[s].label}` })),
        ]}
      />
      {/* Hai o tai len ngay tai cho, giong B3/B5/B6/B7. Truoc day B1 la buoc duy
          nhat chi bao "thieu file" ma khong co cho nop — phai keo xuong cuoi trang
          moi thay the "Ho so dinh kem". */}
      <div className="grid gap-2 sm:grid-cols-2">
        <AttachmentSlot pr={pr} slot="REQUEST_FORM" compact />
        <AttachmentSlot pr={pr} slot="QUOTATION_COMPARISON" compact />
      </div>
      <Checkpoint checked={tick} onChange={setTick}>
        Gửi Lãnh đạo
      </Checkpoint>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!tick} onClick={() => run({ type: 'SUBMIT', id: pr.id, version: pr.version, confirmed: tick })}>
          Gửi Lãnh đạo duyệt (B2)
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            onReason({
              title: 'Hủy đơn (T2)',
              label: 'Ghi chú (không bắt buộc)',
              confirm: 'Hủy và xóa phiếu',
              danger: true,
              optional: true,
              intro:
                'Phiếu còn ở B1, chưa ai duyệt nên sẽ bị xóa hẳn khỏi hệ thống cùng mọi tệp đã đính kèm — không để lại phiếu "Đã hủy" trong danh sách. Cần chi thì tạo phiếu mới.',
              run: async () => {
                const ok = await run({ type: 'CANCEL', id: pr.id, version: pr.version });
                // Phiếu không còn tồn tại, ở lại trang chi tiết sẽ là trang trống.
                if (ok) navigate('/procurement/my-requests');
                return ok;
              },
            })
          }
        >
          Hủy đơn
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// B2 — Lãnh đạo duyệt / từ chối / trả lại (T3, T4, T5)
// ---------------------------------------------------------------------------

function LeaderReview({ pr, onReason }: { pr: PaymentRequest; onReason: (r: ReasonRequest) => void }) {
  const me = useMe();
  const [tick, setTick] = useState(false);
  const [note, setNote] = useState('');
  const selfCreated = pr.createdBy === me.id;
  const v = { id: pr.id, version: pr.version };

  return (
    <Panel title="B2 · Lãnh đạo duyệt">
      {pr.resubmitted && <Notice tone="warn">Phiếu gửi lại sau khi bị trả về — đối chiếu dòng thời gian bên phải.</Notice>}
      {selfCreated && <Notice tone="warn">Bạn là người tạo phiếu này nên không được tự duyệt.</Notice>}
      <Field label="Ý kiến (không bắt buộc)" htmlFor="review-note">
        <Textarea id="review-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Checkpoint checked={tick} onChange={setTick} disabled={selfCreated}>
        Lãnh đạo duyệt
      </Checkpoint>
      <div className="flex flex-wrap gap-2">
        <Button variant="success" disabled={!tick || selfCreated} onClick={() => run({ type: 'LEADER_APPROVE', ...v, confirmed: tick, note })}>
          Duyệt → chuyển B3
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            onReason({
              title: 'Trả lại (T5)',
              label: 'Nội dung cần bổ sung',
              confirm: 'Trả về B1',
              intro: 'Phiếu quay về B1 của nhân viên cung ứng để sửa và gửi lại.',
              run: (reason) => run({ type: 'LEADER_RETURN', ...v, reason }),
            })
          }
        >
          Trả lại
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            onReason({
              title: 'Từ chối (T4)',
              label: 'Lý do từ chối',
              confirm: 'Từ chối phiếu',
              danger: true,
              intro: 'Phiếu kết thúc ở trạng thái Bị từ chối. Chỉ Admin mở lại được.',
              run: (reason) => run({ type: 'LEADER_REJECT', ...v, reason }),
            })
          }
        >
          Từ chối
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// B3 — Nộp hồ sơ tạm ứng (T6)
// ---------------------------------------------------------------------------

function AdvancePrep({ pr }: { pr: PaymentRequest }) {
  const has = useHasFiles(pr);
  const [amount, setAmount] = useState(pr.advanceAmount ?? 0);
  const [tick, setTick] = useState(false);
  const amountOk = amount > 0 && amount <= pr.requestedAmount;
  return (
    <Panel title="B3 · Nộp hồ sơ tạm ứng">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Số tiền tạm ứng"
          required
          htmlFor="adv"
          error={amount > pr.requestedAmount ? 'Không được vượt Tổng đề nghị' : undefined}
          hint={`0 < Tạm ứng ≤ ${formatMoney(pr.requestedAmount)}`}
        >
          <MoneyInput id="adv" value={amount} onChange={setAmount} />
        </Field>
        <div className="flex items-end">
          <Checklist
            items={[
              { ok: amountOk, label: 'Số tiền hợp lệ' },
              { ok: has('PURCHASE_ORDER'), label: 'Đơn đặt hàng' },
              { ok: has('ADVANCE_REQUEST'), label: 'Đề nghị tạm ứng' },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <AttachmentSlot pr={pr} slot="PURCHASE_ORDER" compact />
        <AttachmentSlot pr={pr} slot="ADVANCE_REQUEST" compact />
      </div>
      <Checkpoint checked={tick} onChange={setTick}>
        Hoàn tất hồ sơ tạm ứng
      </Checkpoint>
      <div>
        <Button
          disabled={!tick || !amountOk}
          onClick={() => run({ type: 'SUBMIT_ADVANCE', id: pr.id, version: pr.version, confirmed: tick, advanceAmount: amount })}
        >
          Gửi Trưởng phòng Tài chính (B4)
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// B4 — TPTC duyệt và chuyển Kế toán (T7)
// ---------------------------------------------------------------------------

function FinanceApprove({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const me = useMe();
  const accountant = theAccountant(db);
  const [priority, setPriority] = useState<Priority | ''>('');
  const [accountantNameId, setAccountantNameId] = useState(pr.accountantNameId ?? '');
  const [note, setNote] = useState('');
  const [tick, setTick] = useState(false);
  const [manage, setManage] = useState(false);
  const staff = db.accountantNames.filter((x) => !x.deleted || x.id === accountantNameId);

  return (
    <Panel title="B4 · TPTC duyệt và chuyển Kế toán">
      {!accountant && (
        <Notice tone="danger" title="Chưa có tài khoản Kế toán đang hoạt động">
          Duyệt sẽ bị chặn và Admin được báo.
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={
            <span className="flex items-center justify-between gap-2">
              Nhân viên Kế toán tiếp nhận
              {canManageMaster(me, 'accountantNames') && (
                <button
                  type="button"
                  onClick={() => setManage(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-normal text-brand-700 hover:underline"
                >
                  <Settings2 className="h-3 w-3" /> Quản lý
                </button>
              )}
            </span>
          }
          required
          htmlFor="acct-name"
          hint={accountant ? `Tên hiện trên phiếu cho cả hai bên; phiếu vẫn vào tài khoản ${accountant.username}` : undefined}
        >
          <Select id="acct-name" value={accountantNameId} onChange={(e) => setAccountantNameId(e.target.value)}>
            <option value="">— Chọn —</option>
            {staff.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Độ ưu tiên" required htmlFor="prio" hint="Dùng để sắp xếp hàng đợi B5, B7">
          <Select id="prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="">— Chọn —</option>
            {(['HIGH', 'MEDIUM', 'LOW'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú điều phối" htmlFor="coord-note" hint="Ghi vào dòng trao đổi kèm tiền tố [TÀI CHÍNH ĐIỀU PHỐI]">
          <Input id="coord-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Checkpoint checked={tick} onChange={setTick}>
        TPTC duyệt và chuyển Kế toán
      </Checkpoint>
      <div>
        <Button
          disabled={!tick || !priority || !accountantNameId || !accountant}
          onClick={() =>
            run({
              type: 'FINANCE_APPROVE',
              id: pr.id,
              version: pr.version,
              confirmed: tick,
              priority: priority || null,
              accountantNameId,
              note,
            })
          }
        >
          Duyệt và chuyển Kế toán → B5
        </Button>
      </div>
      {manage && (
        <Modal title="Danh mục Nhân viên kế toán" onClose={() => setManage(false)} wide>
          <MasterDataPanel kind="accountantNames" />
        </Modal>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// B5 — Chi tạm ứng (T8)
// ---------------------------------------------------------------------------

function PaymentFields({
  method,
  setMethod,
  date,
  setDate,
}: {
  method: PaymentMethod | '';
  setMethod: (m: PaymentMethod) => void;
  date: string;
  setDate: (d: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Hình thức chi" required htmlFor="method">
        <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          <option value="">— Chọn —</option>
          {(['TRANSFER', 'CASH'] as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Ngày chi" required htmlFor="paid-date">
        <Input id="paid-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </div>
  );
}

function PayAdvance({ pr }: { pr: PaymentRequest }) {
  const has = useHasFiles(pr);
  const [checked, setChecked] = useState(false);
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [date, setDate] = useState(toDateKey(new Date()));
  return (
    <Panel title="B5 · PKT tạm ứng">
      <AssignedAccountant pr={pr} />
      <div className="rounded-lg bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-500">Số tiền tạm ứng (từ B3, chỉ đọc)</p>
        <p className="text-xl font-semibold tabular-nums text-slate-900">{formatMoney(pr.advanceAmount)}</p>
      </div>
      <PaymentFields method={method} setMethod={setMethod} date={date} setDate={setDate} />
      <AttachmentSlot pr={pr} slot="ADVANCE_PROOF" compact />
      <div className="grid gap-2 sm:grid-cols-2">
        <Checkpoint checked={checked} onChange={setChecked}>
          Đã kiểm tra hồ sơ
        </Checkpoint>
        <Checkpoint checked={paid} onChange={setPaid}>
          Đã thanh toán tạm ứng
        </Checkpoint>
      </div>
      <NoReturnHint />
      <div>
        <Button
          disabled={!checked || !paid || !method || !date || !has('ADVANCE_PROOF')}
          onClick={() =>
            run({ type: 'PAY_ADVANCE', id: pr.id, version: pr.version, checkedDocs: checked, paid, method: method || null, paidDate: date })
          }
        >
          Xác nhận đã chi tạm ứng → B6
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// B6 — Hoàn tất hồ sơ đề nghị thanh toán (T9)
// ---------------------------------------------------------------------------

function Settlement({ pr }: { pr: PaymentRequest }) {
  const has = useHasFiles(pr);
  const [amount, setAmount] = useState(pr.settlementAmount ?? 0);
  const [tick, setTick] = useState(false);
  const adv = pr.advanceAmount ?? 0;
  // Vượt trần bị báo lỗi ngay tại ô nhập và khóa nút gửi, để Còn lại phải chi không âm.
  const amountError = settlementError(pr.requestedAmount, adv, amount);
  const budget = spendBudget(pr.requestedAmount, adv);
  const remaining = Math.max(0, pr.requestedAmount - amount - adv);

  return (
    <Panel title="B6 · Hoàn tất hồ sơ đề nghị thanh toán">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Đã chi thêm"
          required
          htmlFor="settle"
          hint={`Tối đa ${formatMoney(budget)} — để 0 nếu không chi thêm ngoài khoản tạm ứng`}
          error={amountError ?? undefined}
        >
          <MoneyInput id="settle" value={amount} onChange={setAmount} />
        </Field>
        <div className="rounded-lg bg-slate-50 px-4 py-2.5">
          <p className="text-xs text-slate-500">Đã tạm ứng</p>
          <p className="font-semibold tabular-nums">{formatMoney(adv)}</p>
        </div>
        <div className={cx('rounded-lg px-4 py-2.5', amountError ? 'bg-red-50 ring-1 ring-red-200' : 'bg-slate-50')}>
          <p className="text-xs text-slate-500">Còn lại phải chi (tự tính)</p>
          <p className="font-semibold tabular-nums">{amountError ? '—' : formatMoney(remaining)}</p>
        </div>
      </div>
      {!amountError && remaining === 0 && (
        <Notice tone="warn">
          Còn lại phải chi bằng 0 — khoản tạm ứng cộng phần đã chi thêm vừa đủ Tổng đề nghị, kế toán sẽ không chi thêm
          đồng nào ở B7.
        </Notice>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <AttachmentSlot pr={pr} slot="DELIVERY_RECORD" compact />
        <AttachmentSlot pr={pr} slot="PAYMENT_REQUEST_DOC" compact />
        <AttachmentSlot pr={pr} slot="INVOICE" compact />
      </div>
      <Checklist
        items={[
          { ok: !amountError, label: 'Đã chi thêm trong trần cho phép' },
          { ok: has('DELIVERY_RECORD'), label: 'BNH' },
          { ok: has('PAYMENT_REQUEST_DOC'), label: 'ĐNTT' },
          { ok: !pr.hasInvoice || has('INVOICE'), label: pr.hasInvoice ? 'Hóa đơn (có thể bổ sung sau ở B7, B8)' : 'Loại chi Không hóa đơn' },
        ]}
      />
      <Checkpoint checked={tick} onChange={setTick}>
        Hoàn tất HS ĐN thanh toán
      </Checkpoint>
      <div>
        <Button
          disabled={!tick || !!amountError}
          onClick={() => run({ type: 'SUBMIT_SETTLEMENT', id: pr.id, version: pr.version, confirmed: tick, settlementAmount: amount })}
        >
          Gửi kế toán thanh toán → B7
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// B7 → AUTO_VERIFY → COMPLETED | B8 (T10 → T11/T12)
// ---------------------------------------------------------------------------

export function AmountsTable({ pr }: { pr: PaymentRequest }) {
  const over =
    pr.settlementAmount !== null && pr.settlementAmount > spendBudget(pr.requestedAmount, pr.advanceAmount ?? 0);
  const cells: [string, number | null, boolean?][] = [
    ['Tổng đề nghị', pr.requestedAmount],
    ['Đã tạm ứng', pr.advanceAmount],
    ['Đã chi thêm', pr.settlementAmount, over],
    ['Còn lại phải chi', pr.settlementAmount !== null ? remainingOf(pr) : null],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map(([label, v, warn]) => (
        <div key={label} className={cx('rounded-lg px-3 py-2.5', warn ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50')}>
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className={cx('font-semibold tabular-nums', warn ? 'text-amber-800' : 'text-slate-900')}>{formatMoney(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function FinalPayment({ pr }: { pr: PaymentRequest }) {
  const has = useHasFiles(pr);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const remaining = remainingOf(pr);
  const budget = spendBudget(pr.requestedAmount, pr.advanceAmount ?? 0);
  const over = (pr.settlementAmount ?? 0) > budget;
  const goesToB8 = pr.hasInvoice && !has('INVOICE');
  // Còn tiền phải chi thì bắt buộc có chứng từ chi đợt cuối mới được bấm HOÀN THÀNH.
  // Backend chặn lại bằng ERR_FINAL_NO_PROOF nếu ai đó gọi thẳng API.
  const needsProof = remaining > 0;
  const blockers: string[] = [];
  if (needsProof && !has('FINAL_PROOF')) blockers.push('UNC / Phiếu chi thanh toán đợt cuối');
  if (needsProof && !method) blockers.push('Hình thức chi');
  if (!date) blockers.push('Ngày chi');
  if (!checked) blockers.push('Tick “Đã kiểm tra HS hoàn ứng”');
  if (!done) blockers.push('Tick “HOÀN THÀNH”');
  const ready = blockers.length === 0;

  return (
    <Panel title="B7 · PKT thanh toán">
      <AssignedAccountant pr={pr} />
      <AmountsTable pr={pr} />
      {over && (
        <Notice tone="warn" title="Đã chi thêm vượt trần">
          Vượt {formatMoney((pr.settlementAmount ?? 0) - budget)} so với Tổng đề nghị − Đã tạm ứng. Kiểm tra kỹ trước
          khi chi.
        </Notice>
      )}
      {remaining > 0 ? (
        <>
          <PaymentFields method={method} setMethod={setMethod} date={date} setDate={setDate} />
          <AttachmentSlot pr={pr} slot="FINAL_PROOF" compact />
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">Còn lại = 0: không cần chứng từ chi đợt cuối.</p>
          <Field label="Ngày hoàn tất" required htmlFor="paid-date">
            <Input id="paid-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </>
      )}
      <Notice tone={goesToB8 ? 'warn' : 'info'} title="Kiểm tra tự động sau khi HOÀN THÀNH">
        {pr.hasInvoice
          ? has('INVOICE')
            ? 'Loại chi Có hóa đơn, đã có file hóa đơn → phiếu Hoàn thành.'
            : 'Loại chi Có hóa đơn nhưng chưa có hóa đơn → vẫn thanh toán dứt điểm, phiếu chuyển B8 để NV cung ứng bổ sung.'
          : 'Loại chi Không hóa đơn → phiếu Hoàn thành.'}
      </Notice>
      <div className="grid gap-2 sm:grid-cols-2">
        <Checkpoint checked={checked} onChange={setChecked}>
          Đã kiểm tra HS hoàn ứng
        </Checkpoint>
        <Checkpoint checked={done} onChange={setDone}>
          HOÀN THÀNH
        </Checkpoint>
      </div>
      <NoReturnHint />
      {!ready && (
        <Notice tone="warn" title="Chưa đủ điều kiện để HOÀN THÀNH">
          Còn thiếu: {blockers.join(' · ')}.
          {needsProof && !has('FINAL_PROOF')
            ? ` Phiếu còn phải chi ${formatMoney(remaining)} nên bắt buộc đính kèm chứng từ chi đợt cuối.`
            : ''}
        </Notice>
      )}
      <div>
        <Button
          variant="success"
          disabled={!ready}
          onClick={() =>
            run({ type: 'PAY_FINAL', id: pr.id, version: pr.version, checkedDocs: checked, completed: done, method: method || null, paidDate: date })
          }
        >
          HOÀN THÀNH
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// B8 — Bổ sung hóa đơn (T13)
// ---------------------------------------------------------------------------

function InvoiceCountdownNotice({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const now = useNow();
  if (!pr.invoiceDueStartAt) return null;
  const cd = invoiceCountdown(pr.invoiceDueStartAt, now, db.config.invoiceDeadlineWorkingDays, db.holidays);
  return (
    <Notice
      tone={cd.overdue ? 'danger' : cd.tone === 'warn' ? 'warn' : 'info'}
      title={cd.overdue ? 'Đã quá hạn bổ sung hóa đơn' : `Còn ${cd.remaining} ngày làm việc`}
    >
      Hạn: {formatDate(cd.dueDate)} ({db.config.invoiceDeadlineWorkingDays} ngày làm việc, không tính T7, CN, ngày lễ).
      {cd.overdue && ' Hệ thống nhắc hằng ngày NV cung ứng và kế toán phụ trách; trạng thái phiếu không đổi.'}
    </Notice>
  );
}

function InvoiceSupplement({ pr }: { pr: PaymentRequest }) {
  const has = useHasFiles(pr);
  return (
    <Panel title="B8 · Bổ sung hóa đơn" tone="amber">
      <InvoiceCountdownNotice pr={pr} />
      <AttachmentSlot pr={pr} slot="INVOICE" />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="success" disabled={!has('INVOICE')} onClick={() => run({ type: 'COMPLETE_INVOICE', id: pr.id, version: pr.version })}>
          Đã upload hóa đơn → Hoàn thành
        </Button>
        {!has('INVOICE') && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5" /> Tải file hóa đơn trước
          </span>
        )}
      </div>
    </Panel>
  );
}
