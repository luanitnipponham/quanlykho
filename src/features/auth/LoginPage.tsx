import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, LogIn } from 'lucide-react';
import { api } from '../../data/api';
import { store } from '../../data/store';
import { DEFAULT_PASSWORD_HINT, ROLE_LABEL } from '../../domain/constants';
import { SEED_ACCOUNTS } from '../../domain/seed';
import type { Role } from '../../domain/types';
import { DomainError } from '../../domain/errors';
import { Button, Field, Input } from '../../ui/primitives';

interface Suggested {
  username: string;
  fullName: string;
  role: Role;
}

// Tài khoản Admin không hiện ở danh sách gợi ý: người test chỉ dùng 4 phòng ban.
// Vẫn đăng nhập được bằng cách gõ tay tên đăng nhập.
// Đây chỉ là bản dự phòng cho chế độ chạy trên trình duyệt; nối backend thì
// danh sách được đọc từ PostgreSQL để họ tên luôn khớp với Quản lý người dùng.
const FALLBACK_ACCOUNTS: Suggested[] = SEED_ACCOUNTS.filter((a) => a.role !== 'ADMIN').map((a) => ({
  username: a.username,
  fullName: a.fullName,
  role: a.role,
}));

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Suggested[]>(FALLBACK_ACCOUNTS);

  useEffect(() => {
    let alive = true;
    // Backend không chạy thì giữ nguyên bản dự phòng, không báo lỗi ở màn đăng nhập.
    api
      .accounts()
      .then((rows) => {
        if (alive && rows.length) setAccounts(rows.filter((r) => r.role !== 'ADMIN'));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await store.login(username, password);
      window.location.hash = '/home';
    } catch (err) {
      setError(err instanceof DomainError ? err.message : 'Không đăng nhập được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Phiếu yêu cầu chi</h1>
              <p className="text-xs text-slate-500">Đăng nhập bằng tài khoản Admin cấp</p>
            </div>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Tên đăng nhập" htmlFor="username">
              <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </Field>
            <Field label="Mật khẩu" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || !username || !password} className="mt-2">
              <LogIn className="h-4 w-4" /> Đăng nhập
            </Button>
            <p className="text-xs text-slate-500">Sai mật khẩu 5 lần liên tiếp, tài khoản bị khóa tạm 15 phút.</p>
          </form>
        </div>

        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6">
          <h2 className="text-sm font-semibold text-slate-900">Tài khoản demo</h2>
          <p className="mt-1 text-xs text-slate-500">
            Mật khẩu chung: <code className="rounded bg-slate-100 px-1 font-mono">{DEFAULT_PASSWORD_HINT}</code>. Bấm để điền sẵn.
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {accounts.map((a) => (
              <li key={a.username}>
                <button
                  type="button"
                  onClick={() => {
                    setUsername(a.username);
                    setPassword(DEFAULT_PASSWORD_HINT);
                    setError('');
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{a.fullName}</span>
                    <span className="block font-mono text-xs text-slate-500">{a.username}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-500">
                    {ROLE_LABEL[a.role]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
