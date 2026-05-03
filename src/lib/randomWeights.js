const LS_KEY = 'media_utils_random_weights_v1';

let cache = null;
const listeners = new Set();

function load() {
  if (cache !== null) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    const o = raw ? JSON.parse(raw) : {};
    cache = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(load()));
  } catch {
    /* ignore */
  }
}

export function getAllWeights() {
  return { ...load() };
}

export function setWeights(map) {
  cache = { ...map };
  persist();
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeWeights(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Compute the effective weight for a video given its abs path.
 * Returns the product of all configured ancestor weights (defaults 1.0).
 * @param {string} videoAbsPath
 * @param {Record<string, number>} [weightsOverride]
 */
export function effectiveWeightFor(videoAbsPath, weightsOverride) {
  const weights = weightsOverride || load();
  if (!videoAbsPath) return 1;
  const parts = videoAbsPath.split('/');
  let product = 1;
  for (let i = 1; i <= parts.length - 1; i++) {
    const ancestor = parts.slice(0, i + 1).join('/');
    if (Object.prototype.hasOwnProperty.call(weights, ancestor)) {
      const w = Number(weights[ancestor]);
      if (Number.isFinite(w) && w >= 0) product *= w;
    }
  }
  return product;
}

/**
 * Pick a weighted random index from a list of items.
 * @param {{ absPath: string }[]} items
 * @param {Record<string, number>} weights
 * @returns {number} index
 */
export function pickWeightedIndex(items, weights) {
  if (!items || items.length === 0) return -1;
  const ws = items.map(it => Math.max(0, effectiveWeightFor(it.absPath, weights)));
  const total = ws.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    return Math.floor(Math.random() * items.length);
  }
  let r = Math.random() * total;
  for (let i = 0; i < ws.length; i++) {
    r -= ws[i];
    if (r <= 0) return i;
  }
  return ws.length - 1;
}
