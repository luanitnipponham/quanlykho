import { useState } from 'react';
import { History } from 'lucide-react';
import { navigate } from '../../app/router';
import { useDb, useMe, useNow } from '../../data/hooks';

import { isAdmin } from '../../domain/permissions';
import { formatDateTime } from '../../lib/format';
import { userName } from '../../lib/lookup';
import { Card, EmptyState, Input, PageHeader } from '../../ui/primitives';

/** Lịch sử for everyone; Admin sees the whole system log. Read-only — nobody can edit it. */
export function HistoryPage() {
  const db = useDb();
  const me = useMe();
  const now = useNow();
  const admin = isAdmin(me);
  const [q, setQ] = useState('');
  const cutoff = now.getTime() - db.config.auditRetentionDays * 86400e3;
  const rows = db.audit
    .filter((e) => new Date(e.createdAt).getTime() >= cutoff)
    .filter((e) => admin || e.actorId === me.id)
    .filter((e) => !q || `${e.action} ${e.detail} ${userName(db, e.actorId)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHeader
        title={admin ? 'Nhật ký hệ thống' : 'Lịch sử thao tác'}
        description={`Nhật ký tự xóa sau ${db.config.auditRetentionDays} ngày và không ai sửa được, kể cả Admin. Người duyệt, lý do, comment và file trên phiếu được lưu vĩnh viễn trong dòng thời gian của phiếu.`}
      />
      <Card>
        <div className="border-b border-slate-100 px-4 py-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc theo nội dung, thao tác…" className="h-9 max-w-xs" aria-label="Lọc nhật ký" />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Không có thao tác nào gần đây" icon={<History className="h-8 w-8" />} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((e) => {
              const pr = e.entity === 'payment_request' || e.entity === 'attachment' ? db.requests.find((r) => r.id === e.entityId) : undefined;
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <span className="w-36 shrink-0 text-xs tabular-nums text-slate-500">{formatDateTime(e.createdAt)}</span>
                  <span className="w-32 shrink-0 font-mono text-xs text-slate-600">{e.action}</span>
                  <span className="min-w-0 flex-1 text-slate-800">
                    {admin && <b className="mr-1">{e.actorId ? userName(db, e.actorId) : 'Hệ thống'}:</b>}
                    {e.detail}
                  </span>
                  {pr && (
                    <button onClick={() => navigate(`/requests/${pr.id}`)} className="text-xs font-medium text-brand-700 hover:underline">
                      Mở phiếu
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
