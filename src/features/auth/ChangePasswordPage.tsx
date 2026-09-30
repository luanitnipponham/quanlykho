import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { DomainError } from '../../domain/errors';
import { Button, Card, Field, Input, Notice } from '../../ui/primitives';
import { toast } from '../../ui/toast';

export function ChangePasswordPage({ forced }: { forced: boolean }) {
  const me = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('Mật khẩu nhập lại không khớp');
      return;
    }
    try {
      await store.changePassword(current, next);
      toast.success('Đã đổi mật khẩu');
      window.location.hash = '/home';
    } catch (err) {
      setError(err instanceof DomainError ? err.message : 'Không đổi được mật khẩu');
    }
  };

  const body = (
    <Card className="w-full max-w-md p-6">
      <div className="mb-5 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-brand-600" />
        <div>
          <h1 className="text-base font-semibold text-slate-900">Đổi mật khẩu</h1>
          <p className="text-xs text-slate-500">
            {me.fullName} · <span className="font-mono">{me.username}</span>
          </p>
        </div>
      </div>
      {forced && (
        <div className="mb-4">
          <Notice tone="warn" title="Bắt buộc đổi mật khẩu">
            Đây là lần đăng nhập đầu hoặc mật khẩu vừa được Admin đặt lại.
          </Notice>
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Mật khẩu hiện tại" htmlFor="cur">
          <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Mật khẩu mới" htmlFor="new" hint="Tối thiểu 8 ký tự, gồm cả chữ và số">
          <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Nhập lại mật khẩu mới" htmlFor="confirm">
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={!current || !next || !confirm}>
            Lưu mật khẩu
          </Button>
          {forced && (
            <Button variant="ghost" onClick={() => store.logout()}>
              Đăng xuất
            </Button>
          )}
        </div>
      </form>
    </Card>
  );

  return forced ? <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">{body}</div> : body;
}
