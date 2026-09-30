// Username + password login with temporary lockout (workflow §11.1). Hashing is done by the caller.
import { fail } from './errors.ts';
import { audit } from './workflow.ts';
import type { Db, User } from './types.ts';

export function findByUsername(db: Db, username: string): User | undefined {
  const key = username.trim().toLowerCase();
  return db.users.find((u) => u.username.toLowerCase() === key);
}

export type LoginOutcome = { ok: true; userId: string } | { ok: false; code: string; message: string };

/**
 * Evaluates a login attempt. Always returns the updated db (failed attempts and lockouts must persist).
 * `passwordHash` is the hash of the submitted password computed with the stored user's salt (undefined if user unknown).
 */
export function attemptLogin(input: Db, username: string, passwordHash: string | undefined, now: Date): { db: Db; outcome: LoginOutcome } {
  const db: Db = structuredClone(input);
  const user = findByUsername(db, username);
  const bad = (code: string, message: string) => ({ db, outcome: { ok: false as const, code, message } });

  if (!user) {
    audit(db, null, 'LOGIN_FAILED', 'user', null, `Đăng nhập thất bại: username "${username.trim()}" không tồn tại`, now);
    return bad('ERR_INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
  }
  if (user.status === 'LOCKED') {
    audit(db, user.id, 'LOGIN_FAILED', 'user', user.id, 'Đăng nhập bị từ chối: tài khoản bị khóa', now);
    return bad('ERR_ACCOUNT_LOCKED', 'Tài khoản đã bị Admin khóa');
  }
  if (user.lockedUntil && new Date(user.lockedUntil) > now) {
    const mins = Math.ceil((new Date(user.lockedUntil).getTime() - now.getTime()) / 60000);
    audit(db, user.id, 'LOGIN_FAILED', 'user', user.id, 'Đăng nhập bị từ chối: đang khóa tạm', now);
    return bad('ERR_ACCOUNT_TEMP_LOCKED', `Tài khoản đang bị khóa tạm, thử lại sau ${mins} phút`);
  }
  if (passwordHash !== user.passwordHash) {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= db.config.maxLoginAttempts) {
      user.lockedUntil = new Date(now.getTime() + db.config.lockMinutes * 60000).toISOString();
      user.failedLoginCount = 0;
      audit(db, user.id, 'LOGIN_LOCKED', 'user', user.id, `Sai mật khẩu ${db.config.maxLoginAttempts} lần — khóa tạm ${db.config.lockMinutes} phút`, now);
      return bad('ERR_ACCOUNT_TEMP_LOCKED', `Sai mật khẩu quá ${db.config.maxLoginAttempts} lần. Tài khoản bị khóa tạm ${db.config.lockMinutes} phút`);
    }
    audit(db, user.id, 'LOGIN_FAILED', 'user', user.id, `Sai mật khẩu (lần ${user.failedLoginCount})`, now);
    const left = db.config.maxLoginAttempts - user.failedLoginCount;
    return bad('ERR_INVALID_CREDENTIALS', `Sai tên đăng nhập hoặc mật khẩu (còn ${left} lần thử)`);
  }
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  audit(db, user.id, 'LOGIN', 'user', user.id, 'Đăng nhập thành công', now);
  return { db, outcome: { ok: true, userId: user.id } };
}

export function validateNewPassword(password: string): void {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    fail('ERR_WEAK_PASSWORD', 'Mật khẩu tối thiểu 8 ký tự, gồm cả chữ và số');
  }
}

export function changePassword(
  input: Db,
  userId: string,
  currentHash: string,
  newHash: string,
  newPlain: string,
  now: Date,
): Db {
  const db: Db = structuredClone(input);
  const user = db.users.find((u) => u.id === userId);
  if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
  if (user.passwordHash !== currentHash) fail('ERR_INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng');
  validateNewPassword(newPlain);
  if (newHash === currentHash) fail('ERR_WEAK_PASSWORD', 'Mật khẩu mới phải khác mật khẩu hiện tại');
  user.passwordHash = newHash;
  user.mustChangePassword = false;
  audit(db, user.id, 'CHANGE_PASSWORD', 'user', user.id, 'Đổi mật khẩu', now);
  return db;
}
