import { useState } from 'react';
import { KeyRound, Lock, Pencil, Plus, RotateCcw, Trash2, Unlock } from 'lucide-react';
import { useDb, useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { ROLE_LABEL } from '../../domain/constants';
import { DEFAULT_ALLOWED_EXTENSIONS } from '../../domain/constants';
import { ROLES, type MasterKind, type Role, type SystemConfig, type User } from '../../domain/types';
import { ROLE_DEPT_KIND, type UserInput } from '../../domain/admin';
import type { Db } from '../../domain/types';

/** A user who owns or handled requests may only be locked, never deleted. */
function hasUserActivity(db: Db, userId: string): { hasActivity: boolean; reason: string } {
  const linked = db.requests.filter(
    (r) => r.assignedRequesterId === userId || r.assignedAccountantId === userId || r.createdBy === userId,
  ).length;
  return {
    hasActivity: linked > 0,
    reason: linked > 0 ? `Đang gắn với ${linked} phiếu — chỉ khóa được, không xóa được.` : '',
  };
}
import { DEPARTMENT_KIND_LABEL } from '../../domain/constants';
import { cx, formatDate } from '../../lib/format';
import { deptName } from '../../lib/lookup';
import { Button, Card, CardHeader, Field, Input, Modal, Notice, PageHeader, Select, Tabs } from '../../ui/primitives';
import { attempt } from '../../ui/toast';
import { DepartmentPanel, MASTER_TITLE, MasterDataPanel } from '../master-data/MasterDataPanel';

// ---------------------------------------------------------------------------
// Người dùng
// ---------------------------------------------------------------------------

export function UsersPage() {
  const db = useDb();
  const me = useMe();
  const [editing, setEditing] = useState<{ user?: User } | null>(null);
  const [reset, setReset] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [tempPwd, setTempPwd] = useState('');

  return (
    <>
      <PageHeader
        title="Người dùng"
        description="Mỗi tài khoản đúng 1 vai trò; phòng ban tự theo vai trò (4 phòng: Cung Ứng, Lãnh Đạo, Trưởng Phòng Tài Chính, Kế Toán). Đăng nhập bằng username do Admin cấp; tài khoản mới phải đổi mật khẩu ở lần đăng nhập đầu. Mỗi phòng Cung ứng/Kế toán chỉ 1 Lead; luôn còn ≥ 1 Admin."
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" /> Tạo tài khoản
          </Button>
        }
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="px-4 py-2.5 font-medium">Người dùng</th>
                <th className="px-4 py-2.5 font-medium">Vai trò</th>
                <th className="px-4 py-2.5 font-medium">Phòng ban</th>
                <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {db.users.map((u) => {
                const tempLocked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
                const activity = hasUserActivity(db, u.id);
                const isSelf = me?.id === u.id;
                const canDelete = !isSelf && !activity.hasActivity;

                return (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.fullName}</p>
                      <p className="font-mono text-xs text-slate-500">{u.username}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {ROLE_LABEL[u.role]}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{u.departmentId ? deptName(db, u.departmentId) : <span className="text-slate-400">Không thuộc phòng ban</span>}</td>
                    <td className="px-4 py-3">
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', u.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                        {u.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                      </span>
                      {tempLocked && <p className="mt-1 text-xs text-amber-700">Khóa tạm (sai mật khẩu)</p>}
                      {u.mustChangePassword && <p className="mt-1 text-xs text-slate-500">Chờ đổi mật khẩu</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditing({ user: u })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Sửa" aria-label={`Sửa ${u.username}`}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => { setReset(u); setTempPwd(''); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Đặt lại mật khẩu" aria-label={`Đặt lại mật khẩu ${u.username}`}>
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => void attempt(() => store.admin({ type: 'SET_USER_STATUS', userId: u.id, status: u.status === 'ACTIVE' ? 'LOCKED' : 'ACTIVE' }))}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          title={u.status === 'ACTIVE' ? 'Khóa tài khoản' : 'Mở khóa'}
                          aria-label={u.status === 'ACTIVE' ? `Khóa ${u.username}` : `Mở khóa ${u.username}`}
                        >
                          {u.status === 'ACTIVE' ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => setDeletingUser(u)}
                          className={cx(
                            'rounded p-1.5 transition-colors',
                            canDelete
                              ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                              : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500',
                          )}
                          title={
                            isSelf
                              ? 'Không thể xóa tài khoản của chính mình'
                              : activity.hasActivity
                                ? `Không thể xóa: ${activity.reason}. Chỉ xóa được tài khoản mới chưa có giao dịch.`
                                : `Xóa tài khoản ${u.username} (chưa phát sinh giao dịch)`
                          }
                          aria-label={`Xóa ${u.username}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && <UserDialog user={editing.user} onClose={() => setEditing(null)} />}
      {deletingUser && (() => {
        const activity = hasUserActivity(db, deletingUser.id);
        const isSelf = me?.id === deletingUser.id;
        const canDelete = !isSelf && !activity.hasActivity;

        return (
          <Modal
            title={`Xác nhận xóa tài khoản — ${deletingUser.fullName}`}
            onClose={() => setDeletingUser(null)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDeletingUser(null)}>
                  {canDelete ? 'Hủy' : 'Đóng'}
                </Button>
                {canDelete && (
                  <Button
                    variant="danger"
                    onClick={async () => {
                      const ok = await attempt(() => store.admin({ type: 'DELETE_USER', userId: deletingUser.id }));
                      if (ok) setDeletingUser(null);
                    }}
                  >
                    Xóa vĩnh viễn
                  </Button>
                )}
              </>
            }
          >
            <div className="space-y-4">
              {isSelf ? (
                <Notice tone="danger">
                  <p className="font-medium">Không thể tự xóa tài khoản của chính mình.</p>
                  <p className="mt-1 text-sm">Bạn đang đăng nhập bằng tài khoản này. Vui lòng sử dụng một tài khoản Admin khác nếu cần thao tác.</p>
                </Notice>
              ) : activity.hasActivity ? (
                <Notice tone="danger">
                  <p className="font-semibold text-base">Không thể xóa người dùng này!</p>
                  <p className="mt-1.5 text-sm">
                    <strong>Lý do:</strong> {activity.reason}.
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Theo quy định quản trị và kiểm toán, chỉ cho phép xóa những tài khoản <strong>mới khởi tạo và chưa phát sinh bất kỳ giao dịch/phiếu yêu cầu/chứng từ nào</strong>.
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    💡 <em>Gợi ý:</em> Bạn có thể sử dụng nút <strong>Khóa tài khoản</strong> (biểu tượng chiếc khóa) ở danh sách người dùng để ngăn chặn đăng nhập mà vẫn bảo toàn toàn vẹn lịch sử dữ liệu.
                  </p>
                </Notice>
              ) : (
                <>
                  <Notice tone="warn">
                    <p className="font-semibold">Tài khoản mới khởi tạo & chưa phát sinh giao dịch</p>
                    <p className="mt-1 text-sm">
                      Người dùng này chưa tạo hoặc tham gia xử lý bất kỳ phiếu chi, giao dịch thanh toán hay chứng từ nào.
                      Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản này khỏi hệ thống? Thao tác này không thể hoàn tác.
                    </p>
                  </Notice>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-slate-500">Tên đăng nhập:</span>{' '}
                        <span className="font-mono font-semibold text-slate-900">{deletingUser.username}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Họ và tên:</span>{' '}
                        <span className="font-medium text-slate-900">{deletingUser.fullName}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Vai trò:</span>{' '}
                        <span className="font-medium text-slate-900">{ROLE_LABEL[deletingUser.role]}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Phòng ban:</span>{' '}
                        <span className="font-medium text-slate-900">
                          {deletingUser.departmentId ? deptName(db, deletingUser.departmentId) : 'Không thuộc phòng ban'}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Modal>
        );
      })()}
      {reset && (
        <Modal
          title={`Đặt lại mật khẩu — ${reset.username}`}
          onClose={() => setReset(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReset(null)}>
                Hủy
              </Button>
              <Button
                onClick={async () => {
                  if (await attempt(() => store.resetPassword(reset.id, tempPwd))) setReset(null);
                }}
              >
                Đặt lại
              </Button>
            </>
          }
        >
          <Field label="Mật khẩu tạm" required hint="Tối thiểu 8 ký tự gồm chữ và số. Người dùng phải đổi ở lần đăng nhập tới." htmlFor="tmp">
            <Input id="tmp" value={tempPwd} onChange={(e) => setTempPwd(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  );
}

function UserDialog({ user, onClose }: { user?: User; onClose: () => void }) {
  const db = useDb();
  const [input, setInput] = useState<UserInput>(
    user
      ? { username: user.username, fullName: user.fullName, role: user.role }
      : { username: '', fullName: '', role: 'REQUESTER' },
  );
  const [pwd, setPwd] = useState('');

  const save = async () => {
    const ok = await attempt(() => (user ? store.admin({ type: 'UPDATE_USER', userId: user.id, input }) : store.createUser(input, pwd)));
    if (ok) onClose();
  };

  return (
    <Modal
      title={user ? `Sửa tài khoản ${user.username}` : 'Tạo tài khoản'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={save}>Lưu</Button>
        </>
      }
    >
      <div className="grid gap-4">
        {user && <Notice tone="info">Đổi username, vai trò hoặc phòng ban được ghi nhật ký. Không tạo tài khoản mới khi đổi vai trò.</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username" required htmlFor="u-name" hint="Không phân biệt hoa thường">
            <Input id="u-name" value={input.username} onChange={(e) => setInput({ ...input, username: e.target.value })} />
          </Field>
          <Field label="Họ tên" required htmlFor="u-full">
            <Input id="u-full" value={input.fullName} onChange={(e) => setInput({ ...input, fullName: e.target.value })} />
          </Field>
          <Field label="Vai trò" required htmlFor="u-role">
            <Select id="u-role" value={input.role} onChange={(e) => setInput({ ...input, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phòng ban" htmlFor="u-dept" hint="Tự theo vai trò">
            <Input id="u-dept" disabled value={ROLE_DEPT_KIND[input.role] ? (db.departments.find((d) => d.kind === ROLE_DEPT_KIND[input.role])?.name ?? DEPARTMENT_KIND_LABEL[ROLE_DEPT_KIND[input.role]!]) : 'Không thuộc phòng ban (Admin)'} />
          </Field>
        </div>
        {!user && (
          <Field label="Mật khẩu tạm" required htmlFor="u-pwd" hint="Tối thiểu 8 ký tự gồm chữ và số. Bắt buộc đổi ở lần đăng nhập đầu.">
            <Input id="u-pwd" value={pwd} onChange={(e) => setPwd(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Danh mục
// ---------------------------------------------------------------------------

type MdTab = MasterKind | 'departments';

export function MasterDataPage() {
  const [tab, setTab] = useState<MdTab>('projects');
  const tabs: MdTab[] = ['projects', 'departments', 'categories', 'requesterNames', 'vendors'];
  return (
    <>
      <PageHeader title="Danh mục" description="Master Data dùng trên form B1.1. Loại chi là checkbox “Có hóa đơn” trên phiếu, không phải danh mục." />
      <Card className="p-5">
        <div className="mb-4">
          <Tabs value={tab} onChange={setTab} items={tabs.map((t) => ({ value: t, label: MASTER_TITLE[t] }))} />
        </div>
        {tab === 'departments' ? <DepartmentPanel /> : <MasterDataPanel kind={tab} />}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cấu hình (hạn B8, đăng nhập, file, ngày lễ)
// ---------------------------------------------------------------------------

export function ConfigPage() {
  const db = useDb();
  const me = useMe();
  const [cfg, setCfg] = useState<SystemConfig>(db.config);
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const num = (k: keyof SystemConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: Number(e.target.value) });

  return (
    <>
      <PageHeader title="Cấu hình" description="Thay đổi được ghi nhật ký." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tham số hệ thống" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Hạn bổ sung hóa đơn (ngày làm việc)" htmlFor="c1">
              <Input id="c1" type="number" min={1} value={cfg.invoiceDeadlineWorkingDays} onChange={num('invoiceDeadlineWorkingDays')} />
            </Field>
            <Field label="Số lần đăng nhập sai trước khi khóa" htmlFor="c2">
              <Input id="c2" type="number" min={1} value={cfg.maxLoginAttempts} onChange={num('maxLoginAttempts')} />
            </Field>
            <Field label="Thời gian khóa tạm (phút)" htmlFor="c3">
              <Input id="c3" type="number" min={1} value={cfg.lockMinutes} onChange={num('lockMinutes')} />
            </Field>
            <Field label="Dung lượng file tối đa (MB)" htmlFor="c4">
              <Input id="c4" type="number" min={1} value={cfg.maxFileSizeMb} onChange={num('maxFileSizeMb')} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-xs font-medium text-slate-700">Định dạng file cho phép</legend>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_ALLOWED_EXTENSIONS.map((ext: string) => {
                  const on = cfg.allowedExtensions.includes(ext);
                  return (
                    <button
                      key={ext}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCfg({ ...cfg, allowedExtensions: on ? cfg.allowedExtensions.filter((x) => x !== ext) : [...cfg.allowedExtensions, ext] })}
                      className={cx('rounded-full px-2.5 py-1 font-mono text-xs ring-1 ring-inset', on ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-slate-400 ring-slate-200')}
                    >
                      .{ext}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="sm:col-span-2">
              <Button onClick={() => void attempt(() => store.admin({ type: 'SAVE_CONFIG', config: cfg }))}>Lưu cấu hình</Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Lịch nghỉ lễ" subtitle="Dùng để đếm ngày làm việc ở B8 (cùng với T7, CN)" />
          <div className="flex flex-col gap-4 p-5">
            <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
              <Input type="date" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} aria-label="Ngày" />
              <Input placeholder="Tên ngày lễ" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} aria-label="Tên ngày lễ" />
              <Button
                onClick={async () => {
                  if (await attempt(() => store.admin({ type: 'SAVE_HOLIDAY', ...holiday }))) setHoliday({ date: '', name: '' });
                }}
              >
                Thêm
              </Button>
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {db.holidays.map((h) => (
                <li key={h.date} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    <span className="mr-3 tabular-nums text-slate-500">{formatDate(h.date)}</span>
                    {h.name}
                  </span>
                  <button onClick={() => void attempt(() => store.admin({ type: 'DELETE_HOLIDAY', date: h.date }))} className="rounded p-1 text-red-500 hover:bg-red-50" aria-label={`Xóa ${h.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        {me.role === 'ADMIN' && (
          <Card className="lg:col-span-2">
            <CardHeader title="Dữ liệu demo" subtitle="Chỉ có ở chế độ chạy trên trình duyệt (không có backend)" />
            <div className="flex flex-wrap items-center gap-3 p-5">
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm('Xóa toàn bộ dữ liệu trên trình duyệt này và nạp lại dữ liệu mẫu?')) void store.resetDemo();
                }}
              >
                <RotateCcw className="h-4 w-4" /> Nạp lại dữ liệu mẫu
              </Button>
              <p className="text-xs text-slate-500">Bạn sẽ bị đăng xuất.</p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
