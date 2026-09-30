// Role → menu (workflow §9) and route → allowed roles (§11.6). A route outside the role's menu is refused.
import {
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FilePlus2,
  FileSearch,
  FileText,
  FileWarning,
  FolderOpen,
  History,
  Inbox,
  ListChecks,
  Receipt,
  Settings,
  UserCog,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { QueueKey } from '../domain/permissions';
import type { Role } from '../domain/types';

export interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Queue whose size is shown as a badge. */
  count?: QueueKey;
}

const LOOKUP: MenuItem = { path: '/lookup', label: 'Tra cứu hồ sơ', icon: FileSearch };
const HISTORY: MenuItem = { path: '/history', label: 'Lịch sử (6 ngày)', icon: History };
const REPORTS: MenuItem = { path: '/reports', label: 'Báo cáo', icon: BarChart3 };

/** Menus exactly as listed in workflow §9 — the first entry is where the role lands after login. */
export const MENUS: Record<Role, MenuItem[]> = {
  REQUESTER: [
    { path: '/procurement/requests/new', label: 'Tạo phiếu B1', icon: FilePlus2 },
    { path: '/procurement/my-requests', label: 'Phiếu của tôi', icon: FolderOpen, count: 'myRequests' },
    { path: '/procurement/overview', label: 'Hồ sơ tạm ứng B3', icon: FileText, count: 'overview' },
    { path: '/procurement/after-advance', label: 'Theo dõi sau tạm ứng B6', icon: ClipboardCheck, count: 'afterAdvance' },
    { path: '/procurement/supplement-invoice', label: 'Bổ sung hóa đơn B8', icon: FileWarning, count: 'supplementInvoice' },
    LOOKUP,
    HISTORY,
  ],
  LEADER: [
    { path: '/approvals/leader', label: 'Chờ tôi duyệt B2', icon: Inbox, count: 'leaderApproval' },
    LOOKUP,
    REPORTS,
    HISTORY,
  ],
  FINANCE_MANAGER: [
    { path: '/finance/coordination', label: 'Chờ TPTC duyệt B4', icon: Inbox, count: 'coordination' },
    { path: '/finance/monitor', label: 'Đang xử lý', icon: Workflow, count: 'financeMonitor' },
    REPORTS,
    LOOKUP,
    HISTORY,
  ],
  ACCOUNTANT: [
    { path: '/accounting/advance-payments', label: 'PKT tạm ứng B5', icon: Wallet, count: 'advancePayments' },
    { path: '/accounting/final-payments', label: 'PKT thanh toán B7', icon: Receipt, count: 'finalPayments' },
    { path: '/accounting/missing-invoices', label: 'Theo dõi thiếu HĐ', icon: FileWarning, count: 'missingInvoices' },
    LOOKUP,
    HISTORY,
  ],
  ADMIN: [
    { path: '/admin/requests', label: 'Quản lý phiếu', icon: ListChecks },
    { path: '/admin/users', label: 'Người dùng', icon: UserCog },
    { path: '/admin/master-data', label: 'Danh mục', icon: Database },
    { path: '/admin/config', label: 'Cấu hình', icon: Settings },
    { path: '/history', label: 'Nhật ký', icon: History },
    REPORTS,
  ],
};

/** Shared screens available to every role (workflow §9 "Dùng chung"). */
export const COMPLETED_MENU: MenuItem = { path: '/reports/completed-requests', label: 'Phiếu hoàn thành', icon: CheckCircle2 };

const SHARED = ['/lookup', '/requests/:id', COMPLETED_MENU.path, '/change-password'];

/** Extra routes reachable from inside a role's screens but not listed in its own menu. */
const EXTRA: Partial<Record<Role, string[]>> = {
  ADMIN: [
    '/procurement/requests/new',
    '/approvals/leader',
    '/finance/coordination',
    '/finance/monitor',
    '/procurement/overview',
    '/procurement/my-requests',
    '/procurement/after-advance',
    '/procurement/supplement-invoice',
    '/accounting/advance-payments',
    '/accounting/final-payments',
    '/accounting/missing-invoices',
  ],
};

export function allowedPatterns(role: Role): string[] {
  return [...SHARED, ...MENUS[role].map((m) => m.path), ...(EXTRA[role] ?? [])];
}

/** Landing screen after login — the role's first menu entry (workflow §9 has no "Trang chủ"). */
export function homePathFor(role: Role): string {
  return MENUS[role][0].path;
}
