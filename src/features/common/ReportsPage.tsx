import { useDb } from '../../data/hooks';
import { STATUS_LABEL, STATUS_STEP } from '../../domain/constants';
import { STATUSES, type PaymentRequest } from '../../domain/types';
import { workloadOf } from '../../domain/permissions';
import { formatMoney } from '../../lib/format';
import { masterName } from '../../lib/lookup';
import { Card, CardHeader, PageHeader, Stat } from '../../ui/primitives';

/** Leader: managed departments. Lead KT and Admin: whole system (workflow §11.5 "Báo cáo"). */
export function ReportsPage() {
  const db = useDb();
  const scope: PaymentRequest[] = db.requests;
  const sum = (list: PaymentRequest[], f: (r: PaymentRequest) => number | null) => list.reduce((s, r) => s + (f(r) ?? 0), 0);
  const completed = scope.filter((r) => r.status === 'COMPLETED');
  const inProgress = scope.filter((r) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(r.status));
  const paid = scope.reduce((s, r) => s + r.transactions.reduce((a, t) => a + t.amount, 0), 0);
  const max = Math.max(1, ...STATUSES.map((s) => scope.filter((r) => r.status === s).length));
  const projects = [...new Set(scope.map((r) => r.projectId))];
  const accountants = db.users.filter((u) => u.role === 'ACCOUNTANT' && u.status === 'ACTIVE');

  return (
    <>
      <PageHeader title="Báo cáo" description="Phạm vi: toàn hệ thống." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Phiếu đang xử lý" value={inProgress.length} hint={formatMoney(sum(inProgress, (r) => r.requestedAmount))} />
        <Stat label="Phiếu hoàn thành" value={completed.length} tone="ok" hint={formatMoney(sum(completed, (r) => r.settlementAmount))} />
        <Stat label="Đã chi (tạm ứng + đợt cuối)" value={formatMoney(paid)} />
        <Stat label="B8 trễ hạn" value={scope.filter((r) => r.lateInvoice && r.status === 'DOCUMENT_SUPPLEMENT_REQUIRED').length} tone="danger" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Số phiếu theo trạng thái" />
          <ul className="flex flex-col gap-2 p-5">
            {STATUSES.map((s) => {
              const n = scope.filter((r) => r.status === s).length;
              return (
                <li key={s} className="grid grid-cols-[150px_1fr_32px] items-center gap-3 text-sm">
                  <span className="truncate text-slate-600">
                    <span className="mr-1 font-mono text-[11px] text-slate-400">{STATUS_STEP[s]}</span>
                    {STATUS_LABEL[s]}
                  </span>
                  <span className="h-2 rounded-full bg-slate-100">
                    <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-slate-900">{n}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Theo dự án" />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="px-5 py-2 text-left font-medium">Dự án</th>
                <th className="px-5 py-2 text-right font-medium">Phiếu</th>
                <th className="px-5 py-2 text-right font-medium">Tổng đề nghị</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((d) => {
                const list = scope.filter((r) => r.projectId === d);
                return (
                  <tr key={d} className="border-b border-slate-100">
                    <td className="px-5 py-2.5">{masterName(db, 'projects', d)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{list.length}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(sum(list, (r) => r.requestedAmount))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {accountants.length > 0 && (
          <Card>
            <CardHeader title="Khối lượng kế toán (B5–B7)" />
            <ul className="divide-y divide-slate-100">
              {accountants.map((u) => (
                <li key={u.id} className="flex justify-between px-5 py-2.5 text-sm">
                  <span>{u.fullName}</span>
                  <span className="tabular-nums">{workloadOf(db, u.id)} phiếu</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
