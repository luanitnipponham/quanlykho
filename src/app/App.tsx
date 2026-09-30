import { useEffect, useState, type ReactNode } from 'react';
import { ServerCrash, ShieldOff } from 'lucide-react';
import { useCurrentUser } from '../data/hooks';
import { store } from '../data/store';
import { ConfigPage, MasterDataPage, UsersPage } from '../features/admin/AdminPages';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { CoordinationPage, FinanceMonitorPage } from '../features/finance/FinancePages';
import { HistoryPage } from '../features/common/HistoryPage';
import { LookupPage } from '../features/common/LookupPage';
import { ReportsPage } from '../features/common/ReportsPage';
import { AppShell } from '../features/layout/AppShell';
import { CompletedRequestsPage } from '../features/requests/CompletedRequestsPage';
import { QUEUE_PAGES, QueuePage } from '../features/requests/QueuePage';
import { RequestDetailPage } from '../features/requests/RequestDetailPage';
import { CreateRequestPage } from '../features/requests/RequestForm';
import type { User } from '../domain/types';
import { Button, Card, EmptyState } from '../ui/primitives';
import { Toaster } from '../ui/toast';
import { allowedPatterns, homePathFor } from './navigation';
import { matchPath, navigate, usePath } from './router';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    store
      .init()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-700">Không khởi tạo được dữ liệu: {error}</div>;
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Đang tải…</div>;
  if (store.backendUnreachable) return <BackendDown />;
  return (
    <>
      <Root />
      <Toaster />
    </>
  );
}

function Root() {
  const me = useCurrentUser();
  const path = usePath();
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <ChangePasswordPage forced />;
  return (
    <AppShell>
      <Routed me={me} path={path} />
    </AppShell>
  );
}

function Routed({ me, path }: { me: User; path: string }) {
  const home = homePathFor(me.role);
  const raw = path.split('?')[0];
  // Workflow §9 has no "Trang chủ": each role lands on its first menu entry.
  const isHomeAlias = raw === '/' || raw === '/home' || raw === '/login';
  const clean = isHomeAlias ? home : raw;
  // Render the landing screen straight away and tidy the address afterwards.
  useEffect(() => {
    if (isHomeAlias) navigate(home);
  }, [isHomeAlias, home]);
  if (!allowedPatterns(me.role).some((p) => matchPath(p, clean))) return <Forbidden home={home} />;

  const detail = matchPath('/requests/:id', clean);
  if (detail) return <RequestDetailPage key={detail.id} id={detail.id} />;
  if (clean === '/reports/completed-requests') return <CompletedRequestsPage />;
  if (QUEUE_PAGES[clean]) return <QueuePage key={clean} path={clean} />;

  const pages: Record<string, ReactNode> = {
    '/change-password': (
      <div className="flex justify-center">
        <ChangePasswordPage forced={false} />
      </div>
    ),
    '/procurement/requests/new': <CreateRequestPage />,
    '/finance/coordination': <CoordinationPage />,
    '/finance/monitor': <FinanceMonitorPage />,
    '/lookup': <LookupPage />,
    '/history': <HistoryPage />,
    '/reports': <ReportsPage />,
    '/admin/requests': <LookupPage title="Quản lý phiếu" admin />,
    '/admin/users': <UsersPage />,
    '/admin/master-data': <MasterDataPage />,
    '/admin/config': <ConfigPage />,
  };
  return pages[clean] ?? <NotFound />;
}

function Forbidden({ home }: { home: string }) {
  return (
    <Card>
      <EmptyState
        icon={<ShieldOff className="h-8 w-8" />}
        title="Không có quyền truy cập"
        hint={
          <>
            Màn hình này không thuộc vai trò của bạn.{' '}
            <Button variant="ghost" size="sm" onClick={() => navigate(home)}>
              Về màn hình chính
            </Button>
          </>
        }
      />
    </Card>
  );
}

function NotFound() {
  return (
    <Card>
      <EmptyState title="Không tìm thấy trang" />
    </Card>
  );
}

/** Production build only: refuse to run offline rather than accept writes the server never sees. */
function BackendDown() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="max-w-lg p-8 text-center">
        <ServerCrash className="mx-auto mb-4 h-10 w-10 text-red-600" />
        <h1 className="text-lg font-semibold text-slate-900">Không kết nối được máy chủ</h1>
        <p className="mt-2 text-sm text-slate-600">
          Giao diện không liên lạc được với API nên chưa thể đăng nhập. Dữ liệu bạn nhập lúc này sẽ không được lưu, vì vậy hệ thống
          tạm dừng thay vì chạy tiếp.
        </p>
        <p className="mt-4 text-left text-xs text-slate-500">
          Người quản trị kiểm tra giúp:
          <br />• <code className="rounded bg-slate-100 px-1">docker compose ps</code> — container <b>api</b> và <b>db</b> có đang chạy không
          <br />• <code className="rounded bg-slate-100 px-1">docker compose logs api</code> — lỗi kết nối cơ sở dữ liệu
        </p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Thử lại
        </Button>
      </Card>
    </div>
  );
}
