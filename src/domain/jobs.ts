// Scheduler (workflow §6.7, §8.4): purge the audit log after N days; flag and remind overdue B8 invoices once a day.
import { invoiceCountdown, toDateKey } from './dates.ts';
import { notify } from './workflow.ts';
import type { Db } from './types.ts';

function cutoffOf(db: Db, now: Date): number {
  return now.getTime() - db.config.auditRetentionDays * 86400_000;
}

export function purgeAudit(db: Db, now: Date): number {
  const cutoff = cutoffOf(db, now);
  const before = db.audit.length;
  db.audit = db.audit.filter((e) => new Date(e.createdAt).getTime() >= cutoff);
  return before - db.audit.length;
}

/** Returns a new db if anything changed, otherwise the same reference. */
export function runDailyJobs(input: Db, now: Date): Db {
  const cutoff = cutoffOf(input, now);
  const today = toDateKey(now);
  const needsPurge = input.audit.some((e) => new Date(e.createdAt).getTime() < cutoff);
  const needsReminder = input.requests.some(
    (r) =>
      r.status === 'DOCUMENT_SUPPLEMENT_REQUIRED' &&
      r.invoiceDueStartAt &&
      r.lastLateReminderOn !== today &&
      invoiceCountdown(r.invoiceDueStartAt, now, input.config.invoiceDeadlineWorkingDays, input.holidays).overdue,
  );
  if (!needsPurge && !needsReminder) return input;

  const db: Db = structuredClone(input);
  purgeAudit(db, now);
  for (const pr of db.requests) {
    if (pr.status !== 'DOCUMENT_SUPPLEMENT_REQUIRED' || !pr.invoiceDueStartAt) continue;
    const cd = invoiceCountdown(pr.invoiceDueStartAt, now, db.config.invoiceDeadlineWorkingDays, db.holidays);
    if (!cd.overdue || pr.lastLateReminderOn === today) continue;
    // Flag only; lateness never changes the request status (workflow §6.7).
    pr.lateInvoice = true;
    pr.lastLateReminderOn = today;
    notify(
      db,
      [pr.assignedRequesterId, pr.assignedAccountantId],
      pr.id,
      '⏰ Trễ hạn bổ sung hóa đơn',
      `${pr.code}: đã quá ${db.config.invoiceDeadlineWorkingDays} ngày làm việc (hạn ${cd.dueDate})`,
      now,
    );
  }
  return db;
}
