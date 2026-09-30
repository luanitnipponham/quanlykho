/**
 * Single state holder for the screens.
 *
 * Two modes:
 *  - server: the NestJS backend at /api is reachable. PostgreSQL is the source of truth;
 *    every write goes through the API and the snapshot is re-read afterwards.
 *  - local:  no backend. The same rules run in the browser (src/domain) over localStorage,
 *    so the app stays usable for demos and review.
 */
import { performAdmin, type AdminAction, type UserInput } from '../domain/admin';
import { attemptLogin, changePassword as changePasswordDomain, findByUsername, validateNewPassword } from '../domain/auth';
import { DEFAULT_PASSWORD_HINT } from '../domain/constants';
import { DomainError } from '../domain/errors';
import { runDailyJobs } from '../domain/jobs';
import { admins, findUser } from '../domain/permissions';
import { SCHEMA_VERSION, SEED_ACCOUNTS, buildSeed } from '../domain/seed';
import { notify, perform, type WorkflowAction, type WorkflowResult } from '../domain/workflow';
import type { Attachment, Db, Slot, User } from '../domain/types';
import { api, tokens } from './api';
import { clearBlobs, deleteBlobs, getBlob, putBlobs } from './files';
import { hashPassword, hashWithStoredSalt } from './password';
import { fetchDb } from './sync';

const DB_KEY = 'pyc.db';
const SESSION_KEY = 'pyc.session';

export type Mode = 'server' | 'local';

type Listener = () => void;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the in-memory state still works for this tab.
  }
}

class Store {
  private db: Db | null = null;
  private sessionUserId: string | null = null;
  private listeners = new Set<Listener>();
  private jobTimer: number | undefined;
  mode: Mode = 'local';

  // ----- lifecycle ---------------------------------------------------------

  /**
   * True in the Docker/production build. The demo fallback is then refused: losing the
   * backend must surface as an error, never as writes that silently stay in the browser.
   */
  readonly backendRequired = import.meta.env.VITE_REQUIRE_BACKEND === 'true';
  backendUnreachable = false;

  async init(): Promise<void> {
    this.mode = (await api.ping()) ? 'server' : 'local';

    if (this.mode === 'local' && this.backendRequired) {
      this.backendUnreachable = true;
      this.db = emptyShell();
      this.emit();
      return;
    }

    if (this.mode === 'server') {
      this.db = emptyShell();
      if (tokens.access) {
        try {
          const me = await api.me();
          this.sessionUserId = me.id;
          await this.pull();
        } catch {
          this.signOutLocally();
        }
      }
    } else {
      const raw = safeGet(DB_KEY);
      let db: Db | null = null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Db;
          if (parsed.schemaVersion === SCHEMA_VERSION) db = parsed;
        } catch {
          db = null;
        }
      }
      this.db = runDailyJobs(db ?? (await this.freshSeed()), new Date());
      this.persist();
      this.sessionUserId = safeGet(SESSION_KEY);
      this.validateSession();
      window.addEventListener('storage', (e) => {
        if (e.key === DB_KEY || e.key === SESSION_KEY) {
          this.reload();
          this.sessionUserId = safeGet(SESSION_KEY);
          this.validateSession();
          this.emit();
        }
      });
      window.clearInterval(this.jobTimer);
      this.jobTimer = window.setInterval(() => this.runLocalJobs(), 60_000);
    }
    this.emit();
  }

  private async freshSeed(): Promise<Db> {
    const hashes: Record<string, string> = {};
    for (const a of SEED_ACCOUNTS) hashes[a.id] = await hashPassword(DEFAULT_PASSWORD_HINT);
    return buildSeed((id) => hashes[id], new Date());
  }

  /** Re-reads the whole working set from the backend. */
  private async pull(): Promise<void> {
    this.db = await fetchDb();
    this.emit();
  }

  /** Demo mode only: wipes and re-seeds the browser copy. */
  async resetDemo(): Promise<void> {
    if (this.mode === 'server') throw new DomainError('ERR_FORBIDDEN', 'Đang chạy với PostgreSQL — dùng lệnh npm run db:reset ở apps/api');
    await clearBlobs().catch(() => undefined);
    this.db = runDailyJobs(await this.freshSeed(), new Date());
    this.persist();
    this.logout();
  }

  private runLocalJobs(): void {
    this.reload();
    const next = runDailyJobs(this.state, new Date());
    if (next !== this.state) {
      this.db = next;
      this.persist();
    }
    this.validateSession();
    this.emit();
  }

  // ----- subscription (useSyncExternalStore) -------------------------------

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getDb = (): Db => this.state;

  getSessionUserId = (): string | null => this.sessionUserId;

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private get state(): Db {
    if (!this.db) throw new Error('Store chưa khởi tạo');
    return this.db;
  }

  private reload(): void {
    if (this.mode === 'server') return;
    const raw = safeGet(DB_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.schemaVersion === SCHEMA_VERSION) this.db = parsed;
    } catch {
      // keep in-memory copy
    }
  }

  private persist(): void {
    if (this.mode === 'server') return;
    safeSet(DB_KEY, JSON.stringify(this.state));
  }

  private commit(db: Db): void {
    this.db = db;
    this.persist();
    this.emit();
  }

  // ----- session ------------------------------------------------------------

  currentUser(): User | null {
    return findUser(this.state, this.sessionUserId) ?? null;
  }

  private validateSession(): void {
    if (!this.sessionUserId || !this.db) return;
    const u = findUser(this.db, this.sessionUserId);
    if (!u || u.status !== 'ACTIVE') this.signOutLocally();
  }

  private signOutLocally(): void {
    this.sessionUserId = null;
    safeSet(SESSION_KEY, null);
    tokens.clear();
  }

  private requireUserId(): string {
    this.validateSession();
    if (!this.sessionUserId) throw new DomainError('ERR_FORBIDDEN', 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại');
    return this.sessionUserId;
  }

  async login(username: string, password: string): Promise<void> {
    if (this.mode === 'server') {
      const res = await api.login(username, password);
      tokens.set(res.accessToken, res.refreshToken);
      this.sessionUserId = res.user.id;
      safeSet(SESSION_KEY, res.user.id);
      await this.pull();
      return;
    }
    this.reload();
    const user = findByUsername(this.state, username);
    const submitted = user ? await hashWithStoredSalt(password, user.passwordHash) : undefined;
    const { db, outcome } = attemptLogin(this.state, username, submitted, new Date());
    this.commit(db);
    if (!outcome.ok) throw new DomainError(outcome.code as never, outcome.message);
    this.sessionUserId = outcome.userId;
    safeSet(SESSION_KEY, outcome.userId);
    this.emit();
  }

  logout(): void {
    if (this.mode === 'server') {
      void api.logout().catch(() => undefined);
      this.signOutLocally();
      this.db = emptyShell();
      this.emit();
      return;
    }
    if (this.sessionUserId && this.db) {
      const db = structuredClone(this.db);
      db.audit.push({
        id: `log-out-${Date.now()}`,
        actorId: this.sessionUserId,
        action: 'LOGOUT',
        entity: 'user',
        entityId: this.sessionUserId,
        detail: 'Đăng xuất',
        createdAt: new Date().toISOString(),
      });
      this.db = db;
      this.persist();
    }
    this.signOutLocally();
    this.emit();
  }

  async changePassword(current: string, next: string): Promise<void> {
    if (this.mode === 'server') {
      await api.changePassword(current, next);
      await this.pull();
      return;
    }
    const userId = this.requireUserId();
    this.reload();
    const user = findUser(this.state, userId)!;
    const currentHash = await hashWithStoredSalt(current, user.passwordHash);
    const newHash = await hashPassword(next);
    this.commit(changePasswordDomain(this.state, userId, currentHash, newHash, next, new Date()));
  }

  // ----- workflow -----------------------------------------------------------

  /**
   * Local mode applies the action synchronously. Server mode posts it and refreshes;
   * callers that need the result await `runAsync` instead.
   */
  run(action: WorkflowAction): WorkflowResult | Promise<WorkflowResult> {
    if (this.mode === 'server') return this.runAsync(action);
    const actor = this.requireUserId();
    this.reload();
    try {
      const { db, result } = perform(this.state, actor, action, new Date());
      this.commit(db);
      if (result.removedAttachmentIds?.length) void deleteBlobs(result.removedAttachmentIds);
      return result;
    } catch (e) {
      this.handleAlert(e);
      throw e;
    }
  }

  async runAsync(action: WorkflowAction): Promise<WorkflowResult> {
    if (this.mode === 'local') return this.run(action) as WorkflowResult;
    const result = await this.send(action);
    await this.pull();
    return result;
  }

  /** Translates a domain action into its REST endpoint (docs/api.md §4, §5). */
  private async send(a: WorkflowAction): Promise<WorkflowResult> {
    switch (a.type) {
      case 'CREATE_REQUEST': {
        const r = await api.createRequest({ ...a.fields, assignedRequesterId: a.assignedRequesterId });
        return { requestId: r.id, message: r.message };
      }
      case 'UPDATE_INFO':
        return api.updateRequest(a.id, { ...a.fields, version: a.version }) as Promise<WorkflowResult>;
      case 'SUBMIT':
        return api.action(a.id, 'submit', { version: a.version, confirmed: a.confirmed });
      case 'CANCEL':
        return api.action(a.id, 'cancel', { version: a.version });
      case 'LEADER_APPROVE':
        return api.action(a.id, 'leader-approve', { version: a.version, confirmed: a.confirmed, note: a.note });
      case 'LEADER_REJECT':
        return api.action(a.id, 'leader-reject', { version: a.version, reason: a.reason });
      case 'LEADER_RETURN':
        return api.action(a.id, 'leader-return', { version: a.version, reason: a.reason });
      case 'SUBMIT_ADVANCE':
        return api.action(a.id, 'submit-advance', { version: a.version, confirmed: a.confirmed, advanceAmount: a.advanceAmount });
      case 'FINANCE_APPROVE':
        return api.action(a.id, 'finance-approve', { version: a.version, confirmed: a.confirmed, priority: a.priority, note: a.note });
      case 'PAY_ADVANCE':
        return api.action(a.id, 'pay-advance', { version: a.version, checkedDocs: a.checkedDocs, paid: a.paid, method: a.method, paidDate: a.paidDate });
      case 'SUBMIT_SETTLEMENT':
        return api.action(a.id, 'submit-settlement', { version: a.version, confirmed: a.confirmed, settlementAmount: a.settlementAmount });
      case 'PAY_FINAL':
        return api.action(a.id, 'pay-final', { version: a.version, checkedDocs: a.checkedDocs, completed: a.completed, method: a.method, paidDate: a.paidDate });
      case 'COMPLETE_INVOICE':
        return api.action(a.id, 'complete-invoice', { version: a.version });
      case 'FORCE':
        return api.action(a.id, 'force', { version: a.version, toStatus: a.toStatus, reason: a.reason });
      case 'ADMIN_CANCEL':
        return api.action(a.id, 'admin-cancel', { version: a.version, reason: a.reason });
      case 'REOPEN':
        return api.action(a.id, 'reopen', { version: a.version, reason: a.reason, toStatus: a.toStatus });
      case 'TRANSFER':
        return api.transfer({ items: a.items, toRequesterId: a.toRequesterId, reason: a.reason });
      case 'DELETE_REQUEST':
        return api.deleteRequest(a.id, a.reason, a.version);
      case 'COMMENT':
        return (await api.comment(a.id, a.content), { message: 'Đã gửi comment' });
      case 'DETACH':
        return api.deleteAttachment(a.attachmentId);
      default:
        throw new DomainError('ERR_INVALID_TRANSITION', 'Thao tác chưa được hỗ trợ ở chế độ nối backend');
    }
  }

  async upload(requestId: string, slot: Slot, files: File[]): Promise<Attachment[]> {
    if (this.mode === 'server') {
      const res = await api.upload(requestId, slot, files);
      await this.pull();
      return res.attachments as Attachment[];
    }
    const actor = this.requireUserId();
    this.reload();
    const { db, result } = perform(
      this.state,
      actor,
      { type: 'ATTACH', id: requestId, slot, files: files.map((f) => ({ fileName: f.name, size: f.size, mimeType: f.type })) },
      new Date(),
    );
    const created = result.attachments ?? [];
    await putBlobs(created.map((a, i) => ({ id: a.id, blob: files[i] })));
    this.commit(db);
    return created;
  }

  /** Server mode streams from the API; demo mode reads IndexedDB or returns a placeholder. */
  async fileBlob(att: Attachment): Promise<{ blob: Blob; placeholder: boolean }> {
    if (this.mode === 'server') {
      const res = await fetch(api.downloadUrl(att.id), { headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {} });
      if (!res.ok) throw new DomainError('ERR_NOT_FOUND', 'Không tải được file từ máy chủ');
      return { blob: await res.blob(), placeholder: false };
    }
    const blob = await getBlob(att.id).catch(() => undefined);
    if (blob) return { blob, placeholder: false };
    const text = `Tệp mẫu (dữ liệu demo)\n\nTên file: ${att.fileName}\nĐường dẫn lưu trữ: ${att.storagePath}\nTải lên lúc: ${att.uploadedAt}\n`;
    return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), placeholder: true };
  }

  /** Rejected actions roll back, but "báo Admin" side effects must still be delivered. */
  private handleAlert(e: unknown): void {
    if (this.mode === 'server') return; // the backend writes its own alert
    if (!(e instanceof DomainError) || !e.alertAdmins) return;
    const db = structuredClone(this.state);
    const a = e.alertAdmins;
    notify(db, admins(db).map((u) => u.id), a.requestId, a.title, a.message, new Date());
    this.commit(db);
  }

  // ----- admin / master data -----------------------------------------------

  admin(action: AdminAction): string | Promise<string> {
    if (this.mode === 'server') return this.adminAsync(action);
    const actor = this.requireUserId();
    this.reload();
    const { db, message } = performAdmin(this.state, actor, action, new Date());
    this.commit(db);
    this.validateSession();
    return message;
  }

  async adminAsync(action: AdminAction): Promise<string> {
    if (this.mode === 'local') return this.admin(action) as string;
    const message = await this.sendAdmin(action);
    await this.pull();
    return message;
  }

  private async sendAdmin(a: AdminAction): Promise<string> {
    const msg = (r: unknown) => ((r as { message?: string })?.message ?? '');
    switch (a.type) {
      case 'CREATE_USER':
        return msg(await api.createUser({ username: a.input.username, fullName: a.input.fullName, role: a.input.role, password: a.passwordHash }));
      case 'UPDATE_USER':
        return msg(await api.updateUser(a.userId, a.input));
      case 'DELETE_USER':
        return msg(await api.deleteUser(a.userId));
      case 'SET_USER_STATUS':
        return msg(await api.setUserStatus(a.userId, a.status));
      case 'RESET_PASSWORD':
        return msg(await api.resetPassword(a.userId, a.passwordHash));
      case 'SAVE_MASTER':
        return msg(
          a.id ? await api.updateMaster(a.kind, a.id, { code: a.code, name: a.name }) : await api.createMaster(a.kind, { code: a.code, name: a.name }),
        );
      case 'DELETE_MASTER':
        return msg(await api.deleteMaster(a.kind, a.id));
      case 'SAVE_DEPARTMENT':
        return msg(await api.renameDepartment(a.id, a.code, a.name));
      case 'SAVE_HOLIDAY':
        return msg(await api.saveHoliday(a.date, a.name));
      case 'DELETE_HOLIDAY':
        return msg(await api.deleteHoliday(a.date));
      case 'SAVE_CONFIG':
        return msg(await api.saveConfig(a.config));
      case 'MARK_NOTIFICATIONS_READ':
        return msg(await api.markRead(a.ids));
      default:
        throw new DomainError('ERR_FORBIDDEN', 'Thao tác chưa được hỗ trợ ở chế độ nối backend');
    }
  }

  async createUser(input: UserInput, tempPassword: string): Promise<string> {
    validateNewPassword(tempPassword);
    if (this.mode === 'server') return this.adminAsync({ type: 'CREATE_USER', input, passwordHash: tempPassword });
    return this.admin({ type: 'CREATE_USER', input, passwordHash: await hashPassword(tempPassword) });
  }

  async resetPassword(userId: string, tempPassword: string): Promise<string> {
    validateNewPassword(tempPassword);
    if (this.mode === 'server') return this.adminAsync({ type: 'RESET_PASSWORD', userId, passwordHash: tempPassword });
    return this.admin({ type: 'RESET_PASSWORD', userId, passwordHash: await hashPassword(tempPassword) });
  }
}

/** Placeholder snapshot shown before login in server mode. */
function emptyShell(): Db {
  return {
    schemaVersion: SCHEMA_VERSION,
    users: [],
    departments: [],
    projects: [],
    categories: [],
    requesterNames: [],
    vendors: [],
    requests: [],
    attachments: [],
    comments: [],
    notifications: [],
    audit: [],
    holidays: [],
    config: {
      invoiceDeadlineWorkingDays: 5,
      maxLoginAttempts: 5,
      lockMinutes: 15,
      maxFileSizeMb: 25,
      auditRetentionDays: 6,
      allowedExtensions: [],
    },
    seq: {},
    idCounter: 0,
  };
}

export const store = new Store();
