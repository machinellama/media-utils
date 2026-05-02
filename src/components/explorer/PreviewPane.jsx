import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  fileUrl,
  fetchTextPreview,
  cropImage,
  remuxVideo,
  getJob,
  savePngToDownloads,
  renameItem
} from '@/api/explorerClient';
import { fileKind } from '@/constants/fileTypes';
import { splitStemExt, buildRenamedFilename } from '@/lib/renameParts';
import { itemKey } from '@/context/ExplorerContext';
import {
  getWatchProgress,
  recordWatchProgress
} from '@/lib/videoWatchProgress';
async function pollJob(jobId) {
  for (;;) {
    const j = await getJob(jobId);
    if (j.status === 'done' || j.status === 'error') return j;
    await new Promise(r => setTimeout(r, 450));
  }
}

function stemForDownloads(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return name || 'frame';
  return name.slice(0, i);
}

export default function PreviewPane({
  folder,
  rel,
  previewVideoRef,
  onInvalidate,
  onRenamed,
  fullscreen,
  onFullscreenChange,
  showSplice,
  onShowSpliceChange
}) {
  const [textContent, setTextContent] = useState('');
  const [textTrunc, setTextTrunc] = useState(false);
  const [imageCropOpen, setImageCropOpen] = useState(false);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const imgRef = useRef(null);
  const videoRef = useRef(null);
  function setVideoElement(el) {
    videoRef.current = el;
    if (previewVideoRef) previewVideoRef.current = el;
  }
  const videoSnapImgRef = useRef(null);
  /** so we can resume play after region screenshot flow */
  const videoWasPausedBeforeRegionRef = useRef(true);
  const [status, setStatus] = useState('');

  const [videoSnapUrl, setVideoSnapUrl] = useState(null);
  const [videoFrameCrop, setVideoFrameCrop] = useState();
  const [videoFrameCompleted, setVideoFrameCompleted] = useState(null);

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleStem, setTitleStem] = useState('');
  const titleInputRef = useRef(null);

  const closeVideoRegion = useCallback(() => {
    setVideoSnapUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setVideoFrameCrop(undefined);
    setVideoFrameCompleted(null);
    queueMicrotask(() => {
      const el = videoRef.current;
      if (!el) return;
      if (!videoWasPausedBeforeRegionRef.current) el.play().catch(() => {});
    });
  }, []);

  useEffect(() => {
    setTextContent('');
    setImageCropOpen(false);
    setCrop(undefined);
    setCompletedCrop(null);
    setStatus('');
    setVideoSnapUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setVideoFrameCrop(undefined);
    setVideoFrameCompleted(null);
    setTitleEditing(false);
    setTitleStem('');
  }, [folder, rel]);

  useEffect(() => {
    if (!folder || !rel) return;
    const k = fileKind(rel.split('/').pop() || '');
    if (k !== 'text') return;
    fetchTextPreview(folder, rel)
      .then(d => {
        setTextContent(d.text || '');
        setTextTrunc(!!d.truncated);
      })
      .catch(() => setTextContent('Failed to load text'));
  }, [folder, rel]);

  useEffect(() => {
    if (titleEditing && titleInputRef.current) titleInputRef.current.focus();
  }, [titleEditing]);

  const previewName = folder && rel ? rel.split('/').pop() || rel : '';
  const previewKind = previewName ? fileKind(previewName) : 'other';
  const src = folder && rel ? fileUrl(folder, rel) : '';

  useEffect(() => {
    if (!folder || !rel || previewKind !== 'video') return;

    const watchKey = itemKey(folder, rel);
    let cleaned = false;
    let intervalId = 0;
    let raf = 0;
    let didResume = false;

    function cleanupListeners(el) {
      el.removeEventListener('loadedmetadata', onLoadedMeta);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    }

    function onPause() {
      const el = videoRef.current;
      if (!el || cleaned) return;
      recordWatchProgress(watchKey, el.currentTime, el.duration, true);
    }

    function onEnded() {
      const el = videoRef.current;
      if (!el || cleaned) return;
      recordWatchProgress(watchKey, el.duration, el.duration, true);
    }

    function onLoadedMeta() {
      const el = videoRef.current;
      if (!el || cleaned || didResume) return;
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      didResume = true;
      const saved = getWatchProgress(watchKey);
      if (!saved || saved.t < 0.25) return;
      const ratio = saved.t / dur;
      if (ratio >= 0.97) {
        el.currentTime = 0;
        recordWatchProgress(watchKey, 0, dur, true);
        return;
      }
      el.currentTime = Math.min(saved.t, dur - 0.25);
    }

    function arm(el) {
      if (!el || cleaned) return;
      cleanupListeners(el);
      didResume = false;
      el.addEventListener('loadedmetadata', onLoadedMeta);
      el.addEventListener('pause', onPause);
      el.addEventListener('ended', onEnded);
      intervalId = window.setInterval(() => {
        const v = videoRef.current;
        if (!v || cleaned || v.paused || v.ended) return;
        recordWatchProgress(watchKey, v.currentTime, v.duration, false);
      }, 15000);
      if (el.readyState >= 1 && Number.isFinite(el.duration) && el.duration > 0) {
        onLoadedMeta();
      }
    }

    function tryAttach(attempts) {
      const el = videoRef.current;
      if (el) {
        arm(el);
        return;
      }
      if (cleaned || attempts > 40) return;
      raf = requestAnimationFrame(() => tryAttach(attempts + 1));
    }

    tryAttach(0);

    return () => {
      cleaned = true;
      cancelAnimationFrame(raf);
      clearInterval(intervalId);
      const el = videoRef.current;
      if (el) {
        recordWatchProgress(watchKey, el.currentTime, el.duration, true);
        cleanupListeners(el);
      }
    };
  }, [folder, rel, previewKind, src]);

  if (!folder || !rel) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        Select a file to preview
      </div>
    );
  }

  const name = previewName;
  const kind = previewKind;

  function beginTitleEdit() {
    const { stem } = splitStemExt(name);
    setTitleStem(stem);
    setTitleEditing(true);
    setStatus('');
  }

  async function commitTitleRename() {
    const { ext } = splitStemExt(name);
    const newBase = buildRenamedFilename(titleStem, ext);
    if (!newBase) {
      setStatus('Name cannot be empty');
      return;
    }
    if (newBase === name) {
      setTitleEditing(false);
      return;
    }
    setStatus('Renaming…');
    try {
      const out = await renameItem(folder, rel, newBase);
      const newRel = out.rel;
      onRenamed?.(rel, newRel);
      setTitleEditing(false);
      setStatus('');
      onInvalidate();
    } catch (e) {
      setStatus(e.message || 'Rename failed');
    }
  }

  async function applyImageCrop() {
    if (!completedCrop || !imgRef.current || !crop) return;
    const img = imgRef.current;
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    const cropArea = {
      x: completedCrop.x * scaleX,
      y: completedCrop.y * scaleY,
      width: completedCrop.width * scaleX,
      height: completedCrop.height * scaleY
    };
    setStatus('Saving…');
    try {
      await cropImage({
        folder,
        file: rel,
        cropArea,
        rotation: 0
      });
      setImageCropOpen(false);
      setCrop(undefined);
      setCompletedCrop(null);
      setStatus('Crop saved');
      onInvalidate();
    } catch (e) {
      setStatus(e.message || 'failed');
    }
  }

  async function saveVideoFullFrame() {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || v.videoWidth < 2) {
      setStatus('Video not ready — wait for load or try another file');
      return;
    }
    const w = v.videoWidth;
    const h = v.videoHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    try {
      c.getContext('2d').drawImage(v, 0, 0, w, h);
    } catch {
      setStatus('Cannot read this frame (codec / CORS)');
      return;
    }
    setStatus('Saving…');
    try {
      const blob = await new Promise((res, rej) =>
        c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/png')
      );
      const base = `${stemForDownloads(name)}_${Date.now()}.png`;
      const { filename } = await savePngToDownloads(blob, base);
      setStatus(`Saved to Downloads: ${filename}`);
    } catch (e) {
      setStatus(e.message || 'Save failed');
    }
  }

  function openVideoRegionMode() {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || v.videoWidth < 2) {
      setStatus('Video not ready');
      return;
    }
    videoWasPausedBeforeRegionRef.current = v.paused;
    v.pause();
    const w = v.videoWidth;
    const h = v.videoHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    try {
      c.getContext('2d').drawImage(v, 0, 0, w, h);
    } catch {
      setStatus('Cannot read this frame');
      return;
    }
    c.toBlob(blob => {
      if (!blob) {
        setStatus('Could not grab frame');
        return;
      }
      setVideoSnapUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setVideoFrameCrop(undefined);
      setVideoFrameCompleted(null);
      setStatus('');
    }, 'image/png');
  }

  async function saveVideoRegionFrame() {
    if (!videoFrameCompleted || !videoSnapImgRef.current) return;
    const img = videoSnapImgRef.current;
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    const x = Math.round(videoFrameCompleted.x * scaleX);
    const y = Math.round(videoFrameCompleted.y * scaleY);
    const cw = Math.round(videoFrameCompleted.width * scaleX);
    const ch = Math.round(videoFrameCompleted.height * scaleY);
    if (cw < 1 || ch < 1) return;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
    setStatus('Saving…');
    try {
      const blob = await new Promise((res, rej) =>
        c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/png')
      );
      const base = `${stemForDownloads(name)}_region_${Date.now()}.png`;
      const { filename } = await savePngToDownloads(blob, base);
      setStatus(`Saved to Downloads: ${filename}`);
      closeVideoRegion();
    } catch (e) {
      setStatus(e.message || 'Save failed');
    }
  }

  async function onRemux() {
    setStatus('Remux…');
    try {
      const { jobId } = await remuxVideo(folder, rel);
      const j = await pollJob(jobId);
      if (j.status === 'error') throw new Error(j.error || 'remux failed');
      setStatus('Remux done');
      onInvalidate();
    } catch (e) {
      setStatus(e.message || 'remux failed');
    }
  }

  const inner = (
    <div
      className={
        fullscreen
          ? 'flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden basis-0'
          : 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden'
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-border pb-2">
        <div className="min-w-0 flex-1 basis-full sm:basis-[14rem]">
          {titleEditing ? (
            <div className="flex flex-wrap items-center gap-1">
              <Input
                ref={titleInputRef}
                aria-label="New file name"
                value={titleStem}
                onChange={e => setTitleStem(e.target.value)}
                className="h-8 max-w-full font-mono text-xs sm:max-w-md"
                onKeyDown={e => {
                  if (e.key === 'Enter') commitTitleRename();
                  if (e.key === 'Escape') {
                    setTitleEditing(false);
                    setStatus('');
                  }
                }}
              />
              <Button type="button" size="sm" className="h-8" onClick={commitTitleRename}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setTitleEditing(false);
                  setStatus('');
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="block w-full max-w-full truncate text-left text-sm font-medium text-foreground hover:underline"
              title={`Click to rename — ${rel}`}
              onClick={beginTitleEdit}
            >
              {rel}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'video' && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => onShowSpliceChange(!showSplice)}>
                {showSplice ? 'Hide splice' : 'Splice'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onRemux}>
                Remux to MP4
              </Button>
              {!videoSnapUrl && (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={saveVideoFullFrame}>
                    Screenshot frame
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={openVideoRegionMode}>
                    Screenshot region
                  </Button>
                </>
              )}
              {videoSnapUrl && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={saveVideoRegionFrame}
                    disabled={!videoFrameCompleted?.width}
                  >
                    Save region
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={closeVideoRegion}>
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
          {kind === 'image' && (
            <>
              <Button
                type="button"
                size="sm"
                variant={imageCropOpen ? 'default' : 'secondary'}
                onClick={() => {
                  setImageCropOpen(o => !o);
                  setCrop(undefined);
                  setCompletedCrop(null);
                }}
              >
                Crop
              </Button>
              {imageCropOpen && completedCrop && (
                <>
                  <Button type="button" size="sm" onClick={() => applyImageCrop()}>
                    Save crop
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setImageCropOpen(false);
                      setCrop(undefined);
                      setCompletedCrop(null);
                    }}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => onFullscreenChange(!fullscreen)}>
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        </div>
      </div>

      {status && (
        <div className="shrink-0 text-xs text-muted-foreground">{status}</div>
      )}

      {kind === 'video' && videoSnapUrl && (
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="mb-2 text-xs text-muted-foreground">
            Drag a region on the frozen frame, then Save region. Files go to your Downloads folder.
          </p>
          <ReactCrop
            crop={videoFrameCrop}
            onChange={c => setVideoFrameCrop(c)}
            onComplete={c => setVideoFrameCompleted(c)}
          >
            <img
              ref={videoSnapImgRef}
              src={videoSnapUrl}
              alt=""
              className="max-h-[60vh] w-auto"
            />
          </ReactCrop>
        </div>
      )}

      {kind === 'video' && (
        <div
          className={
            fullscreen && !videoSnapUrl
              ? 'relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md bg-black'
              : fullscreen && videoSnapUrl
                ? 'hidden'
                : ''
          }
        >
          <video
            ref={setVideoElement}
            key={src}
            src={src}
            controls
            crossOrigin="anonymous"
            className={
              fullscreen && !videoSnapUrl
                ? 'absolute inset-0 box-border h-full w-full max-h-none max-w-none object-contain'
                : `max-h-80 w-full rounded-md bg-black ${videoSnapUrl ? 'hidden' : ''}`
            }
            preload="metadata"
          />
        </div>
      )}

      {kind === 'image' && (
        <div className="min-h-0 flex-1 overflow-auto">
          {imageCropOpen ? (
            <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
              <img ref={imgRef} src={src} alt="" className="max-h-[50vh] w-auto" crossOrigin="anonymous" />
            </ReactCrop>
          ) : (
            <img src={src} alt="" className="max-h-[60vh] w-auto rounded-md" />
          )}
        </div>
      )}

      {kind === 'pdf' && (
        <iframe title="pdf" src={src} className="min-h-[50vh] w-full flex-1 rounded-md border border-border bg-white" />
      )}

      {kind === 'text' && (
        <ScrollArea className="h-64 max-h-[50vh] rounded-md border border-border p-2 font-mono text-xs">
          <pre className="whitespace-pre-wrap">{textContent}</pre>
          {textTrunc && <div className="mt-2 text-muted-foreground">Truncated preview</div>}
        </ScrollArea>
      )}

      {kind === 'audio' && (
        <audio key={src} src={src} controls className="w-full max-w-xl rounded-md" preload="metadata" />
      )}

      {kind === 'other' && <div className="text-sm text-muted-foreground">No preview for this type</div>}
    </div>
  );

  /** One stable DOM shape (outer → scroll shell → inner) so toggling fullscreen does not remount the video. */
  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex min-h-0 min-w-0 flex-col bg-background p-4'
          : 'flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-card/30'
      }
    >
      <div
        className={
          fullscreen
            ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden basis-0'
            : 'flex min-h-0 flex-1 flex-col overflow-hidden'
        }
      >
        {inner}
      </div>
    </div>
  );
}
