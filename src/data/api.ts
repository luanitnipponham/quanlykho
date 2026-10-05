// REST client for the v3.4 backend (docs/api.md). Requests go through the Vite proxy at /api.
import { DomainError, type ErrorCode } from '../domain/errors';
import type { Status } from '../domain/types';

const BASE = '/api/v1';
const ACCESS_KEY = 'pyc.access';
const REFRESH_KEY = 'pyc.refresh';

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: tokens stay in memory only */
  }
}

export const tokens = {
  get access() {
    return read(ACCESS_KEY);
  },
  get refresh() {
    return read(REFRESH_KEY);
  },
  set(access: string | null, refresh: string | null) {
    write(ACCESS_KEY, access);
    write(REFRESH_KEY, refresh);
  },
  clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
  },
};

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || !body.success) {
    const code = (body.error?.code ?? 'ERR_INTERNAL') as ErrorCode;
    throw new DomainError(code, body.error?.message ?? `Lỗi ${res.status}`);
  }
  return body.data as T;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const access = tokens.access;
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...(init.headers as Record<string, string>),
    },
  });
  // One transparent refresh, then give up and let the caller send the user back to login.
  if (res.status === 401 && retry && tokens.refresh) {
    const ok = await refreshSession();
    if (ok) return call<T>(path, init, false);
  }
  return parse<T>(res);
}

async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    });
    const body = (await res.json()) as ApiEnvelope<{ accessToken: string; refreshToken: string }>;
    if (!body.success || !body.data) return false;
    tokens.set(body.data.accessToken, body.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string, body?: unknown) => call<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  user: { id: string; username: string; fullName: string; role: string };
}

export const api = {
  /** True when the NestJS backend answers; drives the demo-mode fallback. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/departments`, { method: 'GET' });
      return res.status < 500;
    } catch {
      return false;
    }
  },

  login: (username: string, password: string) => post<LoginResult>('/auth/login', { username, password }),
  me: () => get<{ id: string; role: string; mustChangePassword: boolean }>('/auth/me'),
  logout: () => post('/auth/logout'),
  changePassword: (oldPassword: string, newPassword: string) => post('/auth/change-password', { oldPassword, newPassword }),

  departments: () => get<unknown[]>('/departments'),
  renameDepartment: (id: string, code: string, name: string) => patch(`/departments/${id}`, { code, name }),

  users: () => get<unknown[]>('/users'),
  createUser: (body: unknown) => post('/users', body),
  updateUser: (id: string, body: unknown) => patch(`/users/${id}`, body),
  setUserStatus: (id: string, status: 'ACTIVE' | 'LOCKED') => post(`/users/${id}/status`, { status }),
  resetPassword: (id: string, password: string) => post(`/users/${id}/reset-password`, { password }),
  deleteUser: (id: string) => del(`/users/${id}`),

  master: (kind: string) => get<unknown[]>(`/master-data/${kind}`),
  createMaster: (kind: string, body: unknown) => post(`/master-data/${kind}`, body),
  updateMaster: (kind: string, id: string, body: unknown) => patch(`/master-data/${kind}/${id}`, body),
  deleteMaster: (kind: string, id: string) => del(`/master-data/${kind}/${id}`),

  requests: (queue: string) => get<unknown[]>(`/payment-requests?queue=${encodeURIComponent(queue)}`),
  /** Full working set in one call, used to hydrate the in-memory snapshot. */
  snapshot: () => get<unknown[]>('/payment-requests/snapshot'),
  request: (id: string) => get<unknown>(`/payment-requests/${id}`),
  createRequest: (body: unknown) => post<{ id: string; code: string; message: string }>('/payment-requests', body),
  updateRequest: (id: string, body: unknown) => patch(`/payment-requests/${id}`, body),
  action: (id: string, verb: string, body: unknown) => post<{ message: string; warning?: string; status?: Status }>(`/payment-requests/${id}/${verb}`, body),
  transfer: (body: unknown) => post<{ message: string }>('/payment-requests/transfer', body),
  deleteRequest: (id: string, reason: string, version: number) => del<{ message: string }>(`/payment-requests/${id}`, { reason, version }),
  archiveRequest: (id: string, version: number) => post<{ message: string }>(`/payment-requests/${id}/archive`, { version }),
  restoreRequest: (id: string, version: number) => post<{ message: string }>(`/payment-requests/${id}/restore`, { version }),
  comment: (id: string, content: string) => post(`/payment-requests/${id}/comments`, { content }),
  notifyMissingDocs: (id: string, note?: string) => post<{ message: string }>(`/payment-requests/${id}/notify-missing-docs`, { note }),

  attachments: (id: string) => get<unknown[]>(`/payment-requests/${id}/attachments`),
  upload: (id: string, slot: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return call<{ attachments: unknown[]; message: string }>(`/payment-requests/${id}/attachments/${slot}`, { method: 'POST', body: form });
  },
  downloadUrl: (attachmentId: string) => `${BASE}/attachments/${attachmentId}/download`,
  deleteAttachment: (attachmentId: string) => del<{ message: string }>(`/attachments/${attachmentId}`),

  config: () => get<Record<string, unknown>>('/config'),
  saveConfig: (body: unknown) => patch('/config', body),
  holidays: () => get<{ date: string; name: string }[]>('/holidays'),
  saveHoliday: (date: string, name: string) => post('/holidays', { date, name }),
  deleteHoliday: (date: string) => del(`/holidays/${date}`),

  history: () => get<unknown[]>('/history'),
  notifications: () => get<unknown[]>('/notifications'),
  markRead: (ids: string[] | 'ALL') => post('/notifications/read', { ids }),
};
