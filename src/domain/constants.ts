import type {
  DepartmentKind,
  PaymentMethod,
  Priority,
  Role,
  Slot,
  Status,
  StorageFolder,
  TimelineAction,
} from './types.ts';

export const ROLE_LABEL: Record<Role, string> = {
  REQUESTER: 'Nhân viên cung ứng',
  LEADER: 'Lãnh đạo',
  FINANCE_MANAGER: 'Trưởng phòng Tài chính',
  ACCOUNTANT: 'Nhân viên kế toán',
  ADMIN: 'Quản trị hệ thống',
};

export const ROLE_SHORT: Record<Role, string> = {
  REQUESTER: 'NV cung ứng',
  LEADER: 'Lãnh đạo',
  FINANCE_MANAGER: 'TPTC',
  ACCOUNTANT: 'NV kế toán',
  ADMIN: 'Admin',
};

export const DEPARTMENT_KIND_LABEL: Record<DepartmentKind, string> = {
  PROCUREMENT: 'Phòng Cung Ứng',
  BOARD: 'Lãnh Đạo',
  FINANCE: 'Phòng Tài Chính',
  ACCOUNTING: 'Phòng Kế Toán',
};

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

export const STATUS_LABEL: Record<Status, string> = {
  DRAFT: 'Tạo phiếu mới',
  LEADER_APPROVAL: 'Chờ Lãnh đạo duyệt',
  ADVANCE_PREPARATION: 'Nộp hồ sơ tạm ứng',
  COORDINATION: 'Chờ TPTC duyệt',
  ADVANCE_PAYMENT: 'PKT tạm ứng',
  AFTER_ADVANCE: 'Theo dõi sau tạm ứng',
  FINAL_PAYMENT: 'PKT thanh toán',
  DOCUMENT_SUPPLEMENT_REQUIRED: 'Cần bổ sung hóa đơn',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
  REJECTED: 'Bị từ chối',
};

/** Who is expected to act at each step (display only; enforcement lives in permissions.ts). */
export const STATUS_OWNER: Record<Status, string> = {
  DRAFT: 'NV cung ứng',
  LEADER_APPROVAL: 'Lãnh đạo',
  ADVANCE_PREPARATION: 'NV cung ứng',
  COORDINATION: 'Trưởng phòng Tài chính',
  ADVANCE_PAYMENT: 'Kế toán được giao',
  AFTER_ADVANCE: 'NV cung ứng',
  FINAL_PAYMENT: 'Kế toán phụ trách',
  DOCUMENT_SUPPLEMENT_REQUIRED: 'NV cung ứng',
  COMPLETED: '—',
  CANCELLED: '—',
  REJECTED: '—',
};

/** The 8 working steps in order (B1 → B8). */
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

export const TERMINAL_STATUSES: Status[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

export function isTerminal(status: Status): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function stepIndex(status: Status): number {
  if (status === 'COMPLETED') return WORKING_STATUSES.length;
  return WORKING_STATUSES.indexOf(status);
}

export const TIMELINE_LABEL: Record<TimelineAction, string> = {
  CREATE: 'Tạo phiếu',
  T1: 'Gửi Lãnh đạo',
  T2: 'Hủy đơn',
  T3: 'Lãnh đạo duyệt',
  T4: 'Lãnh đạo từ chối',
  T5: 'Lãnh đạo trả lại',
  T6: 'Hoàn tất hồ sơ tạm ứng',
  T7: 'TPTC duyệt và chuyển Kế toán',
  T8: 'Đã thanh toán tạm ứng',
  T9: 'Hoàn tất hồ sơ ĐN thanh toán',
  T10: 'Đã KT HS hoàn ứng + HOÀN THÀNH',
  T11: 'Kiểm tra tự động: đạt',
  T12: 'Kiểm tra tự động: thiếu hóa đơn',
  T13: 'Upload hóa đơn',
  A1: 'Admin ép chuyển bước',
  A2: 'Admin hủy phiếu',
  A3: 'Admin mở lại phiếu',
  A4: 'Chuyển giao NV cung ứng',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

export const PRIORITY_RANK: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  TRANSFER: 'Chuyển khoản (UNC)',
  CASH: 'Tiền mặt (Phiếu chi)',
};

export const FOLDER_LABEL: Record<StorageFolder, string> = {
  CUNG_UNG: 'Phòng Cung Ứng',
  KE_TOAN: 'Phòng Kế Toán',
};

export type SlotOwner = 'REQUESTER' | 'ACCOUNTANT';

export interface SlotDef {
  label: string;
  /** Steps at which files may be added to this slot. */
  stages: Status[];
  owner: SlotOwner;
  /** Top-level storage folder (workflow §8.3). */
  folder: StorageFolder;
}

export const SLOT_DEF: Record<Slot, SlotDef> = {
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

/** Attachment groups as shown on the request (workflow §8.2). */
export const SLOT_GROUPS: { step: string; title: string; slots: Slot[] }[] = [
  { step: 'B1', title: 'Hồ sơ yêu cầu', slots: ['REQUEST_FORM', 'QUOTATION_COMPARISON'] },
  { step: 'B3', title: 'Hồ sơ tạm ứng', slots: ['PURCHASE_ORDER', 'ADVANCE_REQUEST'] },
  { step: 'B5', title: 'Chứng từ chi tạm ứng', slots: ['ADVANCE_PROOF'] },
  { step: 'B6', title: 'Hồ sơ đề nghị thanh toán', slots: ['DELIVERY_RECORD', 'PAYMENT_REQUEST_DOC', 'INVOICE'] },
  { step: 'B7', title: 'Chứng từ chi đợt cuối', slots: ['FINAL_PROOF'] },
];

/** Step at which each attachment group opens, used to collapse groups not reached yet. */
export const GROUP_STEP_INDEX: Record<string, number> = { B1: 0, B3: 2, B5: 4, B6: 5, B7: 6 };

export const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt',
  'png', 'jpg', 'jpeg', 'webp', 'heic',
];

export const DEFAULT_PASSWORD_HINT = 'Password@123';
/** Max upload size per file (workflow §8.2, §8.3). */
export const MAX_FILE_SIZE_MB = 25;
/** Audit log retention (workflow §8.4). */
export const AUDIT_RETENTION_DAYS = 6;
