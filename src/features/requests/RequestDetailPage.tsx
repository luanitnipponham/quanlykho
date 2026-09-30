import { useState } from 'react';
import { ArrowLeft, Pencil, Send } from 'lucide-react';
import { navigate } from '../../app/router';
import { useDb, useMe, useNow } from '../../data/hooks';
import { store } from '../../data/store';
import { METHOD_LABEL, PRIORITY_LABEL, STATUS_LABEL, STATUS_STEP, TIMELINE_LABEL, WORKING_STATUSES } from '../../domain/constants';
import { can, isAdmin, leaders as allLeaders } from '../../domain/permissions';
import type { PaymentRequest, Status } from '../../domain/types';
import { cx, formatDate, formatDateTime, formatMoney, timeAgo } from '../../lib/format';
import { masterName, userName } from '../../lib/lookup';
import { Button, Card, CardHeader, EmptyState, Field, Modal, Notice, Select, Textarea } from '../../ui/primitives';
import { Flags, InvoiceCountdownBadge, PriorityBadge, StatusBadge, StepProgress } from '../../ui/status';
import { attempt } from '../../ui/toast';
import { AttachmentGroups } from './Attachments';
import { ReasonDialog, type ReasonRequest } from './ReasonDialog';
import { DraftEditor } from './RequestForm';
import { AmountsTable, StepActions } from './StepActions';

export function RequestDetailPage({ id }: { id: string }) {
  const db = useDb();
  const me = useMe();
  const now = useNow();
  const pr = db.requests.find((r) => r.id === id);
  const [editing, setEditing] = useState(false);

  if (!pr) {
    return (
      <Card>
        <EmptyState title="Không tìm thấy phiếu" hint="Phiếu có thể đã bị Admin xóa." />
      </Card>
    );
  }

  const canEditInfo = can(db, me, pr, 'EDIT_DRAFT') || (isAdmin(me) && WORKING_STATUSES.includes(pr.status));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button onClick={() => history.back()} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Quay lại
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm text-slate-500">{pr.code}</p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{pr.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={pr.status} />
              <PriorityBadge priority={pr.priority} />
              <Flags pr={pr} />
              <InvoiceCountdownBadge pr={pr} db={db} now={now} />
              <span className="text-xs text-slate-500">
                · Tạo bởi {userName(db, pr.createdBy)} lúc {formatDateTime(pr.createdAt)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="block text-xs text-slate-500">
              {pr.status === 'COMPLETED'
                ? 'Giá trị quyết toán (Đã tất toán)'
                : pr.settlementAmount !== null
                  ? 'Giá trị quyết toán'
                  : 'Tổng đề nghị'}
            </span>
            <span className="text-2xl font-semibold tabular-nums text-slate-900">
              {formatMoney(pr.settlementAmount ?? pr.requestedAmount)}
            </span>
            {pr.settlementAmount !== null && pr.settlementAmount !== pr.requestedAmount && (
              <span className="block text-xs text-slate-400">
                Đề nghị ban đầu: {formatMoney(pr.requestedAmount)}
              </span>
            )}
          </div>
        </div>
      </div>

      <Card className="px-4 py-4">
        <StepProgress pr={pr} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <StepActions pr={pr} />

          <Card>
            <CardHeader
              title="Thông tin chung (B1.1)"
              actions={
                canEditInfo &&
                !editing && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" /> {pr.status === 'DRAFT' ? 'Sửa' : 'Admin sửa dữ liệu'}
                  </Button>
                )
              }
            />
            <div className="p-5">
              {editing ? (
                <DraftEditor pr={pr} onDone={() => setEditing(false)} />
              ) : (
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Info label="Dự án" value={masterName(db, 'projects', pr.projectId)} />
                  <Info label="Hạng mục chi" value={masterName(db, 'categories', pr.categoryId)} />
                  <Info label="Người yêu cầu" value={masterName(db, 'requesterNames', pr.requesterNameId)} />
                  <Info label="Nhà cung cấp" value={masterName(db, 'vendors', pr.vendorId)} />
                  <Info label="Loại chi" value={pr.hasInvoice ? 'Có hóa đơn' : 'Không hóa đơn'} />
                  {pr.note && <Info label="Ghi chú" value={pr.note} wide />}
                </dl>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Số tiền" />
            <div className="p-5">
              <AmountsTable pr={pr} />
              {pr.transactions.length > 0 && (
                <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                  {pr.transactions.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="font-medium text-slate-800">{t.kind === 'ADVANCE' ? 'Chi tạm ứng (B5)' : 'Chi đợt cuối (B7)'}</span>
                      <span className="text-xs text-slate-500">
                        {METHOD_LABEL[t.method]} · {formatDate(t.paidDate)} · {userName(db, t.createdBy)}
                      </span>
                      <span className="font-semibold tabular-nums">{formatMoney(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Hồ sơ đính kèm" subtitle="Mọi người xem và tải được; chỉ người phụ trách bước hiện tại tải lên/xóa khi chưa tick chốt." />
            <div className="p-5">
              <AttachmentGroups pr={pr} />
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Responsibility pr={pr} />
          <PrivilegedActions pr={pr} />
          <Comments pr={pr} />
          <Timeline pr={pr} />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-slate-900">{value}</dd>
    </div>
  );
}

function Responsibility({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const leaders = allLeaders(db);
  return (
    <Card>
      <CardHeader title="Phụ trách" />
      <dl className="grid gap-3 p-5 text-sm">
        <Info label="NV cung ứng phụ trách" value={userName(db, pr.assignedRequesterId)} />
        <Info label="Lãnh đạo duyệt B2" value={leaders.map((l) => l.fullName).join(', ') || 'Chưa có tài khoản Lãnh đạo — báo Admin'} />
        <Info label="Kế toán phụ trách" value={pr.assignedAccountantId ? userName(db, pr.assignedAccountantId) : 'Chưa phân công'} />
        {pr.priority && <Info label="Độ ưu tiên" value={PRIORITY_LABEL[pr.priority]} />}
      </dl>
    </Card>
  );
}

/** A1–A4 and delete — Admin only, available at every status (workflow §9.1). */
function PrivilegedActions({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const me = useMe();
  const [reason, setReason] = useState<ReasonRequest | null>(null);
  const [picker, setPicker] = useState<'A4' | 'A1' | null>(null);
  const [target, setTarget] = useState('');
  const [pickReason, setPickReason] = useState('');
  const v = { id: pr.id, version: pr.version };
  const items = [
    can(db, me, pr, 'TRANSFER') && { key: 'A4', label: 'Chuyển giao NV cung ứng (A4)', onClick: () => setPicker('A4') },
    can(db, me, pr, 'FORCE') && { key: 'A1', label: 'Ép chuyển bước (A1)', onClick: () => setPicker('A1') },
    can(db, me, pr, 'ADMIN_CANCEL') && {
      key: 'A2',
      label: 'Hủy phiếu (A2)',
      danger: true,
      onClick: () => setReason({ title: 'Admin hủy phiếu (A2)', label: 'Lý do', confirm: 'Hủy phiếu', danger: true, run: (r) => attempt(() => store.run({ type: 'ADMIN_CANCEL', ...v, reason: r })) }),
    },
    can(db, me, pr, 'REOPEN') && {
      key: 'A3',
      label: 'Mở lại phiếu (A3)',
      onClick: () => setReason({ title: 'Mở lại phiếu (A3)', label: 'Lý do', confirm: 'Mở lại về B1.1', intro: 'Giữ nguyên mã phiếu và toàn bộ lịch sử.', run: (r) => attempt(() => store.run({ type: 'REOPEN', ...v, reason: r })) }),
    },
    can(db, me, pr, 'DELETE') && {
      key: 'DEL',
      label: 'Xóa phiếu',
      danger: true,
      onClick: () =>
        setReason({
          title: 'Xóa phiếu',
          label: 'Lý do xóa',
          confirm: 'Xóa vĩnh viễn',
          danger: true,
          intro: 'Phiếu, file và comment bị xóa. Thao tác được ghi nhật ký.',
          run: async (r) => {
            const ok = await attempt(() => store.run({ type: 'DELETE_REQUEST', ...v, reason: r }));
            if (ok) navigate('/home');
            return ok;
          },
        }),
    },
  ].filter(Boolean) as { key: string; label: string; danger?: boolean; onClick: () => void }[];

  if (items.length === 0) return null;

  let options: { value: string; label: string; disabled?: boolean }[] = [];
  if (picker === 'A4') {
    options = db.users
      .filter((u) => u.role === 'REQUESTER' && u.status === 'ACTIVE' && u.id !== pr.assignedRequesterId && (isAdmin(me) || u.departmentId === me.departmentId))
      .map((u) => ({ value: u.id, label: `${u.fullName} (${u.username})` }));
  } else if (picker === 'A1') {
    options = ([...WORKING_STATUSES, 'COMPLETED'] as Status[])
      .filter((s) => s !== pr.status)
      .map((s) => ({ value: s, label: `${STATUS_STEP[s]} · ${STATUS_LABEL[s]}` }));
  }

  const submitPicker = async () => {
    const r = pickReason.trim();
    const item = { id: pr.id, version: pr.version };
    const ok = await attempt(() =>
      picker === 'A4'
        ? store.run({ type: 'TRANSFER', items: [item], toRequesterId: target, reason: r })
        : store.run({ type: 'FORCE', ...item, toStatus: target as Status, reason: r }),
    );
    if (ok) {
      setPicker(null);
      setTarget('');
      setPickReason('');
    }
  };

  return (
    <Card>
      <CardHeader title={isAdmin(me) ? 'Thao tác đặc quyền' : 'Điều phối'} subtitle="Bắt buộc nhập lý do, ghi nhật ký" />
      <div className="flex flex-col gap-2 p-4">
        {items.map((it) => (
          <Button key={it.key} variant={it.danger ? 'danger' : 'secondary'} size="sm" className="justify-start" onClick={it.onClick}>
            {it.label}
          </Button>
        ))}
      </div>
      {reason && <ReasonDialog req={reason} onClose={() => setReason(null)} />}
      {picker && (
        <Modal
          title={picker === 'A4' ? 'Chuyển giao NV cung ứng (A4)' : 'Ép chuyển bước (A1)'}
          onClose={() => setPicker(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPicker(null)}>
                Quay lại
              </Button>
              <Button disabled={!target || !pickReason.trim()} onClick={submitPicker}>
                Xác nhận
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {picker === 'A1' && <Notice tone="warn">Ép được sang mọi bước, kể cả phiếu đã kết thúc. Hệ thống chỉ cảnh báo khi vượt bước chi tiền chưa có giao dịch.</Notice>}
            {picker === 'A4' && <p className="text-sm text-slate-600">Trạng thái phiếu giữ nguyên. Người nhận thấy đủ lịch sử, comment và file.</p>}
            <Field label={picker === 'A1' ? 'Trạng thái đích' : 'Người nhận'} required htmlFor="target">
              <Select id="target" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">— Chọn —</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lý do" required htmlFor="pick-reason">
              <Textarea id="pick-reason" value={pickReason} onChange={(e) => setPickReason(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function Comments({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const me = useMe();
  const [text, setText] = useState('');
  const list = db.comments.filter((c) => c.requestId === pr.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const canComment = can(db, me, pr, 'COMMENT');
  const people = [pr.assignedRequesterId, pr.assignedAccountantId, pr.createdBy]
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i && x !== me.id)
    .map((id) => db.users.find((u) => u.id === id)!)
    .filter(Boolean);

  const send = async () => {
    const ok = await attempt(() => store.run({ type: 'COMMENT', id: pr.id, content: text }));
    if (ok) setText('');
  };

  return (
    <Card>
      <CardHeader title={`Trao đổi (${list.length})`} subtitle="Thiếu sót ở bất kỳ bước nào: comment và @ người phụ trách" />
      <div className="flex flex-col gap-3 p-4">
        {list.length === 0 && <p className="text-xs text-slate-500">Chưa có trao đổi.</p>}
        {list.map((c) => (
          <div key={c.id} className={cx('rounded-lg px-3 py-2 text-sm', c.authorId === me.id ? 'bg-brand-50' : 'bg-slate-50')}>
            <p className="text-xs text-slate-500">
              <b className="text-slate-800">{userName(db, c.authorId)}</b> · {timeAgo(c.createdAt)}
            </p>
            <p className="mt-0.5 whitespace-pre-line text-slate-800">
              {c.content.split(/(@[A-Za-z0-9._-]+)/g).map((part, i) =>
                part.startsWith('@') ? (
                  <span key={i} className="font-medium text-brand-700">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </p>
          </div>
        ))}
        {canComment ? (
          <div className="flex flex-col gap-2">
            {people.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {people.map((u) => (
                  <button key={u.id} onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${u.username} `)} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200">
                    @{u.username}
                  </button>
                ))}
              </div>
            )}
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Nhập nội dung, dùng @username để nhắc tên" aria-label="Nội dung comment" />
            <div className="flex justify-end">
              <Button size="sm" disabled={!text.trim()} onClick={send}>
                <Send className="h-3.5 w-3.5" /> Gửi
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Phiếu đã Hoàn thành — không thể comment thêm.</p>
        )}
      </div>
    </Card>
  );
}

function Timeline({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const items = [...pr.timeline].reverse();
  return (
    <Card>
      <CardHeader title="Dòng thời gian" subtitle="Lưu vĩnh viễn trên phiếu (không bị xóa theo 72 giờ)" />
      <ol className="flex flex-col gap-0 p-4">
        {items.map((t, i) => (
          <li key={t.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />}
            <span className={cx('relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white ring-1', t.actorId ? 'bg-brand-500 ring-brand-200' : 'bg-slate-400 ring-slate-200')} />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-900">
                <span className="mr-1 font-mono text-xs text-slate-400">{t.action}</span>
                {TIMELINE_LABEL[t.action]}
              </p>
              <p className="text-xs text-slate-500">
                {t.actorId ? userName(db, t.actorId) : 'Hệ thống (AUTO_VERIFY)'} · {formatDateTime(t.createdAt)}
                {t.toStatus && t.fromStatus !== t.toStatus && ` · → ${STATUS_STEP[t.toStatus]} ${STATUS_LABEL[t.toStatus]}`}
              </p>
              {t.reason && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">{t.reason}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
