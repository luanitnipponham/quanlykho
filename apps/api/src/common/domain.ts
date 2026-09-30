// Business rules shared by every module — the server-side twin of src/domain in the frontend.
// Workflow v3.4 (docs/workflow.md §5, §6, §8).
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';

export type Role = 'REQUESTER' | 'LEADER' | 'FINANCE_MANAGER' | 'ACCOUNTANT' | 'ADMIN';
export type DepartmentKind = 'PROCUREMENT' | 'BOARD' | 'FINANCE' | 'ACCOUNTING';
export type Status =
  | 'DRAFT'
  | 'LEADER_APPROVAL'
  | 'ADVANCE_PREPARATION'
  | 'COORDINATION'
  | 'ADVANCE_PAYMENT'
  | 'AFTER_ADVANCE'
  | 'FINAL_PAYMENT'
  | 'DOCUMENT_SUPPLEMENT_REQUIRED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED';
export type Slot =
  | 'REQUEST_FORM'
  | 'QUOTATION_COMPARISON'
  | 'PURCHASE_ORDER'
  | 'ADVANCE_REQUEST'
  | 'ADVANCE_PROOF'
  | 'DELIVERY_RECORD'
  | 'PAYMENT_REQUEST_DOC'
  | 'INVOICE'
  | 'FINAL_PROOF';
export type StorageFolder = 'CUNG_UNG' | 'KE_TOAN';

export const WORKING_STATUSES: Status[] = [
  'DRAFT',
  'LEADER_APPROVAL',
  'ADVANCE_PREPARATION',
  'COORDINATION',
  'ADVANCE_PAYMENT',
  'AFTER_ADVANCE',
  'FINAL_PAYMENT',
  'DOCUMENT_SUPPLEMENT_REQUIRED',
];

export const STATUS_STEP: Record<Status, string> = {
  DRAFT: 'B1',
  LEADER_APPROVAL: 'B2',
  ADVANCE_PREPARATION: 'B3',
  COORDINATION: 'B4',
  ADVANCE_PAYMENT: 'B5',
  AFTER_ADVANCE: 'B6',
  FINAL_PAYMENT: 'B7',
  DOCUMENT_SUPPLEMENT_REQUIRED: 'B8',
  COMPLETED: 'Kết thúc',
  CANCELLED: 'Kết thúc',
  REJECTED: 'Kết thúc',
};

export const ROLE_DEPT_KIND: Record<Role, DepartmentKind | null> = {
  REQUESTER: 'PROCUREMENT',
  LEADER: 'BOARD',
  FINANCE_MANAGER: 'FINANCE',
  ACCOUNTANT: 'ACCOUNTING',
  ADMIN: null,
};

export const SLOT_DEF: Record<Slot, { label: string; stages: Status[]; owner: 'REQUESTER' | 'ACCOUNTANT'; folder: StorageFolder }> = {
  REQUEST_FORM: { label: 'Phiếu yêu cầu', stages: ['DRAFT'], owner: 'REQUESTER', folder: 'CUNG_UNG' },
  QUOTATION_COMPARISON: { label: 'Báo giá & bảng so sánh giá', stages: ['DRAFT'], owner: 'REQUESTER', folder: 'CUNG_UNG' },
  PURCHASE_ORDER: { label: 'Đơn đặt hàng', stages: ['ADVANCE_PREPARATION'], owner: 'REQUESTER', folder: 'CUNG_UNG' },
  ADVANCE_REQUEST: { label: 'Đề nghị tạm ứng', stages: ['ADVANCE_PREPARATION'], owner: 'REQUESTER', folder: 'CUNG_UNG' },
  ADVANCE_PROOF: { label: 'UNC / Phiếu chi tạm ứng', stages: ['ADVANCE_PAYMENT'], owner: 'ACCOUNTANT', folder: 'KE_TOAN' },
  DELIVERY_RECORD: { label: 'Biên bản nghiệm thu / giao nhận (BNH)', stages: ['AFTER_ADVANCE'], owner: 'REQUESTER', folder: 'CUNG_UNG' },
  PAYMENT_REQUEST_DOC: { label: 'Đề nghị thanh toán (ĐNTT)', stages: ['AFTER_ADVANCE'], owner: 'REQUESTER', folder: 'CUNG_UNG' },
  INVOICE: {
    label: 'Hóa đơn',
    stages: ['AFTER_ADVANCE', 'FINAL_PAYMENT', 'DOCUMENT_SUPPLEMENT_REQUIRED'],
    owner: 'REQUESTER',
    folder: 'CUNG_UNG',
  },
  FINAL_PROOF: { label: 'UNC / Phiếu chi đợt cuối', stages: ['FINAL_PAYMENT'], owner: 'ACCOUNTANT', folder: 'KE_TOAN' },
};

export const STORAGE_ROOT = 'CHUNG_TU';

// ---------------------------------------------------------------------------
// Errors — the code travels to the client so both tiers speak the same language.
// ---------------------------------------------------------------------------

export class DomainException extends HttpException {
  constructor(code: string, message: string, status = 400) {
    super({ success: false, error: { code, message } }, status);
  }
}

export function fail(code: string, message: string): never {
  throw new DomainException(code, message);
}

export function deny(message = 'Bạn không có quyền thực hiện thao tác này'): never {
  throw new DomainException('ERR_FORBIDDEN', message, 403);
}

// ---------------------------------------------------------------------------
// Transition table (workflow §5.1) — which statuses each action may start from.
// ---------------------------------------------------------------------------

export type ActionKey =
  | 'EDIT_DRAFT'
  | 'SUBMIT'
  | 'CANCEL'
  | 'LEADER_APPROVE'
  | 'LEADER_REJECT'
  | 'LEADER_RETURN'
  | 'SUBMIT_ADVANCE'
  | 'FINANCE_APPROVE'
  | 'PAY_ADVANCE'
  | 'SUBMIT_SETTLEMENT'
  | 'PAY_FINAL'
  | 'COMPLETE_INVOICE'
  | 'TRANSFER'
  | 'FORCE'
  | 'ADMIN_CANCEL'
  | 'REOPEN'
  | 'DELETE'
  | 'COMMENT';

const ANY: Status[] = [...WORKING_STATUSES, 'COMPLETED', 'CANCELLED', 'REJECTED'];

export const ACTION_FROM: Record<ActionKey, Status[]> = {
  EDIT_DRAFT: ['DRAFT'],
  SUBMIT: ['DRAFT'],
  CANCEL: ['DRAFT'],
  LEADER_APPROVE: ['LEADER_APPROVAL'],
  LEADER_REJECT: ['LEADER_APPROVAL'],
  LEADER_RETURN: ['LEADER_APPROVAL'],
  SUBMIT_ADVANCE: ['ADVANCE_PREPARATION'],
  FINANCE_APPROVE: ['COORDINATION'],
  PAY_ADVANCE: ['ADVANCE_PAYMENT'],
  SUBMIT_SETTLEMENT: ['AFTER_ADVANCE'],
  PAY_FINAL: ['FINAL_PAYMENT'],
  COMPLETE_INVOICE: ['DOCUMENT_SUPPLEMENT_REQUIRED'],
  TRANSFER: ANY,
  FORCE: ANY,
  ADMIN_CANCEL: ANY,
  REOPEN: ['COMPLETED', 'CANCELLED', 'REJECTED'],
  DELETE: ANY,
  COMMENT: ANY,
};

const ADMIN_ONLY: ActionKey[] = ['TRANSFER', 'FORCE', 'ADMIN_CANCEL', 'REOPEN', 'DELETE'];
/** Admin may run these at any status, including COMPLETED (workflow §9.1). */
const ADMIN_ANY_STATUS: ActionKey[] = ['EDIT_DRAFT', 'TRANSFER', 'FORCE', 'ADMIN_CANCEL', 'DELETE', 'COMMENT'];

export interface Actor {
  id: string;
  role: Role;
}

export interface RequestScope {
  status: Status;
  createdById: string;
  assignedRequesterId: string;
  assignedAccountantId: string | null;
}

/** Throws unless `actor` may perform `key` on a request in this state (workflow §11.4). */
export function authorize(actor: Actor, pr: RequestScope, key: ActionKey): void {
  const admin = actor.role === 'ADMIN';
  if (!ACTION_FROM[key].includes(pr.status) && !(admin && ADMIN_ANY_STATUS.includes(key))) {
    fail('ERR_INVALID_TRANSITION', `Không thể thực hiện thao tác này khi phiếu ở trạng thái ${pr.status}`);
  }
  if (admin) return; // Super Admin: full rights at every status (workflow §1.8).
  if (ADMIN_ONLY.includes(key)) deny('Chỉ Admin được thực hiện thao tác đặc quyền này');

  switch (key) {
    case 'EDIT_DRAFT':
    case 'SUBMIT':
    case 'CANCEL':
    case 'SUBMIT_ADVANCE':
    case 'SUBMIT_SETTLEMENT':
    case 'COMPLETE_INVOICE':
      if (actor.role !== 'REQUESTER' || pr.assignedRequesterId !== actor.id) {
        deny('Chỉ nhân viên cung ứng phụ trách phiếu được thao tác');
      }
      return;
    case 'LEADER_APPROVE':
    case 'LEADER_REJECT':
    case 'LEADER_RETURN':
      if (actor.role !== 'LEADER') deny('Chỉ Lãnh đạo được duyệt, từ chối hoặc trả lại phiếu ở B2');
      if (key === 'LEADER_APPROVE' && pr.createdById === actor.id) {
        throw new DomainException('ERR_SELF_APPROVAL', 'Không được tự duyệt phiếu do chính mình tạo', 403);
      }
      return;
    case 'FINANCE_APPROVE':
      if (actor.role !== 'FINANCE_MANAGER') deny('Chỉ Trưởng phòng Tài chính được duyệt B4');
      return;
    case 'PAY_ADVANCE':
    case 'PAY_FINAL':
      if (actor.role !== 'ACCOUNTANT' || pr.assignedAccountantId !== actor.id) {
        deny('Chỉ kế toán được giao phiếu được xử lý bước này');
      }
      return;
    case 'COMMENT':
      return;
  }
}

export function canUploadToSlot(actor: Actor, pr: RequestScope, slot: Slot): boolean {
  if (actor.role === 'ADMIN') return true;
  const def = SLOT_DEF[slot];
  if (!def.stages.includes(pr.status)) return false;
  if (def.owner === 'REQUESTER') return actor.role === 'REQUESTER' && pr.assignedRequesterId === actor.id;
  return actor.role === 'ACCOUNTANT' && pr.assignedAccountantId === actor.id;
}

// ---------------------------------------------------------------------------
// Amounts (workflow §6.2)
// ---------------------------------------------------------------------------

export function remainingOf(advance: number, settlement: number | null): number {
  if (settlement === null) return 0;
  return Math.max(0, settlement - advance);
}

/** Quyết toán < Tạm ứng is refused; the UI blocks it at the input too. */
export function assertSettlement(advance: number, settlement: number): void {
  if (!Number.isFinite(settlement) || settlement <= 0) fail('ERR_REQUIRED_FIELD', 'Nhập Giá trị quyết toán');
  if (settlement < advance) {
    fail('ERR_SETTLE_BELOW_ADV', `Giá trị quyết toán không được nhỏ hơn số đã tạm ứng (${advance.toLocaleString('vi-VN')} ₫)`);
  }
}

/** A1 warns instead of blocking when it skips a money-out step (workflow §5.2). */
export function paymentSkipWarning(to: Status, hasAdvance: boolean, hasFinal: boolean, remaining: number): string | undefined {
  const target = stepIndex(to);
  if (target < 0) return undefined;
  if (target > stepIndex('ADVANCE_PAYMENT') && !hasAdvance) {
    return 'Phiếu vượt qua bước chi tạm ứng (B5) mà chưa có giao dịch chi nào được ghi nhận.';
  }
  if (target > stepIndex('FINAL_PAYMENT') && !hasFinal && remaining > 0) {
    return 'Phiếu vượt qua bước thanh toán (B7) mà chưa có giao dịch chi đợt cuối.';
  }
  return undefined;
}

export function stepIndex(status: Status): number {
  if (status === 'COMPLETED') return WORKING_STATUSES.length;
  return WORKING_STATUSES.indexOf(status);
}

export function requireReason(reason: string | undefined, label = 'lý do'): string {
  const r = (reason ?? '').trim();
  if (!r) fail('ERR_REASON_REQUIRED', `Bắt buộc nhập ${label}`);
  return r;
}

export function requireTick(ok: boolean, what: string): void {
  if (!ok) fail('ERR_PAYMENT_NO_CONFIRM', `Chưa tick ô ☑ ${what}`);
}

// ---------------------------------------------------------------------------
// Files (workflow §8.3)
// ---------------------------------------------------------------------------

export function normalizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildFileName(originalName: string, at: Date, taken: Iterable<string> = []): string {
  const i = originalName.lastIndexOf('.');
  const ext = i < 0 ? '' : originalName.slice(i + 1).toLowerCase();
  const base = normalizeFileName(i < 0 ? originalName : originalName.slice(0, i)) || 'file';
  const withExt = (b: string) => (ext ? `${b}.${ext}` : b);
  const used = new Set(taken);
  if (!used.has(withExt(base))) return withExt(base);
  const stamp = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  let candidate = withExt(`${base}_${stamp}`);
  let n = 2;
  while (used.has(candidate)) candidate = withExt(`${base}_${stamp}_${n++}`);
  return candidate;
}

export function storagePathOf(folder: StorageFolder, code: string, fileName: string, at: Date): string {
  return `/${STORAGE_ROOT}/${folder}/${toDateKey(at)}/${code}/${fileName}`;
}

// ---------------------------------------------------------------------------
// Working days (workflow §6.7)
// ---------------------------------------------------------------------------

export function isWorkingDay(d: Date, holidays: Set<string>): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !holidays.has(toDateKey(d));
}

export function workingDaysElapsed(start: Date, now: Date, holidays: Set<string>): number {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end = toDateKey(now);
  let count = 0;
  while (toDateKey(d) < end) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, holidays)) count++;
  }
  return count;
}
