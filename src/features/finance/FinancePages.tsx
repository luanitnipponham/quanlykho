// Trưởng phòng Tài chính: duyệt B4 và theo dõi phiếu đang ở phía Kế toán (workflow §5.3, §9).
import { useState } from 'react';
import { CheckCircle2, Settings2, Users } from 'lucide-react';
import { useDb, useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_STEP } from '../../domain/constants';
import { canManageMaster, queueItems, theAccountant } from '../../domain/permissions';
import type { PaymentRequest, Priority, Status } from '../../domain/types';
import { formatMoney } from '../../lib/format';
import { Button, Card, CardHeader, Checkpoint, EmptyState, Field, Input, Modal, Notice, PageHeader, Select, Stat } from '../../ui/primitives';
import { toast } from '../../ui/toast';
import { MasterDataPanel } from '../master-data/MasterDataPanel';
import { RequestTable } from '../requests/RequestTable';

// ---------------------------------------------------------------------------
// B4 — Chờ TPTC duyệt
// ---------------------------------------------------------------------------

export function CoordinationPage() {
  const db = useDb();
  const me = useMe();
  const items = queueItems(db, me, 'coordination');
  const accountant = theAccountant(db);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Chờ TPTC duyệt — B4"
        description="Hồ sơ tạm ứng đã hoàn tất. Chọn nhân viên Kế toán tiếp nhận rồi tick duyệt để chuyển sang B5."
      />
      {!accountant && (
        <div className="mb-4">
          <Notice tone="danger" title="Chưa có tài khoản Kế toán đang hoạt động">
            Không duyệt được B4 cho tới khi Admin mở khóa hoặc tạo tài khoản Kế toán.
          </Notice>
        </div>
      )}
      <Card>
        <RequestTable
          requests={items}
          columns={['requester', 'amounts']}
          empty="Không có phiếu chờ duyệt"
          selectable={() => true}
          selected={selected}
          onSelectedChange={setSelected}
          toolbar={
            <Button size="sm" disabled={selected.length === 0 || !accountant} onClick={() => setOpen(true)}>
              <Users className="h-3.5 w-3.5" /> Duyệt {selected.length || ''} phiếu
            </Button>
          }
        />
      </Card>
      {open && accountant && (
        <ApproveDialog
          requests={items.filter((r) => selected.includes(r.id))}
          accountantName={accountant.fullName}
          onClose={() => {
            setOpen(false);
            setSelected([]);
          }}
        />
      )}
    </>
  );
}

function ApproveDialog({
  requests,
  accountantName,
  onClose,
}: {
  requests: PaymentRequest[];
  accountantName: string;
  onClose: () => void;
}) {
  const db = useDb();
  const me = useMe();
  const [priority, setPriority] = useState<Priority | ''>('');
  const [accountantNameId, setAccountantNameId] = useState('');
  const [note, setNote] = useState('');
  const [tick, setTick] = useState(false);
  const [manage, setManage] = useState(false);
  const staff = db.accountantNames.filter((x) => !x.deleted || x.id === accountantNameId);

  const submit = () => {
    let ok = 0;
    for (const r of requests) {
      const fresh = store.getDb().requests.find((x) => x.id === r.id);
      if (!fresh) continue;
      try {
        store.run({
          type: 'FINANCE_APPROVE',
          id: r.id,
          version: fresh.version,
          confirmed: tick,
          priority: priority || null,
          accountantNameId,
          note,
        });
        ok++;
      } catch (e) {
        toast.error(e);
      }
    }
    const who = db.accountantNames.find((x) => x.id === accountantNameId)?.name ?? accountantName;
    if (ok) toast.success(`Đã duyệt và giao ${ok}/${requests.length} phiếu cho ${who}`);
    onClose();
  };

  return (
    <Modal
      title={`Duyệt và chuyển ${requests.length} phiếu cho Kế toán`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!tick || !priority || !accountantNameId} onClick={submit}>
            <CheckCircle2 className="h-4 w-4" /> Duyệt và chuyển
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={
            <span className="flex items-center justify-between gap-2">
              Nhân viên Kế toán tiếp nhận
              {canManageMaster(me, 'accountantNames') && (
                <button
                  type="button"
                  onClick={() => setManage(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-normal text-brand-700 hover:underline"
                >
                  <Settings2 className="h-3 w-3" /> Quản lý
                </button>
              )}
            </span>
          }
          required
          htmlFor="batch-accountant"
          hint={`Tên hiện trên phiếu cho cả hai bên; phiếu vẫn vào tài khoản ${accountantName}`}
        >
          <Select id="batch-accountant" value={accountantNameId} onChange={(e) => setAccountantNameId(e.target.value)}>
            <option value="">— Chọn —</option>
            {staff.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Độ ưu tiên" required htmlFor="batch-prio" hint="Dùng để sắp xếp hàng đợi B5 và B7 của Kế toán">
          <Select id="batch-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="">— Chọn —</option>
            {(['HIGH', 'MEDIUM', 'LOW'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú điều phối" htmlFor="batch-note" hint="Ghi vào dòng trao đổi của phiếu kèm tiền tố [TÀI CHÍNH ĐIỀU PHỐI]">
          <Input id="batch-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Checkpoint checked={tick} onChange={setTick}>
          TPTC duyệt và chuyển Kế toán
        </Checkpoint>
      </div>
      {manage && (
        <Modal title="Danh mục Nhân viên kế toán" onClose={() => setManage(false)} wide>
          <MasterDataPanel kind="accountantNames" />
        </Modal>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Đang xử lý — monitor of B5 → B8
// ---------------------------------------------------------------------------

const MONITOR_STATUSES: Status[] = ['ADVANCE_PAYMENT', 'AFTER_ADVANCE', 'FINAL_PAYMENT', 'DOCUMENT_SUPPLEMENT_REQUIRED'];

export function FinanceMonitorPage() {
  const db = useDb();
  const me = useMe();
  const items = queueItems(db, me, 'financeMonitor');
  const accountant = theAccountant(db);
  const late = items.filter((r) => r.lateInvoice && r.status === 'DOCUMENT_SUPPLEMENT_REQUIRED').length;
  const toPay = items
    .filter((r) => r.status === 'ADVANCE_PAYMENT')
    .reduce((s, r) => s + (r.advanceAmount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Đang xử lý"
        description="Phiếu đã chuyển cho Kế toán (B5 → B8). Màn hình theo dõi, mọi thao tác chi tiền do Kế toán thực hiện."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tổng phiếu đang xử lý" value={items.length} />
        <Stat label="Chờ chi tạm ứng (B5)" value={items.filter((r) => r.status === 'ADVANCE_PAYMENT').length} hint={formatMoney(toPay)} />
        <Stat label="Chờ thanh toán (B7)" value={items.filter((r) => r.status === 'FINAL_PAYMENT').length} />
        <Stat label="Thiếu HĐ quá hạn" value={late} tone={late ? 'danger' : 'default'} />
      </div>
      {accountant && (
        <p className="mb-4 text-sm text-slate-600">
          Kế toán phụ trách: <b className="text-slate-900">{accountant.fullName}</b> ({accountant.username}) — tên người
          nhận từng phiếu hiện trong cột Kế toán phụ trách ở bảng bên dưới
        </p>
      )}
      {items.length === 0 ? (
        <Card>
          <EmptyState title="Không có phiếu đang xử lý" />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {MONITOR_STATUSES.map((s) => {
            const list = items.filter((r) => r.status === s);
            if (list.length === 0) return null;
            return (
              <Card key={s}>
                <CardHeader title={`${STATUS_STEP[s]} · ${STATUS_LABEL[s]}`} subtitle={`${list.length} phiếu`} />
                <RequestTable requests={list} columns={['requester', 'priority', 'amounts']} searchable={false} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

