// Users, master data, holidays, config (workflow §8.1, §11). Same atomic clone-and-apply pattern as workflow.ts.
import { ROLE_LABEL, isTerminal } from './constants.ts';
import { fail } from './errors.ts';
import { canManageMaster, findUser, isAdmin } from './permissions.ts';
import { audit, getActor, nextId } from './workflow.ts';
import type { Db, DepartmentKind, MasterKind, Role, SystemConfig, User } from './types.ts';

export interface UserInput {
  username: string;
  fullName: string;
  role: Role;
}

export type AdminAction =
  | { type: 'CREATE_USER'; input: UserInput; passwordHash: string }
  | { type: 'UPDATE_USER'; userId: string; input: UserInput }
  | { type: 'DELETE_USER'; userId: string }
  | { type: 'SET_USER_STATUS'; userId: string; status: 'ACTIVE' | 'LOCKED' }
  | { type: 'RESET_PASSWORD'; userId: string; passwordHash: string }
  | { type: 'SAVE_MASTER'; kind: MasterKind; id?: string; code: string; name: string }
  | { type: 'DELETE_MASTER'; kind: MasterKind; id: string }
  | { type: 'SAVE_DEPARTMENT'; id: string; code: string; name: string }
  | { type: 'SAVE_HOLIDAY'; date: string; name: string }
  | { type: 'DELETE_HOLIDAY'; date: string }
  | { type: 'SAVE_CONFIG'; config: SystemConfig }
  | { type: 'MARK_NOTIFICATIONS_READ'; ids: string[] | 'ALL' };

const MASTER_LABEL: Record<MasterKind, string> = {
  projects: 'Dự án',
  categories: 'Hạng mục chi',
  requesterNames: 'Người yêu cầu',
  accountantNames: 'Nhân viên kế toán',
  vendors: 'Nhà cung cấp',
};

const MASTER_FIELD: Record<MasterKind, 'projectId' | 'categoryId' | 'requesterNameId' | 'vendorId' | 'accountantNameId'> = {
  projects: 'projectId',
  categories: 'categoryId',
  requesterNames: 'requesterNameId',
  accountantNames: 'accountantNameId',
  vendors: 'vendorId',
};

/** The department of each role is fixed by the four-department structure; ADMIN belongs to none (workflow §2b). */
export const ROLE_DEPT_KIND: Record<Role, DepartmentKind | null> = {
  REQUESTER: 'PROCUREMENT',
  LEADER: 'BOARD',
  FINANCE_MANAGER: 'FINANCE',
  ACCOUNTANT: 'ACCOUNTING',
  ADMIN: null,
};

export function departmentForRole(db: Db, role: Role): string | null {
  const kind = ROLE_DEPT_KIND[role];
  if (!kind) return null;
  return db.departments.find((d) => d.kind === kind)?.id ?? null;
}

export function performAdmin(input: Db, actorId: string, action: AdminAction, now: Date): { db: Db; message: string } {
  const db: Db = structuredClone(input);
  const actor = getActor(db, actorId);
  const message = apply(db, actor, action, now);
  return { db, message };
}

function requireAdmin(actor: User): void {
  if (!isAdmin(actor)) fail('ERR_FORBIDDEN', 'Chỉ Admin được thực hiện thao tác này');
}

function validateUser(db: Db, input: UserInput, selfId: string | null): UserInput & { departmentId: string | null } {
  const username = input.username.trim();
  const fullName = input.fullName.trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    fail('ERR_REQUIRED_FIELD', 'Username 3–50 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới, gạch ngang');
  }
  if (!fullName) fail('ERR_REQUIRED_FIELD', 'Nhập họ tên');
  if (db.users.some((u) => u.id !== selfId && u.username.toLowerCase() === username.toLowerCase())) {
    fail('ERR_DUPLICATE_USERNAME', `Username "${username}" đã tồn tại`);
  }
  return { ...input, username, fullName, departmentId: departmentForRole(db, input.role) };
}

/**
 * Each of the four departments holds exactly one active account; the system always keeps
 * at least one active Admin (workflow §11.2).
 */
function checkInvariants(db: Db): void {
  for (const role of ['REQUESTER', 'LEADER', 'FINANCE_MANAGER', 'ACCOUNTANT'] as Role[]) {
    const holders = db.users.filter((u) => u.role === role && u.status === 'ACTIVE');
    if (holders.length > 1) {
      fail('ERR_DEPARTMENT_OCCUPIED', `Phòng ban này đã có tài khoản ${ROLE_LABEL[role]} đang hoạt động`);
    }
  }
  if (!db.users.some((u) => u.role === 'ADMIN' && u.status === 'ACTIVE')) {
    fail('ERR_LAST_ADMIN', 'Hệ thống phải còn ít nhất 1 Admin đang hoạt động');
  }
}

function openRequestsUsing(db: Db, field: string, id: string): number {
  return db.requests.filter((r) => !isTerminal(r.status) && (r as unknown as Record<string, unknown>)[field] === id).length;
}

function apply(db: Db, actor: User, action: AdminAction, now: Date): string {
  const me = actor.id;
  switch (action.type) {
    case 'CREATE_USER': {
      requireAdmin(actor);
      const input = validateUser(db, action.input, null);
      const user: User = {
        id: nextId(db, 'u'),
        ...input,
        passwordHash: action.passwordHash,
        mustChangePassword: true,
        status: 'ACTIVE',
        failedLoginCount: 0,
        lockedUntil: null,
        createdAt: now.toISOString(),
      };
      db.users.push(user);
      checkInvariants(db);
      audit(db, me, 'USER_CREATE', 'user', user.id, `Tạo tài khoản ${user.username} (${user.role})`, now);
      return `Đã tạo tài khoản ${user.username}`;
    }
    case 'UPDATE_USER': {
      requireAdmin(actor);
      const user = findUser(db, action.userId);
      if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
      const input = validateUser(db, action.input, user.id);
      const changes: string[] = [];
      if (user.username !== input.username) changes.push(`username ${user.username} → ${input.username}`);
      if (user.role !== input.role) changes.push(`vai trò ${ROLE_LABEL[user.role]} → ${ROLE_LABEL[input.role]}`);
      Object.assign(user, input);
      checkInvariants(db);
      audit(db, me, 'USER_UPDATE', 'user', user.id, `Sửa tài khoản ${user.username}${changes.length ? ': ' + changes.join(', ') : ''}`, now);
      return 'Đã lưu tài khoản';
    }
    case 'DELETE_USER': {
      requireAdmin(actor);
      const user = findUser(db, action.userId);
      if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
      if (user.id === me) fail('ERR_CANNOT_DELETE_SELF', 'Không thể xóa tài khoản đang đăng nhập');
      const linked = db.requests.filter(
        (r) => r.assignedRequesterId === user.id || r.assignedAccountantId === user.id || r.createdBy === user.id,
      ).length;
      if (linked > 0) {
        fail('ERR_USER_IN_USE', `Tài khoản đang gắn với ${linked} phiếu. Hãy khóa tài khoản thay vì xóa.`);
      }
      db.users = db.users.filter((u) => u.id !== user.id);
      checkInvariants(db);
      audit(db, me, 'USER_DELETE', 'user', user.id, `Xóa tài khoản ${user.username}`, now);
      return `Đã xóa tài khoản ${user.username}`;
    }
    case 'SET_USER_STATUS': {
      requireAdmin(actor);
      const user = findUser(db, action.userId);
      if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
      user.status = action.status;
      if (action.status === 'ACTIVE') {
        user.failedLoginCount = 0;
        user.lockedUntil = null;
      }
      checkInvariants(db);
      audit(db, me, action.status === 'LOCKED' ? 'USER_LOCK' : 'USER_UNLOCK', 'user', user.id, `${action.status === 'LOCKED' ? 'Khóa' : 'Mở khóa'} ${user.username}`, now);
      return action.status === 'LOCKED' ? 'Đã khóa tài khoản (phiên đang mở bị vô hiệu)' : 'Đã mở khóa tài khoản';
    }
    case 'RESET_PASSWORD': {
      requireAdmin(actor);
      const user = findUser(db, action.userId);
      if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
      user.passwordHash = action.passwordHash;
      user.mustChangePassword = true;
      user.failedLoginCount = 0;
      user.lockedUntil = null;
      audit(db, me, 'USER_RESET_PASSWORD', 'user', user.id, `Đặt lại mật khẩu ${user.username}`, now);
      return 'Đã đặt lại mật khẩu; người dùng phải đổi ở lần đăng nhập tới';
    }

    case 'SAVE_MASTER': {
      if (!canManageMaster(actor, action.kind)) fail('ERR_FORBIDDEN', 'Bạn chỉ được xem danh mục này');
      const name = action.name.trim();
      const code = action.code.trim();
      if (!name) fail('ERR_REQUIRED_FIELD', 'Nhập tên');
      const list = db[action.kind];
      if (list.some((x) => !x.deleted && x.id !== action.id && x.name.toLowerCase() === name.toLowerCase())) {
        fail('ERR_REQUIRED_FIELD', `"${name}" đã có trong danh mục`);
      }
      if (action.id) {
        const item = list.find((x) => x.id === action.id && !x.deleted);
        if (!item) fail('ERR_NOT_FOUND', 'Không tìm thấy mục');
        item.name = name;
        item.code = code;
      } else {
        list.push({ id: nextId(db, action.kind.slice(0, 3)), code, name, deleted: false });
      }
      audit(db, me, 'MASTER_SAVE', action.kind, action.id ?? null, `${MASTER_LABEL[action.kind]}: ${name}`, now);
      return 'Đã lưu danh mục';
    }
    case 'DELETE_MASTER': {
      if (!canManageMaster(actor, action.kind)) fail('ERR_FORBIDDEN', 'Bạn chỉ được xem danh mục này');
      const item = db[action.kind].find((x) => x.id === action.id && !x.deleted);
      if (!item) fail('ERR_NOT_FOUND', 'Không tìm thấy mục');
      const used = openRequestsUsing(db, MASTER_FIELD[action.kind], item.id);
      if (used > 0) fail('ERR_MASTER_DATA_IN_USE', `"${item.name}" đang gắn với ${used} phiếu chưa kết thúc`);
      item.deleted = true;
      audit(db, me, 'MASTER_DELETE', action.kind, item.id, `${MASTER_LABEL[action.kind]}: xóa mềm ${item.name}`, now);
      return 'Đã xóa (xóa mềm)';
    }
    case 'SAVE_DEPARTMENT': {
      // The four departments are fixed: Admin may rename them, not add, delete or change their kind.
      if (!canManageMaster(actor, 'departments')) fail('ERR_FORBIDDEN', 'Chỉ Admin quản lý phòng ban');
      const name = action.name.trim();
      if (!name || !action.code.trim()) fail('ERR_REQUIRED_FIELD', 'Nhập mã và tên phòng ban');
      const d = db.departments.find((x) => x.id === action.id);
      if (!d) fail('ERR_NOT_FOUND', 'Không tìm thấy phòng ban');
      d.code = action.code.trim();
      d.name = name;
      audit(db, me, 'DEPARTMENT_SAVE', 'department', d.id, `Phòng ban: ${name}`, now);
      return 'Đã lưu phòng ban';
    }

    case 'SAVE_HOLIDAY': {
      requireAdmin(actor);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.date) || !action.name.trim()) fail('ERR_REQUIRED_FIELD', 'Nhập ngày và tên ngày lễ');
      db.holidays = db.holidays.filter((h) => h.date !== action.date);
      db.holidays.push({ date: action.date, name: action.name.trim() });
      db.holidays.sort((a, b) => a.date.localeCompare(b.date));
      audit(db, me, 'HOLIDAY_SAVE', 'holiday', action.date, `Ngày lễ ${action.date}: ${action.name}`, now);
      return 'Đã lưu ngày lễ';
    }
    case 'DELETE_HOLIDAY': {
      requireAdmin(actor);
      db.holidays = db.holidays.filter((h) => h.date !== action.date);
      audit(db, me, 'HOLIDAY_DELETE', 'holiday', action.date, `Xóa ngày lễ ${action.date}`, now);
      return 'Đã xóa ngày lễ';
    }
    case 'SAVE_CONFIG': {
      requireAdmin(actor);
      const c = action.config;
      const ints: [number, string][] = [
        [c.invoiceDeadlineWorkingDays, 'Hạn bổ sung hóa đơn'],
        [c.maxLoginAttempts, 'Số lần đăng nhập sai'],
        [c.lockMinutes, 'Thời gian khóa tạm'],
        [c.maxFileSizeMb, 'Dung lượng file tối đa'],
        [c.auditRetentionDays, 'Số ngày lưu nhật ký'],
      ];
      for (const [v, label] of ints) {
        if (!Number.isInteger(v) || v < 1) fail('ERR_REQUIRED_FIELD', `${label} phải là số nguyên ≥ 1`);
      }
      if (c.allowedExtensions.length === 0) fail('ERR_REQUIRED_FIELD', 'Phải cho phép ít nhất 1 định dạng file');
      db.config = { ...c, allowedExtensions: [...new Set(c.allowedExtensions.map((e) => e.toLowerCase()))] };
      audit(db, me, 'CONFIG_SAVE', 'config', null, 'Cập nhật cấu hình hệ thống', now);
      return 'Đã lưu cấu hình';
    }
    case 'MARK_NOTIFICATIONS_READ': {
      for (const n of db.notifications) {
        if (n.userId === me && (action.ids === 'ALL' || action.ids.includes(n.id))) n.read = true;
      }
      return '';
    }
  }
}
