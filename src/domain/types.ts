// Domain model for workflow v3.4 (docs/workflow.md). Pure types — no React, no browser APIs.

export const ROLES = ['REQUESTER', 'LEADER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = [
  'DRAFT',
  'LEADER_APPROVAL',
  'ADVANCE_PREPARATION',
  'COORDINATION',
  'ADVANCE_PAYMENT',
  'AFTER_ADVANCE',
  'FINAL_PAYMENT',
  'DOCUMENT_SUPPLEMENT_REQUIRED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
] as const;
/** Persisted statuses. AUTO_VERIFY is a transient branch inside T10 and never stored (workflow §5.1). */
export type Status = (typeof STATUSES)[number];

/** The four fixed departments, one per kind (workflow §2b). */
export const DEPARTMENT_KINDS = ['PROCUREMENT', 'BOARD', 'FINANCE', 'ACCOUNTING'] as const;
export type DepartmentKind = (typeof DEPARTMENT_KINDS)[number];

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type PaymentMethod = 'TRANSFER' | 'CASH';

export const SLOTS = [
  'REQUEST_FORM',
  'QUOTATION_COMPARISON',
  'PURCHASE_ORDER',
  'ADVANCE_REQUEST',
  'ADVANCE_PROOF',
  'DELIVERY_RECORD',
  'PAYMENT_REQUEST_DOC',
  'INVOICE',
  'FINAL_PROOF',
] as const;
export type Slot = (typeof SLOTS)[number];

/** Top-level folder under CHUNG_TU/, decided by the uploader's department (workflow §8.3). */
export type StorageFolder = 'CUNG_UNG' | 'KE_TOAN';

export interface User {
  id: string;
  username: string;
  fullName: string;
  passwordHash: string;
  mustChangePassword: boolean;
  role: Role;
  /** Follows the role; null only for ADMIN, who belongs to no department. */
  departmentId: string | null;
  status: 'ACTIVE' | 'LOCKED';
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  kind: DepartmentKind;
}

export type MasterKind = 'projects' | 'categories' | 'requesterNames' | 'vendors';

export interface MasterItem {
  id: string;
  code: string;
  name: string;
  deleted: boolean;
}

export interface Attachment {
  id: string;
  requestId: string;
  slot: Slot;
  /** Status of the request when the file was uploaded — files lock once that step is ticked. */
  stage: Status;
  folder: StorageFolder;
  fileName: string;
  /** /CHUNG_TU/{CUNG_UNG|KE_TOAN}/{YYYY-MM-DD}/{MA_PHIEU}/{file_name} */
  storagePath: string;
  size: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface PaymentTransaction {
  id: string;
  kind: 'ADVANCE' | 'FINAL';
  amount: number;
  method: PaymentMethod;
  paidDate: string;
  createdBy: string;
  createdAt: string;
}

export type TimelineAction =
  | 'CREATE'
  | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12' | 'T13'
  | 'A1' | 'A2' | 'A3' | 'A4';

export interface TimelineEntry {
  id: string;
  action: TimelineAction;
  fromStatus: Status | null;
  toStatus: Status | null;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface PaymentRequest {
  id: string;
  code: string;
  status: Status;
  version: number;
  createdBy: string;
  createdByRole: Role;
  assignedRequesterId: string;
  assignedAccountantId: string | null;
  projectId: string;
  categoryId: string;
  requesterNameId: string;
  vendorId: string;
  title: string;
  note: string;
  hasInvoice: boolean;
  requestedAmount: number;
  advanceAmount: number | null;
  settlementAmount: number | null;
  priority: Priority | null;
  invoiceDueStartAt: string | null;
  lateInvoice: boolean;
  lastLateReminderOn: string | null;
  /** Set when the Leader returned the request at B2 (T5) or Admin reopened it (A3). */
  resubmitted: boolean;
  transactions: PaymentTransaction[];
  timeline: TimelineEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Đã dọn file đính kèm khỏi đĩa máy chủ; bản sao còn trên NAS và phục hồi được. */
  archivedAt: string | null;
}

export interface Comment {
  id: string;
  requestId: string;
  authorId: string;
  content: string;
  mentions: string[];
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  requestId: string | null;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string;
  createdAt: string;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface SystemConfig {
  invoiceDeadlineWorkingDays: number;
  maxLoginAttempts: number;
  lockMinutes: number;
  maxFileSizeMb: number;
  auditRetentionDays: number;
  allowedExtensions: string[];
}

export interface Db {
  schemaVersion: number;
  users: User[];
  departments: Department[];
  projects: MasterItem[];
  categories: MasterItem[];
  requesterNames: MasterItem[];
  vendors: MasterItem[];
  requests: PaymentRequest[];
  attachments: Attachment[];
  comments: Comment[];
  notifications: Notification[];
  audit: AuditEntry[];
  holidays: Holiday[];
  config: SystemConfig;
  /** Last sequence number per YYYYMM for request codes. */
  seq: Record<string, number>;
  idCounter: number;
}
