import { AlarmClock, Check, RotateCcw } from 'lucide-react';
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_STEP, WORKING_STATUSES, stepIndex } from '../domain/constants';
import { invoiceCountdown } from '../domain/dates';
import type { Db, PaymentRequest, Priority, Status } from '../domain/types';
import { cx, formatDate } from '../lib/format';

const STATUS_TONE: Record<Status, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  LEADER_APPROVAL: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  ADVANCE_PREPARATION: 'bg-cyan-50 text-cyan-800 ring-cyan-200',
  COORDINATION: 'bg-violet-50 text-violet-800 ring-violet-200',
  ADVANCE_PAYMENT: 'bg-amber-50 text-amber-800 ring-amber-200',
  AFTER_ADVANCE: 'bg-teal-50 text-teal-800 ring-teal-200',
  FINAL_PAYMENT: 'bg-orange-50 text-orange-800 ring-orange-200',
  DOCUMENT_SUPPLEMENT_REQUIRED: 'bg-rose-50 text-rose-800 ring-rose-200',
  COMPLETED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-200',
  REJECTED: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusBadge({ status, compact }: { status: Status; compact?: boolean }) {
  const step = STATUS_STEP[status];
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_TONE[status])}>
      {step !== 'Kết thúc' && <span className="font-mono text-[10px] opacity-70">{step}</span>}
      {!compact && STATUS_LABEL[status]}
      {compact && step === 'Kết thúc' && STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_TONE: Record<Priority, string> = {
  HIGH: 'bg-red-50 text-red-700 ring-red-200',
  MEDIUM: 'bg-slate-100 text-slate-700 ring-slate-200',
  LOW: 'bg-white text-slate-500 ring-slate-200',
};

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', PRIORITY_TONE[priority])}>Ưu tiên {PRIORITY_LABEL[priority].toLowerCase()}</span>;
}

export function Flags({ pr }: { pr: PaymentRequest }) {
  return (
    <>
      {pr.resubmitted && pr.status === 'LEADER_APPROVAL' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
          <RotateCcw className="h-3 w-3" /> Gửi lại
        </span>
      )}
      {pr.resubmitted && pr.status === 'DRAFT' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
          <RotateCcw className="h-3 w-3" /> Bị trả lại
        </span>
      )}
      {pr.lateInvoice && pr.status === 'DOCUMENT_SUPPLEMENT_REQUIRED' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
          <AlarmClock className="h-3 w-3" /> Trễ hạn HĐ
        </span>
      )}
    </>
  );
}

export function InvoiceCountdownBadge({ pr, db, now }: { pr: PaymentRequest; db: Db; now: Date }) {
  if (pr.status !== 'DOCUMENT_SUPPLEMENT_REQUIRED' || !pr.invoiceDueStartAt) return null;
  const cd = invoiceCountdown(pr.invoiceDueStartAt, now, db.config.invoiceDeadlineWorkingDays, db.holidays);
  const tone = { ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200', warn: 'bg-amber-50 text-amber-800 ring-amber-200', late: 'bg-red-50 text-red-800 ring-red-200' }[cd.tone];
  const text = cd.overdue ? `Quá hạn ${cd.elapsed - db.config.invoiceDeadlineWorkingDays} ngày LV` : `Còn ${cd.remaining} ngày LV · hạn ${formatDate(cd.dueDate)}`;
  return <span className={cx('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tone)}>{text}</span>;
}

const SHORT: Record<string, string> = {
  DRAFT: 'Tạo phiếu',
  LEADER_APPROVAL: 'Lãnh đạo',
  ADVANCE_PREPARATION: 'HS tạm ứng',
  COORDINATION: 'TPTC duyệt',
  ADVANCE_PAYMENT: 'Chi tạm ứng',
  AFTER_ADVANCE: 'HS ĐNTT',
  FINAL_PAYMENT: 'Thanh toán',
  DOCUMENT_SUPPLEMENT_REQUIRED: 'Bổ sung HĐ',
};

/** B1 → B8 progress. B8 is only drawn when the request actually went through it. */
export function StepProgress({ pr }: { pr: PaymentRequest }) {
  const wentToB8 = pr.status === 'DOCUMENT_SUPPLEMENT_REQUIRED' || pr.timeline.some((t) => t.action === 'T12');
  const steps = WORKING_STATUSES.filter((s) => s !== 'DOCUMENT_SUPPLEMENT_REQUIRED' || wentToB8);
  const current = pr.status === 'COMPLETED' ? steps.length : stepIndex(pr.status);
  const stopped = pr.status === 'CANCELLED' || pr.status === 'REJECTED';
  const lastReached = stopped
    ? Math.max(...pr.timeline.filter((t) => t.fromStatus && t.toStatus === pr.status).map((t) => stepIndex(t.fromStatus!)), 0)
    : current;
  return (
    <ol className="flex w-full items-start overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = !stopped && (i < current || pr.status === 'COMPLETED');
        const active = !stopped && i === current;
        const halted = stopped && i === lastReached;
        return (
          <li key={s} className="flex min-w-[76px] flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <div className={cx('h-0.5 flex-1', i === 0 ? 'bg-transparent' : done || active ? 'bg-emerald-400' : 'bg-slate-200')} />
              <div
                className={cx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-2',
                  done && 'bg-emerald-500 text-white ring-emerald-500',
                  active && 'bg-white text-brand-700 ring-brand-500',
                  halted && 'bg-red-500 text-white ring-red-500',
                  !done && !active && !halted && 'bg-white text-slate-400 ring-slate-200',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : STATUS_STEP[s].replace('B', '')}
              </div>
              <div className={cx('h-0.5 flex-1', i === steps.length - 1 ? 'bg-transparent' : done ? 'bg-emerald-400' : 'bg-slate-200')} />
            </div>
            <span className={cx('mt-1.5 px-1 text-[11px] leading-tight', active ? 'font-semibold text-brand-700' : halted ? 'font-semibold text-red-600' : 'text-slate-500')}>
              <span className="block font-mono text-[10px]">{STATUS_STEP[s]}</span>
              {SHORT[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
