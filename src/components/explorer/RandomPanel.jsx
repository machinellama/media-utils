import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { searchFolder } from '@/api/explorerClient';
import { fileKind } from '@/constants/fileTypes';
import { useExplorer } from '@/context/ExplorerContext';
import { X, Shuffle } from 'lucide-react';
import { getAllWeights, pickWeightedIndex, subscribeWeights } from '@/lib/randomWeights';
import { joinFsPath } from '@/lib/fsPath';
import { cn } from '@/lib/utils';
import SuppressionModal from './SuppressionModal';

export default function RandomPanel({ rootPath, previewVideoRef, onClose }) {
  const { preview, setPreview } = useExplorer();
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [listShuffleKey, setListShuffleKey] = useState(0);
  const [suppressionOpen, setSuppressionOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [, weightsTick] = useWeightsSubscription();

  const poolQuery = useQuery({
    queryKey: ['random-pool', rootPath],
    enabled: !!rootPath,
    queryFn: () => searchFolder({ folder: rootPath, pattern: '', sort: 'name', order: 'asc' })
  });

  const allVideos = useMemo(() => {
    const files = poolQuery.data?.files ?? [];
    return files
      .filter(f => fileKind(f.name) === 'video')
      .map(f => {
        const absPath = joinFsPath(rootPath, f.rel);
        const dir = absPath.split('/').slice(0, -1).join('/');
        return { ...f, absPath, absDir: dir };
      });
  }, [poolQuery.data, rootPath]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allVideos;
    return allVideos.filter(v => v.rel.toLowerCase().includes(q));
  }, [allVideos, filter]);

  useEffect(() => {
    setListShuffleKey(0);
  }, [rootPath, filter, poolQuery.dataUpdatedAt]);

  const displayList = useMemo(() => {
    const arr = [...filtered];
    if (listShuffleKey === 0 || arr.length < 2) return arr;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }, [filtered, listShuffleKey]);

  const folderPaths = useMemo(() => {
    const set = new Set();
    for (const v of allVideos) {
      let dir = v.absDir;
      while (dir && dir.length >= rootPath.length) {
        set.add(dir);
        const next = dir.split('/').slice(0, -1).join('/');
        if (next === dir) break;
        dir = next;
      }
    }
    return Array.from(set);
  }, [allVideos, rootPath]);

  const pickRandom = useCallback(() => {
    if (!filtered.length) return null;
    const weights = getAllWeights();
    const idx = pickWeightedIndex(filtered, weights);
    if (idx < 0) return null;
    return filtered[idx];
  }, [filtered, weightsTick]);

  const bumpRandomPreview = useCallback(
    rel => setPreview({ root: rootPath, rel, randomPlayNonce: Date.now() }),
    [rootPath, setPreview]
  );

  function playRandom() {
    const item = pickRandom();
    if (!item) return;
    setShuffleSeed(s => s + 1);
    bumpRandomPreview(item.rel);
  }

  // Auto-advance: when preview video ends, pick next from the current randomized list (displayList),
  // not another fresh random selection. Re-attach when preview file changes: PreviewPane uses key={src}
  // on <video>, so each new file is a new DOM node — the old `ended` listener would not run on the new element.
  useEffect(() => {
    if (!autoAdvance) return;
    let cancelled = false;
    let detach = () => {};
    const tryAttach = (attempt = 0) => {
      if (cancelled) return;
      const el = previewVideoRef?.current;
      if (!el) {
        if (attempt < 60) requestAnimationFrame(() => tryAttach(attempt + 1));
        return;
      }
      const onEnded = () => {
        if (!displayList.length) return;
        const currentRel = preview?.root === rootPath ? preview?.rel : null;
        // Find current index in the display list and advance to the next item.
        const idx = currentRel ? displayList.findIndex(v => v.rel === currentRel) : -1;
        const next =
          idx >= 0 && idx < displayList.length - 1 ? displayList[idx + 1] : displayList[0];
        if (next) bumpRandomPreview(next.rel);
      };
      detach();
      el.addEventListener('ended', onEnded);
      detach = () => el.removeEventListener('ended', onEnded);
    };
    tryAttach();
    return () => {
      cancelled = true;
      detach();
    };
  }, [
    autoAdvance,
    previewVideoRef,
    bumpRandomPreview,
    preview?.root,
    preview?.rel,
    preview?.randomPlayNonce,
    displayList,
    rootPath
  ]);

  const currentRel = preview?.root === rootPath ? preview?.rel : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Shuffle className="h-3.5 w-3.5" />
          Random
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onClose}
          aria-label="Close random panel"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" onClick={playRandom} disabled={!filtered.length}>
            Play random
          </Button>
          <Button
            type="button"
            size="sm"
            variant={autoAdvance ? 'default' : 'outline'}
            onClick={() => setAutoAdvance(v => !v)}
          >
            Auto-advance: {autoAdvance ? 'on' : 'off'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSuppressionOpen(true)}
          >
            Suppress folders…
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={filtered.length < 2}
            onClick={() => setListShuffleKey(k => k + 1)}
            title="Randomize list order"
            aria-label="Shuffle list order"
          >
            <Shuffle className="mr-1 h-3.5 w-3.5" />
            Shuffle list
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {poolQuery.isFetching
            ? 'Scanning…'
            : `${filtered.length} video(s)${filter.trim() ? ` of ${allVideos.length}` : ''}`}
        </div>
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter…"
          className="h-7 font-mono text-xs"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {displayList.map(v => (
            <button
              type="button"
              key={v.rel}
              className={cn(
                'block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-muted',
                currentRel === v.rel && 'bg-muted ring-1 ring-primary'
              )}
              title={v.rel}
              onClick={() => setPreview({ root: rootPath, rel: v.rel })}
            >
              {v.rel}
            </button>
          ))}
          {!filtered.length && !poolQuery.isFetching && (
            <div className="px-2 py-2 text-xs text-muted-foreground">No videos in this folder.</div>
          )}
        </div>
      </ScrollArea>
      <SuppressionModal
        open={suppressionOpen}
        onClose={() => setSuppressionOpen(false)}
        folderPaths={folderPaths}
        rootPath={rootPath}
      />
    </div>
  );
}

function useWeightsSubscription() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeWeights(() => setTick(t => t + 1)), []);
  return [tick, tick];
}
