/** Normalized slash style for comparisons (browser-side). */
export function normalizeFsPath(p) {
  return String(p || '').trim().replace(/\\/g, '/');
}

export function joinFsPath(root, segment) {
  const r = normalizeFsPath(root).replace(/\/+$/, '');
  const s = String(segment || '').replace(/^\/+|\/+$/g, '');
  if (!r) return s;
  if (!s) return r;
  return `${r}/${s}`;
}

/** Parent directory of an absolute path (Unix-first; tolerates backslashes). */
export function parentFsPath(abs) {
  const raw = String(abs || '').trim();
  if (!raw) return '';
  let s = raw.replace(/\\/g, '/');
  if (s === '/') return '/';
  s = s.replace(/\/+$/, '');
  if (!s) return '/';
  if (s === '/') return '/';
  const i = s.lastIndexOf('/');
  if (i < 0) return s;
  if (i === 0) return '/';
  return s.slice(0, i);
}

export function canGoUpDirectory(current) {
  if (!current || !String(current).trim()) return false;
  const n = normalizeFsPath(current).replace(/\/+$/, '') || '/';
  if (n === '/') return false;
  const p = parentFsPath(current);
  if (!p || normalizeFsPath(p) === n) return false;
  return true;
}
