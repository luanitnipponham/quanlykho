import { useState, type ReactNode } from 'react';
import { FilePlus2 } from 'lucide-react';
import { navigate } from '../../app/router';
import { useDb, useMe } from '../../data/hooks';
import { STATUS_LABEL, STATUS_STEP } from '../../domain/constants';
import { queueItems, type QueueKey } from '../../domain/permissions';
import type { Status } from '../../domain/types';
import { Button, Card, PageHeader, Tabs } from '../../ui/primitives';
import { RequestTable, type Column } from './RequestTable';

interface QueueConfig {
  title: string;
  description: ReactNode;
  queue: QueueKey;
  columns?: Column[];
  empty: string;
  /** Optional status tabs within the queue. */
  tabs?: Status[];
  createButton?: boolean;
}

export const QUEUE_PAGES: Record<string, QueueConfig> = {
  '/procurement/my-requests': {
    title: 'Phiếu của tôi',
    description: 'Mọi phiếu bạn đang phụ trách (assigned_requester_id = bạn), ở mọi trạng thái.',
    queue: 'myRequests',
    columns: ['accountant', 'amounts'],
    empty: 'Bạn chưa phụ trách phiếu nào',
    createButton: true,
  },
  '/procurement/overview': {
    title: 'View Tổng hợp — B1.1 & B3',
    description: 'Phiếu nháp / bị trả lại (B1.1) và phiếu đã được Lãnh đạo duyệt, chờ nộp hồ sơ tạm ứng (B3).',
    queue: 'overview',
    tabs: ['ADVANCE_PREPARATION', 'DRAFT'],
    empty: 'Không có phiếu cần xử lý',
    createButton: true,
  },
  '/approvals/leader': {
    title: 'Chờ tôi duyệt — B2',
    description: 'Phiếu nhân viên cung ứng gửi lên. Duyệt để chuyển B3, từ chối (ghi lý do) hoặc trả lại bổ sung.',
    queue: 'leaderApproval',
    empty: 'Không có phiếu chờ duyệt',
  },
  '/procurement/after-advance': {
    title: 'Theo dõi sau tạm ứng — B6',
    description: 'Đã nhận tạm ứng. Nhập giá trị quyết toán, đính kèm BNH, ĐNTT (và hóa đơn nếu có) để gửi kế toán thanh toán.',
    queue: 'afterAdvance',
    columns: ['accountant', 'amounts'],
    empty: 'Không có phiếu đang theo dõi sau tạm ứng',
  },
  '/procurement/supplement-invoice': {
    title: 'Bổ sung hóa đơn — B8',
    description: 'Phiếu đã thanh toán dứt điểm nhưng thiếu hóa đơn. Hạn nộp tính theo ngày làm việc.',
    queue: 'supplementInvoice',
    columns: ['accountant'],
    empty: 'Không có phiếu thiếu hóa đơn',
  },
  '/accounting/advance-payments': {
    title: 'PKT tạm ứng — B5',
    description: 'Phiếu được giao cho bạn, sắp theo độ ưu tiên. Thiếu sót: comment @ người phụ trách (kế toán không có nút trả lại).',
    queue: 'advancePayments',
    columns: ['requester', 'priority', 'amounts'],
    empty: 'Không có phiếu chờ chi tạm ứng',
  },
  '/accounting/final-payments': {
    title: 'PKT thanh toán — B7',
    description: 'Thanh toán dứt điểm phần còn lại, kể cả khi chưa có hóa đơn.',
    queue: 'finalPayments',
    columns: ['requester', 'priority', 'amounts'],
    empty: 'Không có phiếu chờ thanh toán',
  },
  '/accounting/missing-invoices': {
    title: 'Theo dõi thiếu hóa đơn',
    description: 'Phiếu bạn phụ trách đang ở B8. Nhắc NV cung ứng bằng comment @.',
    queue: 'missingInvoices',
    columns: ['requester'],
    empty: 'Không có phiếu thiếu hóa đơn',
  },
};

export function QueuePage({ path }: { path: string }) {
  const cfg = QUEUE_PAGES[path];
  const db = useDb();
  const me = useMe();
  const items = queueItems(db, me, cfg.queue);
  const [tab, setTab] = useState<Status | 'ALL'>(cfg.tabs ? cfg.tabs[0] : 'ALL');
  const shown = tab === 'ALL' ? items : items.filter((r) => r.status === tab);

  return (
    <>
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          cfg.createButton && (
            <Button onClick={() => navigate('/procurement/requests/new')}>
              <FilePlus2 className="h-4 w-4" /> Tạo phiếu
            </Button>
          )
        }
      />
      <Card>
        {cfg.tabs && (
          <div className="border-b border-slate-100 px-4 pt-3 pb-3">
            <Tabs
              value={tab}
              onChange={setTab}
              items={cfg.tabs.map((s) => ({
                value: s,
                label: `${STATUS_STEP[s]} · ${STATUS_LABEL[s]} (${items.filter((r) => r.status === s).length})`,
              }))}
            />
          </div>
        )}
        <RequestTable requests={shown} columns={cfg.columns} empty={cfg.empty} />
      </Card>
    </>
  );
}
