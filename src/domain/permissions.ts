// Role × data-scope authorization (workflow §7, §11.4, §11.5). Every write in workflow.ts goes through authorize().
import { PRIORITY_RANK, SLOT_DEF, WORKING_STATUSES, isTerminal } from './constants.ts';
import { DomainError, fail } from './errors.ts';
import type { Attachment, Db, MasterKind, PaymentRequest, Role, Slot, Status, User } from './types.ts';

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findUser(db: Db, id: string | null | undefined): User | undefined {
  return id ? db.users.find((u) => u.id === id) : undefined;
}

export function activeUsers(db: Db, role: Role): User[] {
  return db.users.filter((u) => u.role === role && u.status === 'ACTIVE');
}

/** B2 goes straight to Lãnh Đạo: every active Leader can approve, no per-department routing (workflow §2b). */
export function leaders(db: Db): User[] {
  return activeUsers(db, 'LEADER');
}

export function financeManagers(db: Db): User[] {
  return activeUsers(db, 'FINANCE_MANAGER');
}

export function accountants(db: Db): User[] {
  return activeUsers(db, 'ACCOUNTANT');
}

export function requesters(db: Db): User[] {
  return activeUsers(db, 'REQUESTER');
}

export function admins(db: Db): User[] {
  return activeUsers(db, 'ADMIN');
}

export function isAdmin(user: User): boolean {
  return user.role === 'ADMIN';
}

/** The single active accountant the request is dispatched to at B4 (workflow §5.3). */
export function theAccountant(db: Db): User | undefined {
  return accountants(db)[0];
}

// ---------------------------------------------------------------------------
// Actions on a request
// ---------------------------------------------------------------------------

export type RequestActionKey =
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

const ANY_STATUS: Status[] = [...WORKING_STATUSES, 'COMPLETED', 'CANCELLED', 'REJECTED'];

/** Statuses at which each action is meaningful. Admin privileges (A1–A4, delete) span every status. */
export const ACTION_FROM: Record<RequestActionKey, Status[]> = {
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
  TRANSFER: ANY_STATUS,
  FORCE: ANY_STATUS,
  ADMIN_CANCEL: ANY_STATUS,
  REOPEN: ['COMPLETED', 'CANCELLED', 'REJECTED'],
  DELETE: ANY_STATUS,
  COMMENT: ANY_STATUS,
};

const ADMIN_ONLY: RequestActionKey[] = ['TRANSFER', 'FORCE', 'ADMIN_CANCEL', 'REOPEN', 'DELETE'];

/**
 * Actions Admin may run at any status, including COMPLETED (workflow §9.1).
 * Business transitions ("tick thay") still require the request to sit at their own step.
 */
const ADMIN_ANY_STATUS: RequestActionKey[] = ['EDIT_DRAFT', 'TRANSFER', 'FORCE', 'ADMIN_CANCEL', 'DELETE', 'COMMENT'];

function isResponsibleRequester(user: User, pr: PaymentRequest): boolean {
  return user.role === 'REQUESTER' && pr.assignedRequesterId === user.id;
}

/**
 * Throws if `user` may not perform `key` on `pr` given its current status and the user's scope.
 * Data/document validation of the step happens afterwards in the workflow engine.
 */
export function authorize(db: Db, user: User, pr: PaymentRequest, key: RequestActionKey): void {
  if (user.status !== 'ACTIVE') fail('ERR_FORBIDDEN', 'Tài khoản đang bị khóa');
  const admin = isAdmin(user);
  if (!ACTION_FROM[key].includes(pr.status) && !(admin && ADMIN_ANY_STATUS.includes(key))) {
    fail('ERR_INVALID_TRANSITION', `Không thể thực hiện thao tác này khi phiếu ở trạng thái ${pr.status}`);
  }
  // Super Admin: full rights at every status, including COMPLETED (workflow §1.8, §9.1).
  if (admin) return;
  if (ADMIN_ONLY.includes(key)) fail('ERR_FORBIDDEN', 'Chỉ Admin được thực hiện thao tác đặc quyền này');

  const deny = (msg = 'Bạn không có quyền thực hiện thao tác này trên phiếu') => fail('ERR_FORBIDDEN', msg);

  switch (key) {
    case 'EDIT_DRAFT':
    case 'SUBMIT':
    case 'CANCEL':
    case 'SUBMIT_ADVANCE':
    case 'SUBMIT_SETTLEMENT':
    case 'COMPLETE_INVOICE':
      if (!isResponsibleRequester(user, pr)) deny('Chỉ nhân viên cung ứng phụ trách phiếu được thao tác');
      return;
    case 'LEADER_APPROVE':
    case 'LEADER_REJECT':
    case 'LEADER_RETURN':
      if (user.role !== 'LEADER') deny('Chỉ Lãnh đạo được duyệt, từ chối hoặc trả lại phiếu ở B2');
      // Separation of duties at B2 (workflow §5.1 T3).
      if (key === 'LEADER_APPROVE' && pr.createdBy === user.id) {
        fail('ERR_SELF_APPROVAL', 'Không được tự duyệt phiếu do chính mình tạo');
      }
      return;
    case 'FINANCE_APPROVE':
      if (user.role !== 'FINANCE_MANAGER') deny('Chỉ Trưởng phòng Tài chính được duyệt B4');
      return;
    case 'PAY_ADVANCE':
    case 'PAY_FINAL':
      if (user.role !== 'ACCOUNTANT' || pr.assignedAccountantId !== user.id) {
        deny('Chỉ kế toán được giao phiếu được xử lý bước này');
      }
      return;
    case 'COMMENT':
      return;
  }
}

export function can(db: Db, user: User, pr: PaymentRequest, key: RequestActionKey): boolean {
  try {
    authorize(db, user, pr, key);
    return true;
  } catch (e) {
    if (e instanceof DomainError) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Attachments (workflow §8.2)
// ---------------------------------------------------------------------------

export function canUploadToSlot(user: User, pr: PaymentRequest, slot: Slot): boolean {
  if (user.status !== 'ACTIVE') return false;
  // Admin uploads and replaces files at any step, including a completed request (workflow §8.2).
  if (isAdmin(user)) return true;
  const def = SLOT_DEF[slot];
  if (!def.stages.includes(pr.status)) return false;
  if (def.owner === 'REQUESTER') return isResponsibleRequester(user, pr);
  return user.role === 'ACCOUNTANT' && pr.assignedAccountantId === user.id;
}

/** A file can be removed only while the step it was uploaded at is still open (not ticked). */
export function canDeleteAttachment(user: User, pr: PaymentRequest, att: Attachment): boolean {
  if (!canUploadToSlot(user, pr, att.slot)) return false;
  return isAdmin(user) || att.stage === pr.status;
}

// ---------------------------------------------------------------------------
// Master data (workflow §8.1)
// ---------------------------------------------------------------------------

export function canManageMaster(user: User, kind: MasterKind | 'departments'): boolean {
  if (user.status !== 'ACTIVE') return false;
  if (kind === 'departments') return isAdmin(user);
  return isAdmin(user) || user.role === 'REQUESTER';
}

export function canViewReports(user: User): boolean {
  return ['LEADER', 'FINANCE_MANAGER', 'ADMIN'].includes(user.role);
}

// ---------------------------------------------------------------------------
// Work queues (workflow §7)
// ---------------------------------------------------------------------------

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

function byPriorityThenAge(a: PaymentRequest, b: PaymentRequest): number {
  const pa = a.priority ? PRIORITY_RANK[a.priority] : 3;
  const pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
  return pa - pb || a.updatedAt.localeCompare(b.updatedAt);
}

function newestFirst(a: PaymentRequest, b: PaymentRequest): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function queueItems(db: Db, user: User, key: QueueKey): PaymentRequest[] {
  const admin = isAdmin(user);
  const mineReq = (pr: PaymentRequest) => admin || pr.assignedRequesterId === user.id;
  const mineAcc = (pr: PaymentRequest) => admin || pr.assignedAccountantId === user.id;
  const inStatus = (...s: Status[]) => (pr: PaymentRequest) => s.includes(pr.status);
  const rs = db.requests;

  switch (key) {
    case 'overview':
      return rs.filter((p) => mineReq(p) && inStatus('DRAFT', 'ADVANCE_PREPARATION')(p)).sort(newestFirst);
    case 'myRequests':
      return rs.filter(mineReq).sort(newestFirst);
    case 'leaderApproval':
      return admin || user.role === 'LEADER' ? rs.filter(inStatus('LEADER_APPROVAL')).sort(newestFirst) : [];
    case 'coordination':
      return admin || user.role === 'FINANCE_MANAGER' ? rs.filter(inStatus('COORDINATION')).sort(newestFirst) : [];
    case 'financeMonitor':
      if (!admin && user.role !== 'FINANCE_MANAGER') return [];
      return rs
        .filter(inStatus('ADVANCE_PAYMENT', 'AFTER_ADVANCE', 'FINAL_PAYMENT', 'DOCUMENT_SUPPLEMENT_REQUIRED'))
        .sort(byPriorityThenAge);
    case 'advancePayments':
      return rs.filter((p) => mineAcc(p) && inStatus('ADVANCE_PAYMENT')(p)).sort(byPriorityThenAge);
    case 'finalPayments':
      return rs.filter((p) => mineAcc(p) && inStatus('FINAL_PAYMENT')(p)).sort(byPriorityThenAge);
    case 'missingInvoices':
      return rs.filter((p) => mineAcc(p) && inStatus('DOCUMENT_SUPPLEMENT_REQUIRED')(p)).sort(newestFirst);
    case 'afterAdvance':
      return rs.filter((p) => mineReq(p) && inStatus('AFTER_ADVANCE')(p)).sort(newestFirst);
    case 'supplementInvoice':
      return rs.filter((p) => mineReq(p) && inStatus('DOCUMENT_SUPPLEMENT_REQUIRED')(p)).sort(newestFirst);
    case 'completed':
      return rs.filter(inStatus('COMPLETED')).sort(newestFirst);
    case 'all':
      // Tra cứu hồ sơ: every request at every status, read-only for everyone (workflow §7).
      return [...rs].sort(newestFirst);
  }
}

/** Requests an accountant is currently holding (B5–B7), used by reports and the TPTC monitor. */
export function workloadOf(db: Db, userId: string): number {
  return db.requests.filter(
    (p) => p.assignedAccountantId === userId && ['ADVANCE_PAYMENT', 'AFTER_ADVANCE', 'FINAL_PAYMENT'].includes(p.status),
  ).length;
}

export { isTerminal };
