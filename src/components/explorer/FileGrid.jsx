import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { thumbnailUrl } from '@/api/explorerClient';
import { itemKey } from '@/context/ExplorerContext';
import { fileKind } from '@/constants/fileTypes';
import { cn } from '@/lib/utils';
import { getWatchProgress, subscribeWatchProgress } from '@/lib/videoWatchProgress';

const COLS = 4;
const ROW_H = 320;

function formatSize(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
  return `${(size / 1024 ** 2).toFixed(2)} MB`;
}

export default function FileGrid({
  rootPath,
  files,
  selectedKeys,
  preview,
  onPickFile,
  searchMode,
  makeExplorerDragData,
  thumbBust,
  scrollToRel,
  onScrolledToRel
}) {
  const parentRef = useRef(null);
  const tilesContainerRef = useRef(null);
  const rowCount = Math.ceil(files.length / COLS) || 0;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 6
  });

  useEffect(() => {
    if (!scrollToRel) return;
    const idx = files.findIndex(f => f.rel === scrollToRel);
    if (idx < 0) {
      onScrolledToRel?.();
      return;
    }
    const tryScroll = (attempt = 0) => {
      const rowIndex = Math.floor(idx / COLS);
      if (parentRef.current && files.length >= 120) {
        virtualizer.scrollToIndex(rowIndex, { align: 'center' });
      }
      requestAnimationFrame(() => {
        const root = tilesContainerRef.current || parentRef.current;
        const el = root?.querySelector(`[data-rel="${CSS.escape(scrollToRel)}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          onScrolledToRel?.();
        } else if (attempt < 6) {
          setTimeout(() => tryScroll(attempt + 1), 60);
        } else {
          onScrolledToRel?.();
        }
      });
    };
    tryScroll();
  }, [scrollToRel, files, virtualizer, onScrolledToRel]);

  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        No matching files. Enter a folder path or adjust search.
      </div>
    );
  }

  const renderTile = f => (
    <FileTile
      key={f.rel}
      file={f}
      rootPath={rootPath}
      selected={selectedKeys.includes(itemKey(rootPath, f.rel))}
      previewActive={preview && preview.root === rootPath && preview.rel === f.rel}
      searchMode={searchMode}
      onPick={onPickFile}
      makeExplorerDragData={makeExplorerDragData}
      thumbBust={thumbBust}
    />
  );

  if (files.length < 120) {
    return (
      <div ref={tilesContainerRef} className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-4">
        {files.map(f => renderTile(f))}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full min-h-[200px] overflow-auto px-2 pt-2 pb-8">
      <div ref={tilesContainerRef} className="relative" style={{ height: `${virtualizer.getTotalSize() + 100}px` }}>
        {virtualizer.getVirtualItems().map(vRow => {
          const rowIndex = vRow.index;
          const start = rowIndex * COLS;
          const rowFiles = files.slice(start, start + COLS);
          return (
            <div
              key={vRow.key}
              className="absolute left-0 top-0 grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
              style={{
                transform: `translateY(${vRow.start}px)`,
                height: 'fit-content'
              }}
            >
              {rowFiles.map(f => renderTile(f))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileTile({ file, rootPath, selected, previewActive, searchMode, onPick, makeExplorerDragData, thumbBust }) {
  const thumb = thumbnailUrl(rootPath, file.rel, file.mtimeMs, thumbBust);
  const videoKey =
    fileKind(file.name) === 'video' ? itemKey(rootPath, file.rel) : null;
  const [, setWatchTick] = useState(0);
  useEffect(() => {
    if (!videoKey) return undefined;
    return subscribeWatchProgress(() => setWatchTick(n => n + 1));
  }, [videoKey]);

  const watchProg = videoKey ? getWatchProgress(videoKey) : null;
  const watchPct =
    watchProg?.dur != null && watchProg.dur > 0
      ? Math.min(100, Math.max(0, (watchProg.t / watchProg.dur) * 100))
      : null;

  const sub =
    searchMode && file.subpath ? (
      <div className="truncate text-[10px] text-muted-foreground" title={file.subpath}>
        {file.subpath}
      </div>
    ) : null;

  const sizeText = formatSize(file.size);

  const canDrag = Boolean(makeExplorerDragData && rootPath);

  return (
    <div
      data-rel={file.rel}
      className={cn(
        'overflow-hidden rounded-md border border-border bg-card text-left text-xs transition-colors hover:bg-accent/40',
        selected && 'ring-2 ring-primary',
        previewActive && 'border-primary',
        canDrag && 'cursor-grab active:cursor-grabbing'
      )}
      draggable={canDrag}
      onDragStart={e => {
        if (!makeExplorerDragData || !rootPath) return;
        const payload = makeExplorerDragData(file);
        if (!payload) return;
        e.dataTransfer.setData('application/json', payload);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button type="button" className="flex w-full flex-col text-left" onClick={e => onPick(e, file)}>
        <div className="relative aspect-video w-full bg-muted">
          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
          {watchPct != null && (
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-[3px] bg-foreground/15"
              title={`Watched about ${Math.round(watchPct)}%`}
            >
              <div className="h-full bg-primary/85" style={{ width: `${watchPct}%` }} />
            </div>
          )}
        </div>
        <div className="break-words px-1 py-0.5 text-xs font-medium leading-tight" title={file.name}>
          {file.name}
        </div>
        {sizeText && (
          <div className="px-1 pb-0.5 text-[10px] text-muted-foreground">{sizeText}</div>
        )}
        {sub}
      </button>
    </div>
  );
}
