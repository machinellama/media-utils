/**
 * Split a basename into stem and extension (extension without the dot).
 */
export function splitStemExt(basename) {
  if (!basename) return { stem: '', ext: '' };
  if (basename === '.' || basename === '..') return { stem: basename, ext: '' };
  if (basename.startsWith('.') && basename.indexOf('.', 1) === -1) {
    return { stem: basename, ext: '' };
  }
  const i = basename.lastIndexOf('.');
  if (i <= 0) return { stem: basename, ext: '' };
  return { stem: basename.slice(0, i), ext: basename.slice(i + 1) };
}

/** Combine stem + optional extension field (dots optional in ext). */
export function buildRenamedFilename(stem, extField) {
  const s = stem.trim();
  const raw = extField.trim();
  if (!s) return '';
  if (!raw) return s;
  const e = raw.replace(/^\.+/, '');
  return e ? `${s}.${e}` : s;
}
