import type { Holiday } from './types.ts';

/** Local calendar date as YYYY-MM-DD. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isWorkingDay(d: Date, holidays: Holiday[]): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const key = toDateKey(d);
  return !holidays.some((h) => h.date === key);
}

/** The date that is `n` working days after `start` (start day itself not counted). */
export function addWorkingDays(start: Date, n: number, holidays: Holiday[]): Date {
  const d = parseDateKey(toDateKey(start));
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, holidays)) added++;
  }
  return d;
}

/** Working days elapsed after `start` up to and including `now`'s date. */
export function workingDaysElapsed(start: Date, now: Date, holidays: Holiday[]): number {
  const d = parseDateKey(toDateKey(start));
  const end = toDateKey(now);
  let count = 0;
  while (toDateKey(d) < end) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, holidays)) count++;
  }
  return count;
}

export interface InvoiceCountdown {
  dueDate: string;
  elapsed: number;
  remaining: number;
  overdue: boolean;
  tone: 'ok' | 'warn' | 'late';
}

export function invoiceCountdown(
  startIso: string,
  now: Date,
  deadlineDays: number,
  holidays: Holiday[],
): InvoiceCountdown {
  const start = new Date(startIso);
  const elapsed = workingDaysElapsed(start, now, holidays);
  const remaining = deadlineDays - elapsed;
  const overdue = elapsed > deadlineDays;
  return {
    dueDate: toDateKey(addWorkingDays(start, deadlineDays, holidays)),
    elapsed,
    remaining,
    overdue,
    tone: overdue ? 'late' : remaining <= 1 ? 'warn' : 'ok',
  };
}
