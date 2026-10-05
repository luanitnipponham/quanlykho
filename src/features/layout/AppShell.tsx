import { useMemo, useState, type ReactNode } from 'react';
import { Bell, KeyRound, LogOut, Menu, X } from 'lucide-react';
import { COMPLETED_MENU, MENUS, type MenuItem } from '../../app/navigation';
import { hrefOf, navigate, usePath } from '../../app/router';
import { useDb, useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { countMissingDocAlerts } from '../../domain/completedAudit';
import { ROLE_LABEL } from '../../domain/constants';
import { queueItems } from '../../domain/permissions';
import { cx, timeAgo } from '../../lib/format';

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const db = useDb();
  const path = usePath();
  const [open, setOpen] = useState(false);
  const dept = db.departments.find((d) => d.id === me.departmentId);

  const items = useMemo(
    () =>
      MENUS[me.role]
        .map((m) => ({ ...m, n: m.count ? queueItems(db, me, m.count).length : undefined }))
        ,
    [db, me],
  );

  // Phiếu đã hoàn thành nhưng hồ sơ còn thiếu chứng từ — mọi phòng ban đều thấy.
  const missingDocs = useMemo(() => countMissingDocAlerts(db), [db]);

  const nav = (
    <nav className="flex h-full flex-col" aria-label="Menu chính">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">P</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-slate-900">Phiếu yêu cầu chi</p>
          <p className="text-[11px] text-slate-500">Workflow v3.4</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{ROLE_LABEL[me.role]}</p>
        <ul className="flex flex-col gap-0.5">
          {items.map((m) => (
            <NavLink key={m.path + m.label} item={m} count={m.n} active={isActive(path, m.path)} onClick={() => setOpen(false)} />
          ))}
        </ul>
        <p className="px-2 pb-1 pt-5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Dùng chung</p>
        <ul className="flex flex-col gap-0.5">
          <NavLink
            item={COMPLETED_MENU}
            count={missingDocs}
            tone="warn"
            countTitle={`${missingDocs} phiếu còn thiếu chứng từ đính kèm (gồm cả phiếu chờ bổ sung hóa đơn ở B8)`}
            active={isActive(path, COMPLETED_MENU.path)}
            onClick={() => setOpen(false)}
          />
        </ul>
      </div>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
            {me.fullName.split(' ').slice(-1)[0]?.[0] ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{me.fullName}</p>
            <p className="truncate text-[11px] text-slate-500">
              <span className="font-mono">{me.username}</span>{dept ? ` · ${dept.name}` : ''}
            </p>
          </div>
        </div>
        <div className="mt-1 flex gap-1">
          <a href={hrefOf('/change-password')} className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-slate-600 hover:bg-slate-100">
            <KeyRound className="h-3.5 w-3.5" /> Đổi mật khẩu
          </a>
          <button onClick={() => store.logout()} className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-slate-600 hover:bg-slate-100">
            <LogOut className="h-3.5 w-3.5" /> Đăng xuất
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng menu">
              <X className="h-5 w-5" />
            </button>
            {nav}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Mở menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <ModeBadge />
          <NotificationBell />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Shows whether writes go to PostgreSQL or to the in-browser demo copy. */
function ModeBadge() {
  const server = store.mode === 'server';
  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        server ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800',
      )}
      title={
        server
          ? 'Dữ liệu đang lưu vào PostgreSQL qua backend (localhost:3000)'
          : 'Không thấy backend — dữ liệu chỉ nằm trên trình duyệt này'
      }
    >
      <span className={cx('h-2 w-2 rounded-full', server ? 'bg-emerald-500' : 'bg-amber-500')} />
      <span className="hidden sm:inline">{server ? 'PostgreSQL' : 'Chế độ demo'}</span>
    </div>
  );
}

function isActive(path: string, itemPath: string): boolean {
  return path === itemPath || (itemPath !== '/home' && path.startsWith(itemPath + '/'));
}

function NavLink({
  item,
  count,
  active,
  onClick,
  tone = 'neutral',
  countTitle,
}: {
  item: MenuItem;
  count?: number;
  active: boolean;
  onClick: () => void;
  /** 'warn' dùng cho số việc còn thiếu, để không lẫn với số phiếu đang chờ xử lý. */
  tone?: 'neutral' | 'warn';
  countTitle?: string;
}) {
  const Icon = item.icon;
  return (
    <li>
      <a
        href={hrefOf(item.path)}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
          active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {count !== undefined && count > 0 && (
          <span
            title={countTitle}
            className={cx(
              'rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
              tone === 'warn'
                ? 'bg-red-600 text-white'
                : active
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-200 text-slate-700',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </a>
    </li>
  );
}

function NotificationBell() {
  const me = useMe();
  const db = useDb();
  const [open, setOpen] = useState(false);
  const mine = db.notifications.filter((n) => n.userId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = mine.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
        aria-label={`Thông báo, ${unread} chưa đọc`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Thông báo</p>
              {unread > 0 && (
                <button onClick={() => store.admin({ type: 'MARK_NOTIFICATIONS_READ', ids: 'ALL' })} className="text-xs font-medium text-brand-700 hover:underline">
                  Đánh dấu đã đọc
                </button>
              )}
            </div>
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {mine.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Chưa có thông báo</li>}
              {mine.slice(0, 40).map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      if (!n.read) store.admin({ type: 'MARK_NOTIFICATIONS_READ', ids: [n.id] });
                      setOpen(false);
                      if (n.requestId && db.requests.some((r) => r.id === n.requestId)) navigate(`/requests/${n.requestId}`);
                    }}
                    className={cx('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.read && 'bg-brand-50/50')}
                  >
                    <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-600')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                      <span className="block text-xs text-slate-600">{n.message}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
