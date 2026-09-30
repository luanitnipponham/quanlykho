import { useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { DomainError } from '../domain/errors';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  title: string;
  detail?: string;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function push(t: Omit<Toast, 'id'>) {
  const id = ++seq;
  toasts = [...toasts, { ...t, id }];
  emit();
  window.setTimeout(() => dismiss(id), t.kind === 'error' ? 7000 : 3500);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (title: string) => push({ kind: 'success', title }),
  error: (err: unknown) => {
    if (err instanceof DomainError) push({ kind: 'error', title: err.message, detail: err.code });
    else push({ kind: 'error', title: err instanceof Error ? err.message : 'Đã có lỗi xảy ra' });
  },
};

/** Runs a store call, toasting the success message or the domain error. Returns true on success. */
export async function attempt(fn: () => unknown | Promise<unknown>, success?: string): Promise<boolean> {
  try {
    const r = await fn();
    const msg = success ?? (r && typeof r === 'object' && 'message' in r ? String((r as { message: string }).message) : typeof r === 'string' ? r : '');
    if (msg) toast.success(msg);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

export function Toaster() {
  const list = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
  );
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            t.kind === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.title}</p>
            {t.detail && <p className="mt-0.5 font-mono text-xs opacity-70">{t.detail}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100" aria-label="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
