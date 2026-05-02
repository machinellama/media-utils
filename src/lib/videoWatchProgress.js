const LS_KEY = 'media_utils_video_watch_v1';

/** @type {Record<string, { t: number, dur?: number }>|null} */
let cache = null;

const listeners = new Set();

function loadCache() {
  if (cache !== null) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    const p = raw ? JSON.parse(raw) : {};
    cache = typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
  } catch {
    cache = {};
  }
  return cache;
}

let persistTimer = null;

function persistToDisk() {
  persistTimer = null;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(loadCache()));
  } catch {
    /* ignore */
  }
}

function schedulePersist() {
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(persistToDisk, 450);
}

function notify() {
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

/** @returns {{ t: number, dur?: number } | null} */
export function getWatchProgress(key) {
  const row = loadCache()[key];
  if (!row || typeof row.t !== 'number' || !Number.isFinite(row.t)) return null;
  const dur =
    typeof row.dur === 'number' && Number.isFinite(row.dur) && row.dur > 0 ? row.dur : undefined;
  return { t: row.t, dur };
}

/**
 * @param {string} key
 * @param {number} currentTime
 * @param {number} [duration]
 * @param {boolean} [forceImmediate] write localStorage now (pause / ended / unmount)
 */
export function recordWatchProgress(key, currentTime, duration, forceImmediate = false) {
  const store = loadCache();
  const prev = store[key];
  const dur =
    Number.isFinite(duration) && duration > 0
      ? duration
      : prev?.dur != null && prev.dur > 0
        ? prev.dur
        : undefined;
  store[key] = {
    t: Math.max(0, currentTime),
    ...(dur !== undefined ? { dur } : {})
  };
  notify();
  if (forceImmediate) {
    if (persistTimer != null) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistToDisk();
  } else {
    schedulePersist();
  }
}

export function subscribeWatchProgress(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
