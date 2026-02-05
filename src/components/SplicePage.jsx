// src/SplicePage.jsx
import React, { useRef, useState, useEffect } from 'react';
import './splice.css';

function fmt(t){
  if (!isFinite(t)) return '—';
  const h = Math.floor(t/3600);
  const m = Math.floor((t%3600)/60);
  const s = Math.floor(t%60);
  const ms = Math.floor((t % 1)*1000);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

export default function SplicePage(){
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

  useEffect(()=> {
    const v = videoRef.current;
    if (!v) return;
    const onTime = ()=> setCurrentTime(v.currentTime);
    const onLoaded = ()=> setDuration(v.duration || NaN);
    const onError = ()=> {
      const err = v.error;
      if (err) {
        console.error('[video] media error:', { code: err.code, message: err.message || null, mediaErrorObj: err });
      } else {
        console.error('[video] video element reported error event with no MediaError');
      }
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('error', onError);
    return ()=> {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('error', onError);
    };
  }, []);

  function resetStateOnNewFile(){
    setRanges([]);
    setCurrentStart(null);
    setCurrentEnd(null);
    setProgress(0);
    setStatus('');
    setDuration(NaN);
    setCurrentTime(0);
  }

  async function remuxFileToMp4(file){
    setRemuxing(true);
    setStatus('Remuxing for playback...');
    setProgress(0.02);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('remuxOnly', '1');
      const resp = await fetch('http://localhost:3001/splice?remuxOnly=1', {
        method: 'POST',
        body: form,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(()=>({ error: 'server error' }));
        setStatus('Remux failed: ' + (err.error || resp.statusText));
        setProgress(0);
        setRemuxing(false);
        return null;
      }

      // Stream response -> blob with progress if length present
      const reader = resp.body.getReader();
      const contentLength = resp.headers.get('Content-Length');
      let received = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) setProgress(0.02 + 0.6 * (received / contentLength));
      }
      const out = new Blob(chunks, { type: 'video/mp4' });
      setProgress(1);
      setStatus('Remux complete');
      setTimeout(()=>setProgress(0),600);
      setRemuxing(false);
      return out;
    } catch (err) {
      console.error('[remux] failed', err);
      setStatus('Remux failed');
      setProgress(0);
      setRemuxing(false);
      return null;
    }
  }

  async function onFile(e){
    const f = e.target.files && e.target.files[0];
    console.debug('[file] input change', { fileProvided: !!f });
    if (!f) {
      setFileBlob(null);
      setSourceUrl(null);
      resetStateOnNewFile();
      return;
    }
    console.info('[file] selected', { name: f.name, size: f.size, type: f.type });
    resetStateOnNewFile();

    // Try to create object URL for direct playback first.
    try {
      const url = URL.createObjectURL(f);
      setSourceUrl(url);
      setFileBlob(f);
      // Test whether the browser can play it by loading metadata asynchronously:
      // If it fails to load playable metadata, attempt server remux automatically.
      // We'll listen for loadedmetadata and error events briefly.
      const v = videoRef.current;
      let metadataLoaded = false;
      const onLoaded = ()=> { metadataLoaded = true; cleanup(); };
      const onErr = ()=> { cleanup(); attemptRemux(); };
      const cleanup = ()=> {
        if (!v) return;
        v.removeEventListener('loadedmetadata', onLoaded);
        v.removeEventListener('error', onErr);
      };
      const attemptRemux = async ()=> {
        // If browser couldn't load playable source, call server remux.
        console.info('[file] attempting remux because browser cannot play file locally');
        const remuxedBlob = await remuxFileToMp4(f);
        if (remuxedBlob) {
          const remuxUrl = URL.createObjectURL(remuxedBlob);
          // replace source and fileBlob with remuxed MP4 so UI works naturally
          setSourceUrl(remuxUrl);
          const newName = (f.name || 'video').replace(/\.[^/.]+$/,'') + '.mp4';
          const newFile = new File([remuxedBlob], newName, { type: 'video/mp4' });
          setFileBlob(newFile);
        } else {
          // keep original and disable export until user manually remuxes
          setFileBlob(f);
        }
      };

      // Give the video a moment to try loading metadata:
      if (v) {
        v.pause();
        v.src = url;
        v.load();
        v.addEventListener('loadedmetadata', onLoaded, { once: true });
        v.addEventListener('error', onErr, { once: true });
        // If neither event fires within 1s, assume loadedmetadata succeeded or browser accepted it.
        setTimeout(()=> {
          if (!metadataLoaded) cleanup();
        }, 1000);
      }
    } catch (err) {
      console.error('[file] createObjectURL failed', err);
      setStatus('Failed to load file locally');
      setSourceUrl(null);
      setFileBlob(null);
    }
  }

  function setStart(){ 
    const t = videoRef.current && videoRef.current.currentTime;
    setCurrentStart(t); 
  }
  function setEnd(){ 
    const t = videoRef.current && videoRef.current.currentTime;
    setCurrentEnd(t); 
  }
  function addRange(){
    const s = Math.min(currentStart ?? 0, currentEnd ?? 0);
    const e = Math.max(currentStart ?? 0, currentEnd ?? 0);
    if (!isFinite(s) || !isFinite(e) || e - s < 0.01) return;
    setRanges(prev => [...prev, {start:s, end:e}]);
    setCurrentStart(null);
    setCurrentEnd(null);
  }
  function removeRange(i){ setRanges(prev => prev.filter((_,idx)=>idx!==i)); }

  async function exportRanges(){
    if (!fileBlob || ranges.length===0) return;
    setProgress(0.02);
    setStatus('Uploading file...');
    try {
      const form = new FormData();
      form.append('file', fileBlob, fileBlob.name);
      form.append('ranges', JSON.stringify(ranges));
      // send to server splice endpoint which will remux if needed and perform cut/concat
      const resp = await fetch('http://localhost:3001/splice', {
        method: 'POST',
        body: form,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(()=>({ error: 'server error' }));
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
        if (contentLength) setProgress(0.1 + 0.8 * (received / contentLength));
      }
      const out = new Blob(chunks, { type: 'video/mp4' });
      downloadBlob(out, (fileBlob.name || 'video').replace(/\.[^/.]+$/,'') + '_spliced.mp4');
      setProgress(1);
      setStatus('Done');
      setTimeout(()=>setProgress(0),600);
    } catch (err) {
      console.error(err);
      setStatus('Upload or processing failed');
      setProgress(0);
    }
  }

  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  return (
    <div className="container">
      <div className="left-col">
        <label className="filelabel">
          <input ref={fileRef} type="file" accept="video/*" onChange={onFile}/>
          <span>{fileBlob ? fileBlob.name : 'Select video to splice'}</span>
        </label>
        <div className="player-wrap">
          <video ref={videoRef} controls crossOrigin="anonymous" src={sourceUrl} style={{ maxWidth:'100%' }}></video>
        </div>
        <div className="times">
          <div className="time-item">
            <label>Current</label>
            <div>{fmt(currentTime)}</div>
          </div>
          <div className="time-item">
            <label>Start</label>
            <div>{currentStart==null? '—' : fmt(currentStart)}</div>
          </div>
          <div className="time-item">
            <label>End</label>
            <div>{currentEnd==null? '—' : fmt(currentEnd)}</div>
          </div>
        </div>
        <div className="btns">
          <button onClick={setStart} disabled={!fileBlob}>Set Start</button>
          <button onClick={setEnd} disabled={!fileBlob}>Set End</button>
          <button onClick={addRange} disabled={!fileBlob || currentStart==null || currentEnd==null}>Add Range</button>
          <button onClick={()=>{setRanges([]);}}>Clear</button>
          <button onClick={exportRanges} disabled={!fileBlob || ranges.length===0 || remuxing}>Export Selected (server)</button>
        </div>
      </div>
      <aside className="right-col">
        <div className="ranges">
          <h2>Ranges</h2>
          <ul id="rangesList">
            {ranges.map((r,i)=>(
              <li key={i}>
                <div className="range-time">{fmt(r.start)} → {fmt(r.end)}</div>
                <div className="range-actions">
                  <button onClick={()=>{ videoRef.current.currentTime = r.start; videoRef.current.play(); }}>▶</button>
                  <button onClick={()=>removeRange(i)}>✖</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="progress-row">
          <label>{status || 'Export progress'}</label>
          <progress value={progress} max="1"></progress>
        </div>
      </aside>
    </div>
  );
}
