import { apiFetch } from '@/lib/api';

export async function listFolder(body) {
  const r = await apiFetch('/explorer/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'list failed');
  return r.json();
}

export async function searchFolder(body) {
  const r = await apiFetch('/explorer/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('search failed');
  return r.json();
}

export async function listSubfolders(folder) {
  const r = await apiFetch('/explorer/list-subfolders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder })
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'subfolders failed');
  return r.json();
}

/** Opens native folder picker via local server (zenity / macOS / Windows). */
/** @returns {Promise<{ path: string | null }>} `path` is null when the dialog was canceled or nothing was chosen */
export async function pickFolderNative() {
  const r = await apiFetch('/explorer/pick-folder', { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'pick folder failed');
  return j;
}

/** @param {string|number} [cacheBust] appended as `t` so the browser refetches after cache clear */
export function thumbnailUrl(folder, rel, mtimeMs, cacheBust) {
  const q = new URLSearchParams({ folder, rel });
  if (mtimeMs != null) q.set('mtime', String(mtimeMs));
  if (cacheBust != null && cacheBust !== '') q.set('t', String(cacheBust));
  return `/explorer/thumbnail?${q.toString()}`;
}

/** Remove disk thumbnails for files in `folder` so they regenerate on next view. */
export async function refreshThumbnails(folder, recursive = false) {
  const r = await apiFetch('/explorer/clear-thumbnails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, recursive })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'clear thumbnails failed');
  return j;
}

export function fileUrl(folder, rel) {
  const q = new URLSearchParams({ folder, rel });
  return `/explorer/file?${q.toString()}`;
}

export async function deleteItems(items) {
  const r = await apiFetch('/explorer/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });
  if (!r.ok) throw new Error('delete failed');
  return r.json();
}

export async function renameItem(root, rel, newName) {
  const r = await apiFetch('/explorer/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, rel, newName })
  });
  if (!r.ok) throw new Error('rename failed');
  return r.json();
}

export async function createFolder(root, name) {
  const r = await apiFetch('/explorer/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, name })
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 409) throw new Error(j.error || 'Folder already exists');
  if (!r.ok) throw new Error(j.error || 'Could not create folder');
  return j;
}

/** Move files into a subdirectory of `root` (destRelDir is path segments under root, e.g. "Photos"). */
export async function moveToSubfolder(root, destRelDir, rels) {
  const r = await apiFetch('/explorer/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      root,
      destRelDir,
      items: rels.map(rel => ({ rel }))
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Move failed');
  return j;
}

export async function pasteItems(destRoot, mode, items) {
  const r = await apiFetch('/explorer/paste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destRoot, mode, items })
  });
  if (!r.ok) throw new Error('paste failed');
  return r.json();
}

export async function combineVideos(folder, paths, outputName, destFolder = null) {
  const r = await apiFetch('/explorer/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, paths, outputName, destFolder })
  });
  if (r.status !== 202) throw new Error('combine failed');
  return r.json();
}

export async function getJob(jobId) {
  const r = await apiFetch(`/explorer/jobs/${jobId}`);
  if (!r.ok) throw new Error('job');
  return r.json();
}

/** @param {'missing_target' | 'all'} mode */
export async function convertVideos(items, mode = 'missing_target') {
  const r = await apiFetch('/explorer/convert-videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, mode })
  });
  if (r.status !== 202) throw new Error('convert');
  return r.json();
}

/** @param {'missing_target' | 'all'} mode */
export async function convertImages(items, format, mode = 'missing_target') {
  const r = await apiFetch('/explorer/convert-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, format, mode })
  });
  if (r.status !== 202) throw new Error('convert');
  return r.json();
}

/** @param {'missing_target' | 'all'} mode */
export async function convertAudio(items, mode = 'missing_target') {
  const r = await apiFetch('/explorer/convert-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, mode })
  });
  if (r.status !== 202) throw new Error('convert');
  return r.json();
}

export async function cropImage(body) {
  const r = await apiFetch('/explorer/crop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'crop failed');
  return r.json();
}

/** Save a PNG into the user’s Downloads folder (server-side path). */
export async function savePngToDownloads(blob, basename) {
  const fd = new FormData();
  fd.append('image', blob, 'frame.png');
  if (basename) fd.append('basename', basename);
  const r = await apiFetch('/explorer/save-download-png', { method: 'POST', body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'save failed');
  return r.json();
}

export async function remuxVideo(folder, rel) {
  const r = await apiFetch('/explorer/remux-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, rel })
  });
  if (r.status !== 202) throw new Error('remux');
  return r.json();
}

export async function fetchTextPreview(folder, rel) {
  const q = new URLSearchParams({ folder, rel });
  const r = await apiFetch(`/explorer/text-preview?${q.toString()}`);
  if (!r.ok) throw new Error('text');
  return r.json();
}

/** Build a URL to fetch a sibling subtitle file (.srt or .vtt). */
export function subtitleUrl(folder, rel) {
  const q = new URLSearchParams({ folder, rel });
  return `/explorer/subtitle?${q.toString()}`;
}

export async function moveItemsToAbsoluteFolder(srcRoot, destFolder, rels) {
  const r = await apiFetch('/explorer/move-to-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      root: srcRoot,
      destFolder,
      items: rels.map(rel => ({ rel }))
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Move failed');
  return j;
}
