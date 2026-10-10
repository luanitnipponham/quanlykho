import { useState } from 'react';
import { FileText, Save, Send, Settings2, UploadCloud, X } from 'lucide-react';
import { navigate } from '../../app/router';
import { useDb, useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { SLOT_DEF } from '../../domain/constants';
import { DomainError } from '../../domain/errors';
import { canManageMaster } from '../../domain/permissions';
import type { MasterKind, PaymentRequest, Slot } from '../../domain/types';
import type { DraftFields } from '../../domain/workflow';
import { formatBytes } from '../../lib/format';
import { Button, Card, CardHeader, Checkpoint, Field, Input, Modal, MoneyInput, Notice, PageHeader, Select, Textarea } from '../../ui/primitives';
import { attempt, toast } from '../../ui/toast';
import { MASTER_TITLE, MasterDataPanel } from '../master-data/MasterDataPanel';

const B1_SLOTS: Slot[] = ['REQUEST_FORM', 'QUOTATION_COMPARISON'];

function emptyFields(): DraftFields {
  return { title: '', projectId: '', categoryId: '', requesterNameId: '', vendorId: '', requestedAmount: 0, hasInvoice: true, note: '' };
}

export function fieldsOf(pr: PaymentRequest): DraftFields {
  const { title, projectId, categoryId, requesterNameId, vendorId, requestedAmount, hasInvoice, note } = pr;
  return { title, projectId, categoryId, requesterNameId, vendorId, requestedAmount, hasInvoice, note };
}

/** The B1.1 fields (Master Data selects, "Có hóa đơn", amount). Shared by create page and draft editing. */
export function DraftFieldsForm({ value, onChange, disabled }: { value: DraftFields; onChange: (v: DraftFields) => void; disabled?: boolean }) {
  const db = useDb();
  const me = useMe();
  const [manage, setManage] = useState<MasterKind | null>(null);
  const set = <K extends keyof DraftFields>(k: K, v: DraftFields[K]) => onChange({ ...value, [k]: v });

  const masterSelect = (kind: MasterKind, key: 'projectId' | 'categoryId' | 'requesterNameId' | 'vendorId') => {
    const live = db[kind].filter((x) => !x.deleted || x.id === value[key]);
    return (
      <Field
        label={
          <span className="flex items-center justify-between gap-2">
            {MASTER_TITLE[kind]}
            {canManageMaster(me, kind) && !disabled && (
              <button type="button" onClick={() => setManage(kind)} className="inline-flex items-center gap-1 text-[11px] font-normal text-brand-700 hover:underline">
                <Settings2 className="h-3 w-3" /> Quản lý
              </button>
            )}
          </span>
        }
        required
        htmlFor={key}
      >
        <Select id={key} value={value[key]} disabled={disabled} onChange={(e) => set(key, e.target.value)}>
          <option value="">— Chọn —</option>
          {live.map((x) => (
            <option key={x.id} value={x.id}>
              {x.code ? `${x.code} · ` : ''}
              {x.name}
              {x.deleted ? ' (đã xóa)' : ''}
            </option>
          ))}
        </Select>
      </Field>
    );
  };

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Nội dung chi" required htmlFor="title">
            <Input id="title" value={value.title} disabled={disabled} onChange={(e) => set('title', e.target.value)} placeholder="VD: Thép cuộn D10 cho sàn tầng 5" />
          </Field>
        </div>
        {masterSelect('projects', 'projectId')}
        {masterSelect('categories', 'categoryId')}
        {masterSelect('requesterNames', 'requesterNameId')}
        {masterSelect('vendors', 'vendorId')}
        <Field label="Tổng số tiền đề nghị" required htmlFor="amount" hint="Phải lớn hơn 0">
          <MoneyInput id="amount" value={value.requestedAmount} disabled={disabled} onChange={(n) => set('requestedAmount', n)} />
        </Field>
        <div className="md:col-span-2">
          <Checkpoint checked={value.hasInvoice} disabled={disabled} onChange={(v) => set('hasInvoice', v)}>
            Có hóa đơn <span className="font-normal text-slate-500">— bỏ tick nếu là khoản chi Không hóa đơn</span>
          </Checkpoint>
        </div>
        <div className="md:col-span-2">
          <Field label="Ghi chú" htmlFor="note">
            <Textarea id="note" value={value.note} disabled={disabled} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </div>
      </div>
      {manage && (
        <Modal title={`Danh mục ${MASTER_TITLE[manage]}`} onClose={() => setManage(null)} wide>
          <MasterDataPanel kind={manage} />
        </Modal>
      )}
    </>
  );
}

/** /procurement/requests/new — create a draft, attach the 3 files, optionally submit in one go. */
export function CreateRequestPage() {
  const me = useMe();
  const db = useDb();
  const [fields, setFields] = useState<DraftFields>(emptyFields);
  const [pending, setPending] = useState<Record<Slot, File[]>>({} as Record<Slot, File[]>);
  const [assignee, setAssignee] = useState('');
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = me.role === 'ADMIN';
  const requesters = db.users.filter((u) => u.status === 'ACTIVE' && u.role === 'REQUESTER');
  const missingFiles = B1_SLOTS.filter((s) => !pending[s]?.length);

  const save = async (submit: boolean) => {
    setBusy(true);
    let createdId: string | null = null;
    try {
      const res = await store.runAsync({ type: 'CREATE_REQUEST', fields, assignedRequesterId: isAdmin ? assignee : undefined });
      createdId = res.requestId ?? null;
      if (!createdId) throw new DomainError('ERR_NOT_FOUND', 'Không tạo được phiếu');
      for (const slot of B1_SLOTS) {
        if (pending[slot]?.length) await store.upload(createdId, slot, pending[slot]);
      }
      if (submit) {
        const pr = store.getDb().requests.find((r) => r.id === createdId)!;
        const r = await store.runAsync({ type: 'SUBMIT', id: pr.id, version: pr.version, confirmed: tick });
        toast.success(r.message);
      } else {
        toast.success(res.message);
      }
      navigate(`/requests/${createdId}`);
    } catch (e) {
      toast.error(e);
      // The draft (and any files) were saved before the failing step — continue on its detail page.
      if (createdId && e instanceof DomainError) navigate(`/requests/${createdId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Tạo phiếu yêu cầu chi — B1"
        description="Điền đủ thông tin và 2 file bắt buộc — thiếu file thì không lưu nháp được. Phiếu gửi đi chuyển thẳng Lãnh đạo duyệt (B2)."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Thông tin phiếu" subtitle="Các trường có * là bắt buộc" />
          <div className="p-5">
            {isAdmin && (
              <div className="mb-4">
                <Field label="NV cung ứng phụ trách" required htmlFor="assignee" hint="Admin tạo phiếu thay — mỗi phiếu có đúng một NV cung ứng phụ trách">
                  <Select id="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">— Chọn —</option>
                    {requesters.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.username})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            <DraftFieldsForm value={fields} onChange={setFields} />
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Hồ sơ đính kèm B1" subtitle="Bắt buộc đủ 2 ô mới lưu hoặc gửi được" />
            <div className="flex flex-col gap-2 p-4">
              {B1_SLOTS.map((s) => (
                <PendingSlot key={s} slot={s} files={pending[s] ?? []} onChange={(f) => setPending({ ...pending, [s]: f })} />
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex flex-col gap-3">
              {missingFiles.length > 0 && (
                <Notice tone="warn">
                  Còn thiếu: {missingFiles.map((s) => SLOT_DEF[s].label).join(', ')}. Đính kèm đủ 2 file mới lưu nháp
                  hoặc gửi được.
                </Notice>
              )}
              <Checkpoint checked={tick} onChange={setTick}>
                Gửi Lãnh đạo
              </Checkpoint>
              {/* Thieu file thi chan ca hai duong: luu nhap cung khong cho. Phieu
                  nhap do dang khong co chung tu chi nam lai lam rac hang doi, va
                  backend se chan ngay khi bam gui. */}
              <Button
                onClick={() => save(true)}
                disabled={busy || !tick || missingFiles.length > 0}
                title={missingFiles.length > 0 ? 'Cần đính kèm đủ 2 file bắt buộc' : undefined}
              >
                <Send className="h-4 w-4" /> Gửi Lãnh đạo duyệt (B2)
              </Button>
              <Button
                variant="secondary"
                onClick={() => save(false)}
                disabled={busy || missingFiles.length > 0}
                title={missingFiles.length > 0 ? 'Cần đính kèm đủ 2 file bắt buộc' : undefined}
              >
                <Save className="h-4 w-4" /> Lưu nháp
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function PendingSlot({ slot, files, onChange }: { slot: Slot; files: File[]; onChange: (f: File[]) => void }) {
  const db = useDb();
  const id = `pending-${slot}`;
  return (
    <div
      className={`rounded-lg border p-3 ${files.length ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50/50'}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onChange([...files, ...e.dataTransfer.files]);
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">
          {SLOT_DEF[slot].label}
          <span className="ml-0.5 text-red-600">*</span>
        </p>
        <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
          <UploadCloud className="h-3.5 w-3.5" /> Chọn file
        </label>
        <input
          id={id}
          type="file"
          multiple
          hidden
          accept={db.config.allowedExtensions.map((x) => '.' + x).join(',')}
          onChange={(e) => {
            onChange([...files, ...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      {files.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">Kéo thả hoặc chọn file</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 text-xs">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-slate-400">{formatBytes(f.size)}</span>
              <button onClick={() => onChange(files.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label={`Bỏ ${f.name}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline editor for B1.1 fields on the detail page (owner at DRAFT, or Admin at any in-progress step). */
export function DraftEditor({ pr, onDone }: { pr: PaymentRequest; onDone?: () => void }) {
  const [value, setValue] = useState<DraftFields>(() => fieldsOf(pr));
  const dirty = JSON.stringify(value) !== JSON.stringify(fieldsOf(pr));
  return (
    <div className="flex flex-col gap-4">
      <DraftFieldsForm value={value} onChange={setValue} />
      <div className="flex justify-end gap-2">
        {onDone && (
          <Button variant="secondary" onClick={onDone}>
            Đóng
          </Button>
        )}
        <Button
          disabled={!dirty}
          onClick={async () => {
            const ok = await attempt(() => store.run({ type: 'UPDATE_INFO', id: pr.id, version: pr.version, fields: value }));
            if (ok) onDone?.();
          }}
        >
          <Save className="h-4 w-4" /> Lưu thông tin
        </Button>
      </div>
    </div>
  );
}
