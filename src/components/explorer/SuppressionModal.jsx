import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getAllWeights, setWeights } from '@/lib/randomWeights';

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   folderPaths: string[],
 *   rootPath: string
 * }} props
 */
export default function SuppressionModal({ open, onClose, folderPaths, rootPath }) {
  const [draft, setDraft] = useState({});
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(getAllWeights());
      setFilter('');
    }
  }, [open]);

  const sortedFolders = useMemo(() => {
    const list = Array.from(new Set(folderPaths)).sort();
    if (!filter.trim()) return list;
    const f = filter.trim().toLowerCase();
    return list.filter(p => p.toLowerCase().includes(f));
  }, [folderPaths, filter]);

  function setFolderWeight(p, w) {
    setDraft(prev => ({ ...prev, [p]: w }));
  }

  function clearFolder(p) {
    setDraft(prev => {
      const next = { ...prev };
      delete next[p];
      return next;
    });
  }

  function save() {
    const cleaned = {};
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n >= 1) continue;
      if (n < 0) continue;
      cleaned[k] = n;
    }
    setWeights(cleaned);
    onClose();
  }

  function relPath(p) {
    if (rootPath && p.startsWith(rootPath)) {
      const rest = p.slice(rootPath.length);
      return rest === '' ? '.' : rest.replace(/^\//, '');
    }
    return p;
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Random suppression</DialogTitle>
          <DialogDescription>
            Lower a folder's weight to make its videos (and subfolder videos) appear less often.
            1.0 = full weight (default). 0 = never picked.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter folders…"
          className="font-mono text-xs"
        />
        <ScrollArea className="h-[55vh] rounded-md border border-border">
          <div className="space-y-1 p-2">
            {sortedFolders.length === 0 && (
              <div className="px-1 py-2 text-xs text-muted-foreground">No folders</div>
            )}
            {sortedFolders.map(p => {
              const w = draft[p];
              const value = w == null ? 1 : Math.max(0, Math.min(1, Number(w)));
              return (
                <div key={p} className="rounded-md border border-border px-2 py-1.5">
                  <div className="truncate font-mono text-[11px]" title={p}>
                    {relPath(p)}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={value}
                      onChange={e => setFolderWeight(p, Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="w-12 text-right font-mono text-xs tabular-nums">
                      {value.toFixed(2)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => clearFolder(p)}
                      title="Reset to 1.0"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
