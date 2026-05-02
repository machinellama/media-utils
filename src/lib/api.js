const FALLBACK = 'http://localhost:3001';

export function getApiBase() {
  const v = import.meta.env.VITE_API_URL;
  if (v && String(v).trim()) return String(v).replace(/\/$/, '');
  if (typeof window !== 'undefined') return '';
  return FALLBACK;
}

export function apiUrl(path) {
  const base = getApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export async function apiFetch(path, options = {}) {
  const url = apiUrl(path);
  return fetch(url, options);
}
