// src/CombinePage.jsx
import React, { useRef, useState } from 'react';
import './combine.css';

export default function CombinePage(){
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [order, setOrder] = useState([]);
  const [previewURL, setPreviewURL] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [outputName, setOutputName] = useState('combined.mp4');

  function onFiles(e){
    const list = Array.from(e.target.files || []);
    if (list.length === 0) return;
    const startIndex = files.length;
    const newFiles = [...files, ...list];
    setFiles(newFiles);
    setOrder(prev => {
      // if prev empty and there are existing files, ensure base order keeps existing indexes
      const base = prev.length ? prev.slice() : files.map((_, i) => i);
      const added = list.map((_, idx) => startIndex + idx);
      return [...base, ...added];
    });
    setPreviewURL(null);
    setProgress(0);
    setStatus('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function move(i, dir){
    setOrder(prev=>{
      const nxt = [...prev];
      const j = i + dir;
      if (j<0 || j>=nxt.length) return prev;
      [nxt[i], nxt[j]] = [nxt[j], nxt[i]];
      return nxt;
    });
  }

  function remove(i){
    setOrder(prev=>{
      const removedFileIdx = prev[i];
      const nxtOrder = prev.filter((_, idx) => idx !== i);
      const newFiles = files.filter((_, idx) => idx !== removedFileIdx);
      const map = {};
      let ni = 0;
      for (let k = 0; k < files.length; k++){
        if (k === removedFileIdx) continue;
        map[k] = ni++;
      }
      const remapped = nxtOrder.map(old => map[old]);
      setFiles(newFiles);
      return remapped;
    });
    setPreviewURL(null);
    setProgress(0);
    setStatus('');
  }

  async function uploadAndMaybeRemux(file){
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('remuxOnly', '1');
      const resp = await fetch('http://localhost:3001/splice?remuxOnly=1', {
        method: 'POST',
        body: form,
      });
      if (!resp.ok) {
        return file;
      }
      const reader = resp.body.getReader();
      const contentLength = resp.headers.get('Content-Length');
      let received = 0;
      const chunks = [];
      while (true){
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) setProgress(0.02 + 0.6 * (received / contentLength));
      }
      const out = new Blob(chunks, { type: 'video/mp4' });
      const newName = (file.name || 'video').replace(/\.[^/.]+$/,'') + '.mp4';
      const newFile = new File([out], newName, { type: 'video/mp4' });
      return newFile;
    } catch (err) {
      console.error('[combine remux] failed', err);
      return file;
    }
  }

  async function combine(){
    setStatus('Preparing files...');
    setProgress(0.02);
    try {
      setStatus('Uploading videos (remuxing if needed)...');
      setProgress(0.03);
      const form = new FormData();

      // For each ordered entry, remux in-place if needed and append to form.
      for (let i = 0; i < order.length; i++){
        const idx = order[i];
        const originalFile = files[idx];
        const maybeRemuxed = await uploadAndMaybeRemux(originalFile);

        // If remux produced a new File, replace original in-state at its index so list shows single item.
        if (maybeRemuxed !== originalFile){
          setFiles(prev => {
            const next = prev.slice();
            next[idx] = maybeRemuxed;
            return next;
          });
        }

        const toSend = maybeRemuxed;
        form.append('files', toSend, `part${i}_${toSend.name}`);
        setProgress(0.03 + 0.02 * (i + 1));
      }

      // Use the user-provided output name when telling server expected output filename
      const safeName = (outputName && outputName.trim()) ? outputName.trim() : 'combined.mp4';
      form.append('order', JSON.stringify(order.map(idx => files[idx]?.name || `file${idx}`)));
      form.append('outputName', safeName);

      const resp = await fetch('http://localhost:3001/combine', { method:'POST', body: form });
      if (!resp.ok){
        const err = await resp.json().catch(()=>({error:'server'}));
        setStatus('Server error: '+(err.error||resp.statusText));
        setProgress(0);
        return;
      }
      setStatus('Downloading combined video...');
      const reader = resp.body.getReader();
      const contentLength = resp.headers.get('Content-Length');
      let received = 0;
      const chunks = [];
      while (true){
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) setProgress(0.1 + 0.8*(received/contentLength));
      }
      const out = new Blob(chunks, { type: 'video/mp4' });
      const url = URL.createObjectURL(out);
      setPreviewURL(url);
      setProgress(1);
      setStatus('Done');
      setTimeout(()=>setProgress(0),600);
    } catch (e){
      console.error(e);
      setStatus('Combine failed');
      setProgress(0);
    }
  }

  function downloadPreview(){
    if (!previewURL) return;
    const a = document.createElement('a');
    a.href = previewURL;
    a.download = outputName && outputName.trim() ? outputName.trim() : 'combined.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="combine-container">
      <div className="combine-left">
        <label className="filelabel">
          <input ref={inputRef} type="file" accept="video/*" multiple onChange={onFiles}/>
          <span>{files.length ? `${files.length} selected` : 'Select videos to combine (multiple)'}</span>
        </label>

        <div className="sequence">
          <h3>Sequence</h3>
          <ul>
            {order.map((idx,i)=>(
              <li key={i}>
                <div className="meta">
                  <div className="name">{files[idx]?.name || '—'}</div>
                  <div className="small">{files[idx]?.size ? `${Math.round(files[idx].size/1024)} KB` : ''}</div>
                </div>
                <div className="actions">
                  <button onClick={()=>move(i,-1)} aria-label="Move up">↑</button>
                  <button onClick={()=>move(i,1)} aria-label="Move down">↓</button>
                  <button onClick={()=>remove(i)} aria-label="Remove">✖</button>
                </div>
              </li>
            ))}
            {order.length===0 && <li className="empty">No clips added</li>}
          </ul>
        </div>

        <div className="combine-controls">
          <div className="combine-row">
            <input
              type="text"
              className="output-name"
              value={outputName}
              onChange={e=>setOutputName(e.target.value)}
              placeholder="Combined file name (e.g. mymix.mp4)"
            />
            <button onClick={combine}>Combine on server</button>
          </div>
          <div className="right-actions">
            <button onClick={()=>{
              setFiles([]);
              setOrder([]);
              setPreviewURL(null);
              setProgress(0);
              setStatus('');
              setOutputName('combined.mp4');
              if (inputRef.current) inputRef.current.value='';
            }}>Clear</button>
            <button onClick={downloadPreview} disabled={!previewURL}>Download</button>
          </div>
        </div>
      </div>

      <aside className="combine-right">
        <h3>Preview</h3>
        <div className="preview-box">
          {previewURL ? (
            <video src={previewURL} controls style={{width:'100%'}} />
          ) : (
            <div className="placeholder">Combined preview will appear here</div>
          )}
        </div>
        <div className="progress-row">
          <label>{status || 'Combine progress'}</label>
          <progress value={progress} max="1"></progress>
        </div>
      </aside>
    </div>
  );
}
