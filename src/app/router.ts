import { useSyncExternalStore } from 'react';

// Hash router: "#/requests/pr-12" → "/requests/pr-12". Keeps deep links working on any static host.

function currentPath(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/home';
}

function subscribe(fn: () => void): () => void {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

export function navigate(path: string): void {
  if (currentPath() === path) return;
  window.location.hash = path;
}

export function hrefOf(path: string): string {
  return `#${path}`;
}

/** "/requests/:id" matched against "/requests/pr-3" → { id: "pr-3" }. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const a = path.split('?')[0].split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
