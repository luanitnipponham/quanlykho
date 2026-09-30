import { useEffect, useState, useSyncExternalStore } from 'react';
import { findUser } from '../domain/permissions';
import type { Db, User } from '../domain/types';
import { store } from './store';

export function useDb(): Db {
  return useSyncExternalStore(store.subscribe, store.getDb);
}

export function useSessionUserId(): string | null {
  return useSyncExternalStore(store.subscribe, store.getSessionUserId);
}

export function useCurrentUser(): User | null {
  const db = useDb();
  const id = useSessionUserId();
  return findUser(db, id) ?? null;
}

/** Signed-in user; only call inside the authenticated shell. */
export function useMe(): User {
  const me = useCurrentUser();
  if (!me) throw new Error('Chưa đăng nhập');
  return me;
}

/** Current time, refreshed every minute (countdowns, absences "hôm nay"). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
