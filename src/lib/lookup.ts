import type { Db, MasterKind } from '../domain/types';

export function userName(db: Db, id: string | null | undefined): string {
  if (!id) return '—';
  return db.users.find((u) => u.id === id)?.fullName ?? '(đã xóa)';
}

export function deptName(db: Db, id: string | null | undefined): string {
  if (!id) return '—';
  return db.departments.find((d) => d.id === id)?.name ?? '—';
}

/** Soft-deleted items keep their name on old requests (workflow §8.1). */
export function masterName(db: Db, kind: MasterKind, id: string | null | undefined): string {
  if (!id) return '—';
  const item = db[kind].find((x) => x.id === id);
  return item ? item.name + (item.deleted ? ' (đã xóa)' : '') : '—';
}
