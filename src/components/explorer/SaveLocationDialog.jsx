import React, { useEffect, useState } from 'react';
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
import { pickFolderNative } from '@/api/explorerClient';

const sessionLastFolder = { value: '' };

export function getSessionSaveFolder() {
  return sessionLastFolder.value;
}
export function setSessionSaveFolder(v) {
  sessionLastFolder.value = v || '';
}

/**
 * Modal that resolves to either:
 *   - null  → caller should use its default location
 *   - string (absolute folder path)
 *   - false → user cancelled (caller should abort)
 */
export default function SaveLocationDialog({
  open,
  onResolve,
  defaultLabel = 'Default location'
}) {
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(sessionLastFolder.value || '');
      setHint('');
    }
  }, [open]);

  function close(result) {
    if (typeof onResolve === 'function') onResolve(result);
  }

  async function pickNative() {
    setHint('');
    try {
      const { path } = await pickFolderNative();
      if (path) {
        setDraft(path);
        sessionLastFolder.value = path;
      }
    } catch (e) {
      setHint(e.message || 'Could not open folder picker');
    }
  }

  function useDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      close(null);
      return;
    }
    sessionLastFolder.value = trimmed;
    close(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save location</DialogTitle>
          <DialogDescription>
            Pick a folder to save the output, or use the default location.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="/absolute/path/to/folder"
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={pickNative}>
              Pick folder…
            </Button>
            {sessionLastFolder.value && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDraft(sessionLastFolder.value)}
                title="Use last picked folder this session"
              >
                Last: {sessionLastFolder.value}
              </Button>
            )}
          </div>
          {hint && <p className="text-xs text-amber-600 dark:text-amber-400">{hint}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => close(null)}>
            {defaultLabel}
          </Button>
          <Button onClick={useDraft} disabled={!draft.trim()}>
            Save here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
