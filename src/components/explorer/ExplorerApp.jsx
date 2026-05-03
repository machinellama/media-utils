import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';

const PREVIEW_WIDTH_LS = 'media_utils_preview_pane_width';
const PREVIEW_WIDTH_MIN = 260;
const PREVIEW_WIDTH_MAX = 1200;
const PREVIEW_WIDTH_DEFAULT = 380;

function readPreviewWidth() {
  try {
    const n = Number(localStorage.getItem(PREVIEW_WIDTH_LS));
    if (!Number.isFinite(n)) return PREVIEW_WIDTH_DEFAULT;
    return Math.min(PREVIEW_WIDTH_MAX, Math.max(PREVIEW_WIDTH_MIN, Math.round(n)));
  } catch {
    return PREVIEW_WIDTH_DEFAULT;
  }
}
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useExplorer, itemKey, parseKey } from '@/context/ExplorerContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  listFolder,
  searchFolder,
  listSubfolders,
  pickFolderNative,
  refreshThumbnails,
  createFolder,
  moveToSubfolder,
  deleteItems,
  renameItem,
  pasteItems,
  combineVideos,
  convertVideos,
  convertImages,
  convertAudio,
  getJob,
  fileUrl
} from '@/api/explorerClient';
import { ChevronUp, Folder, FolderOpen, FolderPlus } from 'lucide-react';
import { joinFsPath, parentFsPath, canGoUpDirectory } from '@/lib/fsPath';
import { cn } from '@/lib/utils';
import { fileKind } from '@/constants/fileTypes';
import { splitStemExt, buildRenamedFilename } from '@/lib/renameParts';
import SplicePage from '@/components/SplicePage';
import FileGrid from './FileGrid';
import PreviewPane from './PreviewPane';

async function pollJobUntilDone(jobId) {
  for (;;) {
    const j = await getJob(jobId);
    if (j.status === 'done' || j.status === 'error') return j;
    await new Promise(r => setTimeout(r, 450));
  }
}

export default function ExplorerApp() {
  const qc = useQueryClient();
  const ex = useExplorer();
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    updateTab,
    addTab,
    removeTab,
    favorites,
    toggleFavorite,
    selectedKeys,
    selectOnly,
    toggleSelect,
    selectRange,
    selectAllKeys,
    clearSelection,
    clipboard,
    copySelection,
    cutSelection,
    clearClipboard,
    preview,
    setPreview,
    setSelectedKeys
  } = ex;

  const shiftAnchorRef = useRef(null);
  /** Shared with Splice panel so splice uses preview playback position (single video element). */
  const previewVideoRef = useRef(null);
  const resizeDragRef = useRef({ active: false, startX: 0, startW: 0 });
  const [previewWidthPx, setPreviewWidthPx] = useState(readPreviewWidth);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [showSplice, setShowSplice] = useState(false);

  const [delOpen, setDelOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameStem, setRenameStem] = useState('');
  const [renameExt, setRenameExt] = useState('');
  const [renameOriginalBasename, setRenameOriginalBasename] = useState('');
  const [renameOriginalRel, setRenameOriginalRel] = useState('');
  const [combineOpen, setCombineOpen] = useState(false);
  const [combineName, setCombineName] = useState('combined.mp4');
  const [folderPickHint, setFolderPickHint] = useState('');
  const [folderPathDraft, setFolderPathDraft] = useState('');
  const [folderActionMsg, setFolderActionMsg] = useState('');
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [dropOverFolder, setDropOverFolder] = useState(null);
  const [thumbBust, setThumbBust] = useState(() => Date.now());
  const [sidebarFolderFilter, setSidebarFolderFilter] = useState('');

  const searchDebounced = useDebouncedValue(activeTab?.searchQuery ?? '', 280);
  const rootPath = activeTab?.rootPath?.trim() || '';

  useEffect(() => {
    setFolderActionMsg('');
  }, [rootPath]);

  useEffect(() => {
    setSidebarFolderFilter('');
  }, [rootPath]);

  useEffect(() => {
    setFolderPathDraft(activeTab?.rootPath ?? '');
  }, [activeTabId, activeTab?.rootPath]);

  function commitFolderPathFromDraft() {
    const trimmed = folderPathDraft.trim();
    const current = (activeTab?.rootPath ?? '').trim();
    if (trimmed !== current) {
      updateTab(activeTabId, { rootPath: trimmed });
    } else {
      setFolderPathDraft(activeTab?.rootPath ?? '');
    }
  }

  const filesQuery = useQuery({
    queryKey: ['explorer-files', rootPath, searchDebounced, activeTab?.sort, activeTab?.sortDir],
    enabled: !!rootPath,
    placeholderData: prev => prev,
    queryFn: async () => {
      const sort = activeTab.sort || 'name';
      const order = activeTab.sortDir || 'asc';
      if (searchDebounced.trim()) {
        return searchFolder({
          folder: rootPath,
          pattern: searchDebounced.trim(),
          sort,
          order
        });
      }
      return listFolder({ folder: rootPath, sort, order });
    }
  });

  const subfoldersQuery = useQuery({
    queryKey: ['explorer-subfolders', rootPath],
    enabled: !!rootPath,
    queryFn: () => listSubfolders(rootPath)
  });

  const files = filesQuery.data?.files ?? [];
  const searchTruncated = !!filesQuery.data?.truncated;
  const keysInOrder = useMemo(() => files.map(f => itemKey(rootPath, f.rel)), [files, rootPath]);

  const previewIsVideo = useMemo(() => {
    if (!preview?.rel) return false;
    const base = preview.rel.split('/').pop() || '';
    return fileKind(base) === 'video';
  }, [preview?.rel]);

  const showSplicePanel = showSplice && previewIsVideo && !fullscreenPreview;

  const invalidateRoots = useCallback(
    roots => {
      const set = new Set(roots);
      qc.invalidateQueries({
        predicate: q => {
          const k = q.queryKey[0];
          const root = q.queryKey[1];
          if (k === 'explorer-files' && set.has(root)) return true;
          if (k === 'explorer-subfolders' && set.has(root)) return true;
          return false;
        }
      });
    },
    [qc]
  );

  const handlePickFile = useCallback(
    (e, file) => {
      const k = itemKey(rootPath, file.rel);
      if (e.shiftKey) {
        const anchor = shiftAnchorRef.current || keysInOrder[0];
        selectRange(keysInOrder, anchor, k);
      } else if (e.ctrlKey || e.metaKey) {
        toggleSelect(rootPath, file.rel);
        shiftAnchorRef.current = k;
      } else {
        shiftAnchorRef.current = k;
        selectOnly(rootPath, file.rel);
        setPreview({ root: rootPath, rel: file.rel });
      }
    },
    [rootPath, keysInOrder, selectRange, toggleSelect, selectOnly, setPreview]
  );

  useEffect(() => {
    function onKey(ev) {
      if (ev.target.closest('input,textarea')) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (ev.key === 'Escape') {
        clearSelection();
        setFullscreenPreview(false);
      }
      if (ev.key === 'a' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        selectAllKeys(keysInOrder);
      }
      if (ev.key === 'Delete' && selectedKeys.length) {
        ev.preventDefault();
        setDelOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection, selectAllKeys, keysInOrder, selectedKeys.length]);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_WIDTH_LS, String(previewWidthPx));
    } catch {
      /* ignore */
    }
  }, [previewWidthPx]);

  useEffect(() => {
    function endDrag() {
      setDropOverFolder(null);
    }
    window.addEventListener('dragend', endDrag);
    return () => window.removeEventListener('dragend', endDrag);
  }, []);

  useEffect(() => {
    function onMove(e) {
      if (!resizeDragRef.current.active) return;
      const dx = e.clientX - resizeDragRef.current.startX;
      // Divider is the preview’s left edge: drag left (toward files) widens preview.
      const next = Math.round(resizeDragRef.current.startW - dx);
      setPreviewWidthPx(Math.min(PREVIEW_WIDTH_MAX, Math.max(PREVIEW_WIDTH_MIN, next)));
    }
    function onUp() {
      if (!resizeDragRef.current.active) return;
      resizeDragRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function onPreviewResizeStart(e) {
    e.preventDefault();
    resizeDragRef.current = { active: true, startX: e.clientX, startW: previewWidthPx };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  async function runDelete() {
    const items = selectedKeys.map(parseKey).filter(Boolean);
    await deleteItems(items);
    setDelOpen(false);
    clearSelection();
    invalidateRoots([...new Set(items.map(i => i.root))]);
  }

  async function runRename() {
    if (selectedKeys.length !== 1) return;
    const only = parseKey(selectedKeys[0]);
    if (!only) return;
    const newName = buildRenamedFilename(renameStem, renameExt);
    if (!newName) return;
    await renameItem(only.root, only.rel, newName);
    setRenameOpen(false);
    invalidateRoots([only.root]);
  }

  async function runPaste() {
    if (!clipboard?.items?.length || !rootPath) return;
    await pasteItems(rootPath, clipboard.mode, clipboard.items);
    const roots = [...new Set(clipboard.items.map(i => i.root)), rootPath];
    invalidateRoots(roots);
    if (clipboard.mode === 'cut') clearClipboard();
  }

  async function runCombine() {
    const vids = selectedKeys
      .map(parseKey)
      .filter(Boolean)
      .filter(it => fileKind(it.rel.split('/').pop() || '') === 'video');
    if (vids.length < 2) return;
    const folder = rootPath;
    const paths = vids.map(v => v.rel);
    const { jobId } = await combineVideos(folder, paths, combineName.trim() || 'combined.mp4');
    await pollJobUntilDone(jobId);
    setCombineOpen(false);
    invalidateRoots([folder]);
  }

  async function runConvertVideos(mode) {
    const items = selectedKeys.map(parseKey).filter(Boolean);
    const { jobId } = await convertVideos(items, mode);
    await pollJobUntilDone(jobId);
    invalidateRoots([...new Set(items.map(i => i.root))]);
  }

  async function runConvertImages(fmt, mode) {
    const items = selectedKeys.map(parseKey).filter(Boolean);
    const { jobId } = await convertImages(items, fmt, mode);
    await pollJobUntilDone(jobId);
    invalidateRoots([...new Set(items.map(i => i.root))]);
  }

  async function runConvertAudio(mode) {
    const items = selectedKeys.map(parseKey).filter(Boolean);
    const { jobId } = await convertAudio(items, mode);
    await pollJobUntilDone(jobId);
    invalidateRoots([...new Set(items.map(i => i.root))]);
  }

  const selectedParsed = selectedKeys.map(parseKey).filter(Boolean);
  const videosSel = selectedParsed.filter(i => fileKind(i.rel.split('/').pop() || '') === 'video');
  const imagesSel = selectedParsed.filter(i => fileKind(i.rel.split('/').pop() || '') === 'image');
  const audioSel = selectedParsed.filter(i => fileKind(i.rel.split('/').pop() || '') === 'audio');

  const subfolders = subfoldersQuery.data?.dirs ?? [];
  const filteredSubfolders = useMemo(() => {
    const q = sidebarFolderFilter.trim().toLowerCase();
    if (!q) return subfolders;
    return subfolders.filter(d => d.toLowerCase().includes(q));
  }, [subfolders, sidebarFolderFilter]);
  const canGoUp = canGoUpDirectory(rootPath);

  const makeExplorerDragData = useCallback(
    file => {
      if (!rootPath) return null;
      const key = itemKey(rootPath, file.rel);
      const rels = selectedKeys.includes(key)
        ? selectedKeys
            .map(parseKey)
            .filter(Boolean)
            .filter(x => x.root === rootPath)
            .map(x => x.rel)
        : [file.rel];
      if (!rels.length) return null;
      return JSON.stringify({ root: rootPath, rels });
    },
    [rootPath, selectedKeys]
  );

  const handleDropOnSubfolder = useCallback(
    async (destName, e) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOverFolder(null);
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch {
        return;
      }
      if (!data?.root || !Array.isArray(data.rels) || !data.rels.length) return;
      if (data.root !== rootPath) {
        setFolderActionMsg('Moves only work within the current folder root');
        return;
      }
      setFolderActionMsg('');
      try {
        const out = await moveToSubfolder(rootPath, destName, data.rels);
        if (out.errors?.length) {
          const msg = out.errors.map(err => `${err.rel}: ${err.error}`).join('; ');
          setFolderActionMsg(out.ok?.length ? `Some failed: ${msg}` : msg);
        } else {
          setFolderActionMsg('');
        }
        clearSelection();
        invalidateRoots([rootPath]);
      } catch (err) {
        setFolderActionMsg(err.message || 'Move failed');
      }
    },
    [rootPath, clearSelection, invalidateRoots]
  );

  async function runMkdir() {
    const n = mkdirName.trim();
    if (!n || !rootPath) return;
    setFolderActionMsg('');
    try {
      await createFolder(rootPath, n);
      setMkdirOpen(false);
      setMkdirName('');
      invalidateRoots([rootPath]);
    } catch (err) {
      setFolderActionMsg(err.message || 'Could not create folder');
    }
  }

  async function pickFolderFromOs() {
    setFolderPickHint('');
    try {
      const { path: picked } = await pickFolderNative();
      if (picked) updateTab(activeTabId, { rootPath: picked });
    } catch (e) {
      setFolderPickHint(e.message || 'Could not open folder picker');
    }
  }

  async function runRefreshThumbnails(recursive) {
    if (!rootPath) return;
    setFolderActionMsg('');
    try {
      const { removed, cacheDir } = await refreshThumbnails(rootPath, recursive);
      setThumbBust(Date.now());
      invalidateRoots([rootPath]);
      setFolderActionMsg(
        removed
          ? `Cleared ${removed} thumbnail cache file(s). Regenerating… (${cacheDir})`
          : `No cache entries removed (nothing to clear). Cache dir: ${cacheDir}`
      );
    } catch (e) {
      setFolderActionMsg(e.message || 'Could not refresh thumbnails');
    }
  }

  function goToParentFolder() {
    if (!canGoUp) return;
    updateTab(activeTabId, { rootPath: parentFsPath(rootPath) });
  }

  function openSubfolder(name) {
    if (!rootPath || !name) return;
    updateTab(activeTabId, { rootPath: joinFsPath(rootPath, name) });
  }

  const onPreviewRenamed = useCallback(
    (oldRel, newRel) => {
      setPreview(p => (p && p.rel === oldRel ? { ...p, rel: newRel } : p));
      setSelectedKeys(prev =>
        prev.map(k => {
          const o = parseKey(k);
          if (!o || o.rel !== oldRel) return k;
          return itemKey(o.root, newRel);
        })
      );
    },
    [setPreview, setSelectedKeys]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 p-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <div className="flex flex-1 flex-wrap gap-1">
          {tabs.map(t => (
            <div key={t.id} className="flex items-center gap-0">
              <Button
                size="sm"
                variant={t.id === activeTabId ? 'default' : 'ghost'}
                className="rounded-r-none text-xs"
                onClick={() => setActiveTabId(t.id)}
              >
                {t.rootPath ? t.rootPath.split('/').filter(Boolean).slice(-1)[0] || 'Tab' : 'Folder'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-l-none px-2 text-xs"
                onClick={() => removeTab(t.id)}
                disabled={tabs.length <= 1}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={addTab}>
          + Tab
        </Button>
      </div>

      <div className="flex flex-col gap-1 border-b border-border pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Input
              aria-label="Folder path"
              className="pr-10 font-mono text-xs"
              value={folderPathDraft}
              onChange={e => {
                setFolderPathDraft(e.target.value);
                setFolderPickHint('');
              }}
              onPaste={e => {
                const el = e.currentTarget;
                window.setTimeout(() => {
                  const v = el.value;
                  setFolderPathDraft(v);
                  setFolderPickHint('');
                  updateTab(activeTabId, { rootPath: v.trim() });
                }, 0);
              }}
              onBlur={commitFolderPathFromDraft}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitFolderPathFromDraft();
                  e.currentTarget.blur();
                }
              }}
              placeholder="/absolute/path/to/folder"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Choose folder with system dialog"
              title="Choose folder…"
              onClick={pickFolderFromOs}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
          <Input
            aria-label="Search by filename or glob"
            className="h-10 w-full min-w-[180px] font-mono text-sm sm:w-72"
            value={activeTab?.searchQuery ?? ''}
            onChange={e => updateTab(activeTabId, { searchQuery: e.target.value })}
            placeholder="*.png or vacation"
          />
        <select
          aria-label="Sort files"
          className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-xs"
          value={`${activeTab?.sort || 'name'}:${activeTab?.sortDir || 'asc'}`}
          onChange={e => {
            const [sort, sortDir] = e.target.value.split(':');
            updateTab(activeTabId, { sort, sortDir });
          }}
        >
          <option value="name:asc">Name ↑</option>
          <option value="name:desc">Name ↓</option>
          <option value="mtime:desc">Modified ↓</option>
          <option value="mtime:asc">Modified ↑</option>
          <option value="birthtime:desc">Created ↓</option>
          <option value="birthtime:asc">Created ↑</option>
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-9 shrink-0 text-xs" disabled={!rootPath}>
              Refresh thumbnails
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => runRefreshThumbnails(false)}>
              This folder only
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runRefreshThumbnails(true)}>
              This folder + subfolders
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
        {folderPickHint && <p className="text-xs text-amber-600 dark:text-amber-400">{folderPickHint}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-0">
        <aside className="flex w-full min-h-[14rem] flex-1 flex-col gap-2 border-border min-h-0 lg:h-full lg:min-h-0 lg:w-[260px] lg:flex-none lg:border-r lg:pr-2">
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Folders</div>
              <Input
                aria-label="Filter subfolders"
                className="h-8 min-w-[80px] flex-1 font-mono text-xs"
                value={sidebarFolderFilter}
                onChange={e => setSidebarFolderFilter(e.target.value)}
                placeholder="Filter…"
                disabled={!rootPath}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 gap-1 px-2 text-xs"
                disabled={!rootPath}
                title="New folder here"
                onClick={() => {
                  setFolderActionMsg('');
                  setMkdirName('');
                  setMkdirOpen(true);
                }}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
            <div className="flex min-h-0 shrink-0 items-center gap-1 rounded-md border border-border bg-muted/30 px-1 py-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                disabled={!canGoUp}
                onClick={goToParentFolder}
                aria-label="Parent folder"
                title="Parent folder"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <div
                className="min-w-0 flex-1 truncate font-mono text-[10px] leading-tight text-muted-foreground"
                title={rootPath || undefined}
              >
                {rootPath || 'Set a folder path'}
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
              <div
                className="space-y-0.5 p-2"
                onDragOver={e => {
                  if (rootPath) e.preventDefault();
                }}
              >
                {!rootPath && (
                  <div className="text-xs text-muted-foreground">Enter or pick a folder to browse subfolders.</div>
                )}
                {rootPath && subfoldersQuery.isFetching && (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                )}
                {rootPath && subfoldersQuery.isError && (
                  <div className="text-xs text-destructive">Could not list folders</div>
                )}
                {rootPath &&
                  !subfoldersQuery.isFetching &&
                  subfolders.length === 0 &&
                  !subfoldersQuery.isError && (
                    <div className="text-xs text-muted-foreground">No subfolders</div>
                  )}
                {rootPath &&
                  !subfoldersQuery.isFetching &&
                  subfolders.length > 0 &&
                  filteredSubfolders.length === 0 &&
                  !subfoldersQuery.isError && (
                    <div className="text-xs text-muted-foreground">No folders match filter</div>
                  )}
                {filteredSubfolders.map(d => (
                  <div
                    key={d}
                    className={cn(
                      'rounded-md transition-colors',
                      dropOverFolder === d && 'bg-primary/15 ring-1 ring-primary'
                    )}
                    onDragOver={e => {
                      if (!rootPath) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      setDropOverFolder(d);
                    }}
                    onDragLeave={e => {
                      if (!e.currentTarget.contains(e.relatedTarget)) setDropOverFolder(null);
                    }}
                    onDrop={e => handleDropOnSubfolder(d, e)}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
                      onClick={() => openSubfolder(d)}
                      title="Open folder — or drop selected files here to move"
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{d}</span>
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
            {folderActionMsg && (
              <p className="shrink-0 text-xs text-amber-600 dark:text-amber-400">{folderActionMsg}</p>
            )}
          </div>
          <Separator className="shrink-0" />
          <div className="shrink-0 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Favorites</div>
            <ScrollArea className="h-40 rounded-md border border-border">
              <div className="space-y-1 p-2">
                {favorites.length === 0 && <div className="text-xs text-muted-foreground">None yet</div>}
                {favorites.map(fav => (
                  <button
                    key={fav}
                    type="button"
                    className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    onClick={() => updateTab(activeTabId, { rootPath: fav })}
                  >
                    {fav}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <Button
              size="sm"
              variant="secondary"
              disabled={!rootPath}
              onClick={() => toggleFavorite(rootPath)}
            >
              {favorites.includes(rootPath) ? 'Remove favorite' : 'Favorite current folder'}
            </Button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row overflow-hidden overflow-y-auto">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overflow-y-auto rounded-md border border-border bg-muted/20">
            {filesQuery.isFetching && <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>}
            {searchTruncated && (
              <div className="px-2 py-1 text-xs text-amber-300">Results truncated (max 5000)</div>
            )}
            <FileGrid
              rootPath={rootPath}
              files={files}
              selectedKeys={selectedKeys}
              preview={preview}
              onPickFile={handlePickFile}
              searchMode={!!searchDebounced.trim()}
              makeExplorerDragData={makeExplorerDragData}
              thumbBust={thumbBust}
            />
          </main>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize preview panel"
            className="mx-0 hidden w-1.5 shrink-0 cursor-col-resize rounded-full bg-border transition-colors hover:bg-primary/40 active:bg-primary/60 lg:block"
            onMouseDown={onPreviewResizeStart}
          />

          <div
            className="flex min-h-[220px] w-full min-w-0 shrink-0 flex-col border-t border-border lg:min-h-0 lg:w-[var(--explorer-preview-w)] lg:border-l lg:border-t-0"
            style={{ '--explorer-preview-w': `${previewWidthPx}px` }}
          >
            <PreviewPane
              folder={preview?.root}
              rel={preview?.rel}
              previewVideoRef={previewVideoRef}
              onInvalidate={() => invalidateRoots([rootPath])}
              onRenamed={onPreviewRenamed}
              fullscreen={fullscreenPreview}
              onFullscreenChange={setFullscreenPreview}
              showSplice={showSplice}
              onShowSpliceChange={setShowSplice}
            />
          </div>

          {showSplicePanel && preview && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Between preview and splice"
                className="mx-0 hidden w-1.5 shrink-0 rounded-full bg-border lg:block"
              />
              <aside className="flex min-h-[260px] w-full min-w-0 flex-col border-t border-border lg:min-h-0 lg:w-[420px] lg:min-w-[300px] lg:shrink-0 lg:border-l lg:border-t-0">
                <div className="shrink-0 border-b border-border px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Splice
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-2">
                  <SplicePage
                    variant="panel"
                    hideFilePicker
                    previewVideoRef={previewVideoRef}
                    selectedVideoURL={fileUrl(preview.root, preview.rel)}
                    selectedVideoName={preview.rel}
                    selectedRootPath={preview.root}
                  />
                </div>
              </aside>
            </>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <div className="text-xs text-muted-foreground">{selectedKeys.length} selected</div>
        <Separator orientation="vertical" className="h-6" />
        <Button size="sm" variant="outline" onClick={clearSelection}>
          Clear selection
        </Button>
        <Button size="sm" variant="secondary" onClick={copySelection} disabled={!selectedKeys.length}>
          Copy
        </Button>
        <Button size="sm" variant="secondary" onClick={cutSelection} disabled={!selectedKeys.length}>
          Cut
        </Button>
        <Button size="sm" variant="secondary" onClick={runPaste} disabled={!clipboard?.items?.length || !rootPath}>
          Paste here
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDelOpen(true)} disabled={!selectedKeys.length}>
          Delete
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (selectedKeys.length !== 1) return;
            const o = parseKey(selectedKeys[0]);
            if (!o) return;
            const base = o.rel.split('/').pop() || '';
            const { stem, ext } = splitStemExt(base);
            setRenameOriginalBasename(base);
            setRenameOriginalRel(o.rel);
            setRenameStem(stem);
            setRenameExt(ext);
            setRenameOpen(true);
          }}
          disabled={selectedKeys.length !== 1}
        >
          Rename…
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCombineOpen(true)} disabled={videosSel.length < 2}>
          Combine videos…
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!videosSel.length}>
              Convert video → MP4
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => runConvertVideos('missing_target')}>
              Only non-MP4 files
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runConvertVideos('all')}>
              All selected (re-encode)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!imagesSel.length}>
              Convert images
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => runConvertImages('png', 'missing_target')}>
              To PNG — only if not PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runConvertImages('png', 'all')}>
              To PNG — all selected (re-encode)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runConvertImages('webp', 'missing_target')}>
              To WebP — only if not WebP
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runConvertImages('webp', 'all')}>
              To WebP — all selected (re-encode)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!audioSel.length}>
              Convert audio → MP3
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => runConvertAudio('missing_target')}>
              Only non-MP3 files
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runConvertAudio('all')}>
              All selected (re-encode)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedKeys.length} file(s)?</DialogTitle>
            <DialogDescription>This uses the system trash when available.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={runDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-normal text-muted-foreground">Current name</Label>
              <div className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
                {renameOriginalBasename || '—'}
              </div>
              {renameOriginalRel.includes('/') && (
                <p className="text-xs text-muted-foreground">
                  Relative path:{' '}
                  <span className="font-mono text-foreground/80">{renameOriginalRel}</span>
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-normal text-muted-foreground">New name</Label>
              <div className="flex gap-2">
                <Input
                  aria-label="New filename without extension"
                  value={renameStem}
                  onChange={e => setRenameStem(e.target.value)}
                  className="min-w-0 flex-1 font-mono text-sm"
                  placeholder="filename"
                />
                <div className="flex min-w-0 max-w-[10rem] shrink-0 items-center gap-0.5">
                  <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
                    .
                  </span>
                  <Input
                    aria-label="File extension"
                    value={renameExt}
                    onChange={e => setRenameExt(e.target.value)}
                    className="min-w-0 flex-1 font-mono text-sm"
                    placeholder={renameExt ? undefined : 'ext'}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Extension is optional; it defaults to the current file. Leave it empty for no extension.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runRename} disabled={!buildRenamedFilename(renameStem, renameExt)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Creates a folder inside the current path: {rootPath || '—'}</DialogDescription>
          </DialogHeader>
          <Label className="text-xs text-muted-foreground">Folder name</Label>
          <Input
            value={mkdirName}
            onChange={e => setMkdirName(e.target.value)}
            className="font-mono text-sm"
            placeholder="My folder"
            onKeyDown={e => {
              if (e.key === 'Enter') runMkdir();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMkdirOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runMkdir} disabled={!mkdirName.trim() || !rootPath}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={combineOpen} onOpenChange={setCombineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Combine {videosSel.length} videos</DialogTitle>
            <DialogDescription>Output file will be created in the current folder tab.</DialogDescription>
          </DialogHeader>
          <Label>Output filename</Label>
          <Input value={combineName} onChange={e => setCombineName(e.target.value)} className="font-mono text-sm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCombineOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runCombine}>Start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
