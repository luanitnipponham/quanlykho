import { useMemo, useState, type ReactNode } from 'react';
import { Inbox, Search } from 'lucide-react';
import { navigate } from '../../app/router';
import { useDb, useNow } from '../../data/hooks';
import type { PaymentRequest } from '../../domain/types';
import { cx, formatDateTime, formatMoney } from '../../lib/format';
import { masterName, userName } from '../../lib/lookup';
import { EmptyState, Input } from '../../ui/primitives';
import { Flags, InvoiceCountdownBadge, PriorityBadge, StatusBadge } from '../../ui/status';

export type Column = 'requester' | 'accountant' | 'priority' | 'amounts';

export function RequestTable({
  requests,
  columns = ['requester', 'amounts'],
  empty = 'Không có phiếu nào',
  emptyHint,
  selectable,
  selected,
  onSelectedChange,
  searchable = true,
  toolbar,
}: {
  requests: PaymentRequest[];
  columns?: Column[];
  empty?: string;
  emptyHint?: ReactNode;
  selectable?: (pr: PaymentRequest) => boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  searchable?: boolean;
  toolbar?: ReactNode;
}) {
  const db = useDb();
  const now = useNow();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return requests;
    return requests.filter((r) =>
      [
        r.code,
        r.title,
        masterName(db, 'projects', r.projectId),
        masterName(db, 'vendors', r.vendorId),
        userName(db, r.assignedRequesterId),
        masterName(db, 'accountantNames', r.accountantNameId),
      ]
        .join(' ')
        .toLowerCase()
        .includes(k),
    );
  }, [requests, q, db]);

  const sel = new Set(selected ?? []);
  const selectableRows = selectable ? rows.filter(selectable) : [];
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => sel.has(r.id));
  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange?.([...next]);
  };

  return (
    <div>
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          {searchable && (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã phiếu, nội dung, NCC…" className="h-9 pl-9" aria-label="Tìm phiếu" />
            </div>
          )}
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">{toolbar}</div>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title={q ? 'Không tìm thấy phiếu phù hợp' : empty} hint={q ? undefined : emptyHint} icon={<Inbox className="h-8 w-8" />} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  {selectable && (
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả"
                        checked={allSelected}
                        onChange={() => onSelectedChange?.(allSelected ? [] : selectableRows.map((r) => r.id))}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </th>
                  )}
                  <th className="px-4 py-2.5 font-medium">Phiếu</th>
                  {columns.includes('requester') && <th className="px-4 py-2.5 font-medium">NV cung ứng</th>}
                  {columns.includes('accountant') && <th className="px-4 py-2.5 font-medium">NV kế toán</th>}
                  <th className="px-4 py-2.5 text-right font-medium">Số tiền</th>
                  <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                  <th className="px-4 py-2.5 font-medium">Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/requests/${r.id}`)}
                    className={cx('cursor-pointer border-b border-slate-100 hover:bg-slate-50', sel.has(r.id) && 'bg-brand-50/50')}
                  >
                    {selectable && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${r.code}`}
                          disabled={!selectable(r)}
                          checked={sel.has(r.id)}
                          onChange={() => toggle(r.id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                    )}
                    <td className="max-w-[320px] px-4 py-3">
                      <p className="font-mono text-xs text-slate-500">{r.code}</p>
                      <p className="truncate font-medium text-slate-900">{r.title}</p>
                      <p className="truncate text-xs text-slate-500">{masterName(db, 'projects', r.projectId)}</p>
                    </td>
                    {columns.includes('requester') && <td className="px-4 py-3 text-slate-600">{userName(db, r.assignedRequesterId)}</td>}
                    {columns.includes('accountant') && (
                      <td className="px-4 py-3 text-slate-600">
                        {r.accountantNameId ? (
                          masterName(db, 'accountantNames', r.accountantNameId)
                        ) : r.assignedAccountantId ? (
                          // Phiếu qua B4 trước khi có ô chỉ định: lùi về tên tài khoản.
                          userName(db, r.assignedAccountantId)
                        ) : (
                          <span className="text-slate-400">Chưa phân công</span>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      <p className="font-medium text-slate-900">{formatMoney(r.settlementAmount ?? r.requestedAmount)}</p>
                      {columns.includes('amounts') && (
                        r.status === 'COMPLETED' ? (
                          <p className="text-xs text-emerald-600 font-medium">Đã tất toán</p>
                        ) : r.settlementAmount !== null && r.settlementAmount !== r.requestedAmount ? (
                          <p className="text-xs text-slate-500">ĐN {formatMoney(r.requestedAmount)}</p>
                        ) : r.advanceAmount !== null ? (
                          <p className="text-xs text-slate-500">TƯ {formatMoney(r.advanceAmount)}</p>
                        ) : null
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={r.status} />
                        {columns.includes('priority') && <PriorityBadge priority={r.priority} />}
                        <Flags pr={r} />
                        <InvoiceCountdownBadge pr={r} db={db} now={now} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDateTime(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="flex gap-3 px-4 py-3">
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={`Chọn ${r.code}`}
                    disabled={!selectable(r)}
                    checked={sel.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                  />
                )}
                <button onClick={() => navigate(`/requests/${r.id}`)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-500">{r.code}</span>
                    <span className="text-sm font-medium tabular-nums text-slate-900">{formatMoney(r.settlementAmount ?? r.requestedAmount)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{r.title}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <StatusBadge status={r.status} />
                    {columns.includes('priority') && <PriorityBadge priority={r.priority} />}
                    <Flags pr={r} />
                    <InvoiceCountdownBadge pr={r} db={db} now={now} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
