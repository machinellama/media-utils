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

  function onFiles(e){
    const list = Array.from(e.target.files || []);
    setFiles(list);
    setOrder(list.map((_,i)=>i));
    setPreviewURL(null);
    setProgress(0);
    setStatus('');
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
      const nxt = prev.filter((_,idx)=>idx!==i);
      // if removing a file, also remove from files array to keep indexes consistent for display
      const removedIdx = prev[i];
      const newFiles = files.filter((_,idx)=>idx!==removedIdx);
      // remap order to new file indexes
      const map = {};
      let ni = 0;
      for (let k=0;k<files.length;k++){
        if (k===removedIdx) continue;
        map[k] = ni++;
      }
      setFiles(newFiles);
      return nxt.map(old => map[old]);
    });
  }

  async function combine(){
    if (order.length < 2) return;
    setStatus('Uploading videos...');
    setProgress(0.02);
    try {
      const form = new FormData();
      order.forEach((idx, i)=> {
        const f = files[idx];
        form.append('files', f, `part${i}_${f.name}`);
      });
      form.append('order', JSON.stringify(order.map(idx=>files[idx].name)));
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
    a.download = 'combined.mp4';
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
          <button onClick={combine} disabled={order.length<2}>Combine on server</button>
          <div className="right-actions">
            <button onClick={()=>{ setFiles([]); setOrder([]); setPreviewURL(null); setProgress(0); setStatus(''); inputRef.current.value=''; }}>Clear</button>
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
