const money = new Intl.NumberFormat('vi-VN');

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${money.format(n)} ₫`;
}

export function formatNumber(n: number): string {
  return money.format(n);
}

/** Parses "1.250.000" / "1250000" typed in a money input. */
export function parseMoney(s: string): number {
  const digits = s.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(s: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(s).getTime()) / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
