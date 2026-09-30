import { useState } from 'react';
import { useDb, useMe } from '../../data/hooks';
import { STATUSES } from '../../domain/types';
import { STATUS_LABEL, STATUS_STEP } from '../../domain/constants';
import { queueItems } from '../../domain/permissions';
import { Card, PageHeader, Select } from '../../ui/primitives';
import { RequestTable } from '../requests/RequestTable';

/** Tra cứu hồ sơ — every request, read-only (workflow §1.8). Processing stays in each role's queue. */
export function LookupPage({ title = 'Tra cứu hồ sơ', admin = false }: { title?: string; admin?: boolean }) {
  const db = useDb();
  const me = useMe();
  const [status, setStatus] = useState('');
  const [project, setProject] = useState('');
  const all = queueItems(db, me, 'all');
  const rows = all.filter((r) => (!status || r.status === status) && (!project || r.projectId === project));

  return (
    <>
      <PageHeader
        title={title}
        description={
          admin
            ? 'Toàn bộ phiếu. Mở phiếu để dùng thao tác đặc quyền (A1–A4, xóa). Phiếu Hoàn thành chỉ được xem.'
            : 'Mọi bộ phận xem và tải được toàn bộ hồ sơ để đối chiếu; chỉ xử lý được phiếu trong hàng đợi của mình.'
        }
      />
      <Card>
        <RequestTable
          requests={rows}
          columns={['requester', 'accountant', 'amounts']}
          toolbar={
            <>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto" aria-label="Lọc trạng thái">
                <option value="">Mọi trạng thái ({all.length})</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_STEP[s]} · {STATUS_LABEL[s]} ({all.filter((r) => r.status === s).length})
                  </option>
                ))}
              </Select>
              <Select value={project} onChange={(e) => setProject(e.target.value)} className="h-9 w-auto" aria-label="Lọc dự án">
                <option value="">Mọi dự án</option>
                {db.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </>
          }
        />
      </Card>
    </>
  );
}
