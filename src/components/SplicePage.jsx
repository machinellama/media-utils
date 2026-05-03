import React, { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

function fmt(t) {
  if (!isFinite(t)) return '—';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export default function SplicePage(props) {
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const [fileBlob, setFileBlob] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentStart, setCurrentStart] = useState(null);
  const [currentEnd, setCurrentEnd] = useState(null);
  const [ranges, setRanges] = useState([]);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(NaN);
  const [status, setStatus] = useState('');
  const [sourceUrl, setSourceUrl] = useState(null);
  const [remuxing, setRemuxing] = useState(false);
  const [rotateDeg, setRotateDeg] = useState(0);
  const [outputFilename, setOutputFilename] = useState('');
  const [deleting, setDeleting] = useState(false);

  const hidePicker = !!props.hideFilePicker;
  const drivesFromPreview = props.variant === 'panel' && props.previewVideoRef;
  const hasPanelVideoSource = drivesFromPreview && !!props.selectedVideoURL;
  /** Prefetch may fail or lag; export can load the file on demand from the same URL as the preview. */
  const canUseFileForExport = !!fileBlob || hasPanelVideoSource;

  function getVideoEl() {
    if (drivesFromPreview && props.previewVideoRef?.current) return props.previewVideoRef.current;
    return videoRef.current;
  }

  async function processFileURL(url, f) {
    try {
      setSourceUrl(url);
      if (!f) {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const file = new File([blob], props.selectedVideoName || 'name.mp4', { type: blob.type });
        f = file;
      }
      f && setFileBlob(f);
      const v = videoRef.current;
      let metadataLoaded = false;
      const onLoaded = () => {
        metadataLoaded = true;
        cleanup();
      };
      const onErr = () => {
        cleanup();
        attemptRemux();
      };
      const cleanup = () => {
        if (!v) return;
        v.removeEventListener('loadedmetadata', onLoaded);
        v.removeEventListener('error', onErr);
      };
      const attemptRemux = async () => {
        if (!f) return;
        const remuxedBlob = await remuxFileToMp4(f);
        if (remuxedBlob) {
          const remuxUrl = URL.createObjectURL(remuxedBlob);
          setSourceUrl(remuxUrl);
          const newName = (f.name || 'video').replace(/\.[^/.]+$/, '') + '.mp4';
          const newFile = new File([remuxedBlob], newName, { type: 'video/mp4' });
          setFileBlob(newFile);
        } else {
          setFileBlob(f);
        }
      };

      if (v) {
        v.pause();
        v.src = url;
        v.load();
        v.addEventListener('loadedmetadata', onLoaded, { once: true });
        v.addEventListener('error', onErr, { once: true });
        setTimeout(() => {
          if (!metadataLoaded) cleanup();
        }, 1000);
      }
    } catch (err) {
      setStatus('Failed to load file locally');
      setSourceUrl(null);
      setFileBlob(null);
    }
  }

  /** Fetch file for server export; preview player stays the only decoder when `drivesFromPreview`. */
  useEffect(() => {
    if (!props.selectedVideoURL || !drivesFromPreview) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(props.selectedVideoURL);
        const blob = await resp.blob();
        if (cancelled) return;
        const file = new File([blob], props.selectedVideoName || 'video.mp4', { type: blob.type });
        setFileBlob(file);
      } catch {
        if (!cancelled) setStatus('Failed to load file for export');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.selectedVideoURL, props.selectedVideoName, drivesFromPreview]);

  useEffect(() => {
    if (!props.selectedVideoURL || drivesFromPreview) return;

    const v = videoRef.current;
    if (!v) return;
    processFileURL(props.selectedVideoURL);
    const onTime = () => setCurrentTime(v.currentTime);
    const onLoaded = () => setDuration(v.duration || NaN);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [props.selectedVideoURL, drivesFromPreview]);

  useEffect(() => {
    if (!drivesFromPreview || !props.selectedVideoURL || !props.previewVideoRef) return;

    let cancelled = false;
    let detach;
    let rafId = 0;

    function bind(el) {
      if (!el) return undefined;
      const onTime = () => setCurrentTime(el.currentTime);
      const onDur = () => setDuration(el.duration || NaN);
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('loadedmetadata', onDur);
      setCurrentTime(el.currentTime);
      if (el.readyState >= 1) setDuration(el.duration || NaN);
      return () => {
        el.removeEventListener('timeupdate', onTime);
        el.removeEventListener('loadedmetadata', onDur);
      };
    }

    function tryAttach(attempt) {
      if (cancelled) return;
      detach = bind(props.previewVideoRef.current);
      if (!detach && attempt < 15) {
        rafId = requestAnimationFrame(() => tryAttach(attempt + 1));
      }
    }

    tryAttach(0);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      detach?.();
    };
  }, [props.selectedVideoURL, drivesFromPreview, props.previewVideoRef]);

  function resetStateOnNewFile() {
    setRanges([]);
    setCurrentStart(null);
    setCurrentEnd(null);
    setProgress(0);
    setStatus('');
    setDuration(NaN);
    setCurrentTime(0);
    setRotateDeg(0);
    setOutputFilename('');
  }

  async function remuxFileToMp4(file) {
    setRemuxing(true);
    setStatus('Remuxing for playback...');
    setProgress(0.02);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('remuxOnly', '1');
      const resp = await apiFetch('/splice?remuxOnly=1', {
        method: 'POST',
        body: form
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'server error' }));
        setStatus('Remux failed: ' + (err.error || resp.statusText));
        setProgress(0);
        setRemuxing(false);
        return null;
      }
      const reader = resp.body.getReader();
      const contentLength = resp.headers.get('Content-Length');
      let received = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) setProgress(0.02 + 0.6 * (received / Number(contentLength)));
      }
      const out = new Blob(chunks, { type: 'video/mp4' });
      setProgress(1);
      setStatus('Remux complete');
      setTimeout(() => setProgress(0), 600);
      setRemuxing(false);
      return out;
    } catch (err) {
      setStatus('Remux failed');
      setProgress(0);
      setRemuxing(false);
      return null;
    }
  }

  function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) {
      setFileBlob(null);
      setSourceUrl(null);
      resetStateOnNewFile();
      return;
    }
    resetStateOnNewFile();
    const url = URL.createObjectURL(f);
    processFileURL(url, f);
  }

  function setStart() {
    const v = getVideoEl();
    const t = v && v.currentTime;
    setCurrentStart(t);
  }
  function setEnd() {
    const v = getVideoEl();
    const t = v && v.currentTime;
    setCurrentEnd(t);
  }
  function addRange() {
    const s = Math.min(currentStart ?? 0, currentEnd ?? 0);
    const e = Math.max(currentStart ?? 0, currentEnd ?? 0);
    if (!isFinite(s) || !isFinite(e) || e - s < 0.01) return;
    setRanges(prev => [...prev, { start: s, end: e }]);
    setCurrentStart(null);
    setCurrentEnd(null);
  }
  function removeRange(i) {
    setRanges(prev => prev.filter((_, idx) => idx !== i));
  }

  async function exportRanges(opts = {}) {
    if (ranges.length === 0) return;
    let uploadFile = fileBlob;
    if (!uploadFile && hasPanelVideoSource) {
      setProgress(0.02);
      setStatus('Preparing file for export…');
      try {
        const resp = await fetch(props.selectedVideoURL);
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStatus('Failed to read video: ' + (err.error || resp.statusText));
          setProgress(0);
          return;
        }
        const blob = await resp.blob();
        uploadFile = new File(
          [blob],
          props.selectedVideoName || 'video.mp4',
          { type: blob.type || 'video/mp4' }
        );
        setFileBlob(uploadFile);
      } catch {
        setStatus('Failed to read video for export');
        setProgress(0);
        return;
      }
    }
    if (!uploadFile) return;
    setProgress(0.02);
    setStatus('Uploading file...');
    try {
      const form = new FormData();
      form.append('file', uploadFile, uploadFile.name);
      form.append('ranges', JSON.stringify(ranges));
      const rot = Number(rotateDeg) || 0;
      form.append('rotate', String(rot));
      if (outputFilename && outputFilename.trim() !== '') {
        let name = outputFilename.trim();
        if (!/\.[^/.]+$/.test(name)) name = `${name}.mp4`;
        form.append('outputFilename', name);
      }
      if (opts.saveFolder && typeof opts.saveFolder === 'string') {
        form.append('saveFolder', opts.saveFolder);
      }
      const resp = await apiFetch('/splice', {
        method: 'POST',
        body: form
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'server error' }));
        setStatus('Server error: ' + (err.error || resp.statusText));
        setProgress(0);
        return;
      }
      setStatus('Downloading result...');
      const reader = resp.body.getReader();
      const contentLength = resp.headers.get('Content-Length');
      let received = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) setProgress(0.1 + 0.8 * (received / Number(contentLength)));
      }
      const out = new Blob(chunks, { type: 'video/mp4' });
      const defaultName = (uploadFile.name || 'video').replace(/\.[^/.]+$/, '') + '_spliced.mp4';
      const downloadName =
        outputFilename && outputFilename.trim() !== ''
          ? /\.[^/.]+$/.test(outputFilename.trim())
            ? outputFilename.trim()
            : `${outputFilename.trim()}.mp4`
          : defaultName;
      downloadBlob(out, downloadName);
      setProgress(1);
      setStatus(opts.saveFolder ? `Saved to ${opts.saveFolder}` : 'Done');
      setTimeout(() => setProgress(0), 600);
      if (opts.resetAfter) {
        resetSpliceStateOnly();
      }
    } catch (err) {
      setStatus('Upload or processing failed');
      setProgress(0);
    }
  }

  function resetSpliceStateOnly() {
    setRanges([]);
    setCurrentStart(null);
    setCurrentEnd(null);
    setRotateDeg(0);
    setOutputFilename('');
  }

  async function handleExport(reset = false) {
    if (!canUseFileForExport || ranges.length === 0) return;
    let saveFolder = null;
    if (typeof props.requestSaveFolder === 'function') {
      try {
        saveFolder = await props.requestSaveFolder();
        if (saveFolder === false) return; // user cancelled
      } catch {
        return;
      }
    }
    await exportRanges({ saveFolder, resetAfter: reset });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const panel = props.variant === 'panel';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 text-sm',
        panel && 'min-h-0',
        props.className
      )}
    >
      {!hidePicker && (
        <label className="flex cursor-pointer flex-col gap-1">
          <span className="text-muted-foreground">Local file</span>
          <input ref={fileRef} type="file" accept="video/*" onChange={onFile} className="text-xs" />
        </label>
      )}
      {!drivesFromPreview && (
        <div className="overflow-hidden rounded-md border border-border bg-muted/30">
          <video
            ref={videoRef}
            controls
            crossOrigin="anonymous"
            src={sourceUrl || undefined}
            className={cn('w-full', panel ? 'max-h-[min(52vh,520px)] min-h-[140px]' : 'max-h-64')}
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <Label>Current</Label>
          <div className="font-mono">{fmt(currentTime)}</div>
        </div>
        <div>
          <Label>Start</Label>
          <div className="font-mono">{currentStart == null ? '—' : fmt(currentStart)}</div>
        </div>
        <div>
          <Label>End</Label>
          <div className="font-mono">{currentEnd == null ? '—' : fmt(currentEnd)}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={setStart} disabled={!getVideoEl()}>
          Set Start
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={setEnd} disabled={!getVideoEl()}>
          Set End
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addRange}
          disabled={currentStart == null || currentEnd == null}
        >
          Add Range
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Rotate°</Label>
          <Input
            type="number"
            min={0}
            max={360}
            className="h-8 w-20"
            value={rotateDeg}
            disabled={!canUseFileForExport}
            onChange={e => {
              let v = Number(e.target.value);
              if (!isFinite(v)) v = 0;
              v = ((v % 360) + 360) % 360;
              setRotateDeg(v);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label>Filename</Label>
          <Input
            placeholder="output name"
            value={outputFilename}
            disabled={!canUseFileForExport}
            onChange={e => setOutputFilename(e.target.value)}
            className="h-8 max-w-xs"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => handleExport(false)}
          disabled={!canUseFileForExport || ranges.length === 0 || remuxing}
        >
          Export
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleExport(true)}
          disabled={!canUseFileForExport || ranges.length === 0 || remuxing}
        >
          Export &amp; reset
        </Button>
      </div>
      <div className="rounded-md border border-border p-2">
        <div className="mb-1 text-xs font-medium">Ranges</div>
        <ul className={cn('space-y-1 overflow-auto text-xs', panel ? 'max-h-56' : 'max-h-32')}>
          {ranges.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="font-mono">
                {fmt(r.start)} → {fmt(r.end)}
              </span>
              <span className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => {
                    const el = getVideoEl();
                    if (el) {
                      el.currentTime = r.start;
                      el.play();
                    }
                  }}
                >
                  Play
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => removeRange(i)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setRanges([])} disabled={ranges.length === 0}>
          Clear ranges
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={resetSpliceStateOnly}
          disabled={!canUseFileForExport}
          title="Reset ranges, rotation and filename"
        >
          Reset
        </Button>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{status || 'Progress'}</Label>
        <progress value={progress} max={1} className="h-2 w-full" />
      </div>
    </div>
  );
}
