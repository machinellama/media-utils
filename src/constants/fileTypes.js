import extensions from './extensions.json';

export const VIDEO_EXTS = extensions.VIDEO_EXTS;
export const IMAGE_EXTS = extensions.IMAGE_EXTS;
export const PDF_EXTS = extensions.PDF_EXTS;
export const TEXT_EXTS = extensions.TEXT_EXTS;
export const AUDIO_EXTS = extensions.AUDIO_EXTS;

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

/** @param {string} name */
export function fileKind(name) {
  const ext = extOf(name);
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (PDF_EXTS.includes(ext)) return 'pdf';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return 'other';
}

export function isExplorerFile(name) {
  return fileKind(name) !== 'other';
}
