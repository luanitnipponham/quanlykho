import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useDb, useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { ROLE_LABEL, isTerminal } from '../../domain/constants';
import { canManageMaster } from '../../domain/permissions';
import type { MasterKind } from '../../domain/types';
import { Button, Input, Modal } from '../../ui/primitives';
import { attempt } from '../../ui/toast';

export const MASTER_TITLE: Record<MasterKind | 'departments', string> = {
  projects: 'Dự án',
  departments: 'Phòng ban',
  categories: 'Hạng mục chi',
  requesterNames: 'Người yêu cầu',
  vendors: 'Nhà cung cấp',
};

const FIELD_OF: Record<MasterKind, 'projectId' | 'categoryId' | 'requesterNameId' | 'vendorId'> = {
  projects: 'projectId',
  categories: 'categoryId',
  requesterNames: 'requesterNameId',
  vendors: 'vendorId',
};

export function MasterDataPanel({ kind }: { kind: MasterKind }) {
  const db = useDb();
  const me = useMe();
  const editable = canManageMaster(me, kind);
  const [editing, setEditing] = useState<{ id?: string; code: string; name: string } | null>(null);
  const items = db[kind].filter((x) => !x.deleted);
  const inUse = (id: string) => db.requests.filter((r) => !isTerminal(r.status) && r[FIELD_OF[kind]] === id).length;

  const save = async () => {
    if (!editing) return;
    const ok = await attempt(() => store.admin({ type: 'SAVE_MASTER', kind, ...editing }));
    if (ok) setEditing(null);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {items.length} mục · {editable ? 'Xóa là xóa mềm; không xóa được mục đang gắn với phiếu chưa kết thúc.' : 'Bạn chỉ có quyền xem danh mục này.'}
        </p>
        {editable && (
          <Button size="sm" onClick={() => setEditing({ code: '', name: '' })}>
            <Plus className="h-3.5 w-3.5" /> Thêm
          </Button>
        )}
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.map((it) => {
          const used = inUse(it.id);
          return (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-20 shrink-0 font-mono text-xs text-slate-500">{it.code || '—'}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{it.name}</span>
              {used > 0 && <span className="shrink-0 text-xs text-slate-500">{used} phiếu mở</span>}
              {editable && (
                <>
                  <button onClick={() => setEditing({ id: it.id, code: it.code, name: it.name })} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`Sửa ${it.name}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Xóa "${it.name}"?`)) void attempt(() => store.admin({ type: 'DELETE_MASTER', kind, id: it.id }));
                    }}
                    disabled={used > 0}
                    title={used > 0 ? 'Đang gắn với phiếu chưa kết thúc' : 'Xóa mềm'}
                    className="rounded p-1 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                    aria-label={`Xóa ${it.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <Modal
          title={editing.id ? `Sửa ${MASTER_TITLE[kind].toLowerCase()}` : `Thêm ${MASTER_TITLE[kind].toLowerCase()}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Hủy
              </Button>
              <Button onClick={save}>Lưu</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <Input placeholder="Mã" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} aria-label="Mã" />
            <Input placeholder="Tên" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Tên" />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The four fixed departments. Admin may rename them; adding, deleting or changing kind is not allowed. */
export function DepartmentPanel() {
  const db = useDb();
  const me = useMe();
  const editable = canManageMaster(me, 'departments');
  const [editing, setEditing] = useState<{ id: string; code: string; name: string } | null>(null);
  const items = db.departments;
  const members = (id: string) => db.users.filter((u) => u.departmentId === id && u.status === 'ACTIVE');

  const save = async () => {
    if (!editing) return;
    const ok = await attempt(() => store.admin({ type: 'SAVE_DEPARTMENT', ...editing }));
    if (ok) setEditing(null);
  };

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        Hệ thống cố định 4 phòng ban; phòng ban của mỗi tài khoản tự theo vai trò. Lead cung ứng duyệt B1.2 xong, phiếu chuyển thẳng Lãnh Đạo.
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.map((d) => {
          const list = members(d.id);
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="w-16 shrink-0 font-mono text-xs text-slate-500">{d.code}</span>
              <span className="min-w-0 flex-1 text-sm text-slate-800">{d.name}</span>
              <span className="text-xs text-slate-600">
                {list.length} người{list.length ? `: ${list.map((u) => `${u.fullName} (${ROLE_LABEL[u.role]})`).join(', ')}` : ''}
              </span>
              {editable && (
                <button onClick={() => setEditing({ id: d.id, code: d.code, name: d.name })} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`Đổi tên ${d.name}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <Modal
          title="Đổi tên phòng ban"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Hủy
              </Button>
              <Button onClick={save}>Lưu</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <Input placeholder="Mã" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} aria-label="Mã" />
            <Input placeholder="Tên phòng ban" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Tên" />
          </div>
        </Modal>
      )}
    </div>
  );
}
