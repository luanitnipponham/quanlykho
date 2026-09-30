import { useRef, useState, type DragEvent } from 'react';
import { Archive, Download, Eye, FileImage, FileText, Lock, Trash2, UploadCloud } from 'lucide-react';
import { useDb, useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { SLOT_DEF, SLOT_GROUPS, stepIndex } from '../../domain/constants';
import { canDeleteAttachment, canUploadToSlot } from '../../domain/permissions';
import type { Attachment, PaymentRequest, Slot } from '../../domain/types';
import { cx, formatBytes, formatDateTime } from '../../lib/format';
import { userName } from '../../lib/lookup';
import { attempt, toast } from '../../ui/toast';

export async function openAttachment(att: Attachment, mode: 'view' | 'download') {
  try {
    const { blob, placeholder } = await store.fileBlob(att);
    const url = URL.createObjectURL(blob);
    if (mode === 'view') {
      window.open(url, '_blank', 'noopener');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = placeholder ? `${att.fileName}.demo.txt` : att.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast.error(e);
  }
}

/** Which slots are mandatory at their step (workflow §8.2). */
export function slotRequirement(pr: PaymentRequest, slot: Slot): 'required' | 'conditional' | 'optional' {
  if (slot === 'INVOICE') return pr.status === 'DOCUMENT_SUPPLEMENT_REQUIRED' ? 'required' : pr.hasInvoice ? 'conditional' : 'optional';
  if (slot === 'FINAL_PROOF') return 'conditional';
  return 'required';
}

export function AttachmentSlot({ pr, slot, compact }: { pr: PaymentRequest; slot: Slot; compact?: boolean }) {
  const db = useDb();
  const me = useMe();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const files = db.attachments.filter((a) => a.requestId === pr.id && a.slot === slot);
  const canUpload = canUploadToSlot(me, pr, slot);
  const def = SLOT_DEF[slot];
  const req = slotRequirement(pr, slot);

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    await attempt(async () => {
      const created = await store.upload(pr.id, slot, [...list]);
      return `Đã tải lên ${created.length} file vào "${def.label}"`;
    });
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (canUpload) void upload(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={cx('rounded-lg border p-3', drag ? 'border-brand-400 bg-brand-50' : files.length ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50/50')}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">
          {def.label}
          {req === 'required' && <span className="ml-0.5 text-red-600">*</span>}
          {req === 'conditional' && <span className="ml-1 text-xs font-normal text-slate-500">{slot === 'INVOICE' ? '(nếu có)' : '(nếu còn tiền phải chi)'}</span>}
        </p>
        {canUpload ? (
          <button
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            <UploadCloud className="h-3.5 w-3.5" /> {busy ? 'Đang tải…' : 'Tải lên'}
          </button>
        ) : (
          files.length > 0 && <Lock className="h-3.5 w-3.5 text-slate-400" aria-label="Đã khóa" />
        )}
        <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} accept={db.config.allowedExtensions.map((x) => '.' + x).join(',')} />
      </div>
      {files.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">{canUpload ? 'Kéo thả file vào đây hoặc bấm Tải lên' : 'Chưa có file'}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {files.map((f) => (
            <FileRow key={f.id} att={f} canDelete={canDeleteAttachment(me, pr, f)} compact={compact} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FileRow({ att, canDelete, compact }: { att: Attachment; canDelete: boolean; compact?: boolean }) {
  const db = useDb();
  const Icon = /.(png|jpe?g|webp|heic)$/i.test(att.fileName) ? FileImage : FileText;
  return (
    <li className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-800" title={att.storagePath}>
          {att.fileName}
        </p>
        {!compact && (
          <p className="truncate text-[11px] text-slate-500">
            {formatBytes(att.size)} · {userName(db, att.uploadedBy)} · {formatDateTime(att.uploadedAt)}
          </p>
        )}
      </div>
      <button onClick={() => openAttachment(att, 'view')} className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-800" aria-label={`Xem ${att.fileName}`} title="Xem">
        <Eye className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => openAttachment(att, 'download')} className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-800" aria-label={`Tải về ${att.fileName}`} title="Tải về">
        <Download className="h-3.5 w-3.5" />
      </button>
      {canDelete && (
        <button
          onClick={() => {
            if (window.confirm(`Xóa file "${att.fileName}"?`)) void attempt(() => store.run({ type: 'DETACH', attachmentId: att.id }));
          }}
          className="rounded p-1 text-red-500 hover:bg-white hover:text-red-700"
          aria-label={`Xóa ${att.fileName}`}
          title="Xóa"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

/** All attachment groups; a group whose step has not been reached and has no files is collapsed. */
export function AttachmentGroups({ pr }: { pr: PaymentRequest }) {
  const db = useDb();
  const reached = pr.status === 'COMPLETED' ? 99 : Math.max(stepIndex(pr.status), maxReachedIndex(pr));
  const groupStepIndex: Record<string, number> = { 'B1.1': 0, B3: 3, B5: 5, B6: 6, B7: 7 };
  return (
    <div className="flex flex-col gap-5">
      {/* Tệp đã rời khỏi đĩa máy chủ: xem/tải sẽ lỗi cho tới khi Admin phục hồi. */}
      {pr.archivedAt && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">Đã lưu trữ ngày {new Date(pr.archivedAt).toLocaleDateString('vi-VN')}.</span>{' '}
            Danh sách tệp bên dưới giữ nguyên, nhưng tệp đang nằm trên NAS chứ không còn trên máy chủ nên chưa xem hay
            tải được. Admin bấm <span className="font-medium">Phục hồi</span> ở màn Phiếu hoàn thành để kéo về.
          </span>
        </p>
      )}
      {SLOT_GROUPS.map((g) => {
        const has = g.slots.some((s) => db.attachments.some((a) => a.requestId === pr.id && a.slot === s));
        const open = has || reached >= groupStepIndex[g.step];
        return (
          <div key={g.step}>
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{g.step}</span>
              {g.title}
              {g.step === 'B6' && <span className="font-normal text-slate-400">· ô Hóa đơn còn bổ sung được ở B7, B8</span>}
            </p>
            {open ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {g.slots.map((s) => (
                  <AttachmentSlot key={s} pr={pr} slot={s} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Chưa đến bước này</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function maxReachedIndex(pr: PaymentRequest): number {
  let max = 0;
  for (const t of pr.timeline) {
    if (t.fromStatus) max = Math.max(max, stepIndex(t.fromStatus));
    if (t.toStatus) max = Math.max(max, stepIndex(t.toStatus));
  }
  return max;
}
