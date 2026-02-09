// src/WatchPage.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import './watch.css';

export default function WatchPage() {
  const folderRef = useRef(null);
  const videoRef = useRef(null);
  const [rootPath, setRootPath] = useState('');
  const [tree, setTree] = useState([]);
  const [flatList, setFlatList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [previewURL, setPreviewURL] = useState(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [historyList, setHistoryList] = useState([]);
  const [playlist, setPlaylist] = useState([]);
  const [playingIndex, setPlayingIndex] = useState(-1);
  const [expandedMap, setExpandedMap] = useState({});
  const [mode, setMode] = useState('single');
  const [sortBy, setSortBy] = useState('updated');
  const [sortOrder, setSortOrder] = useState('desc');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('watch_folder_history');
      if (raw) {
        const h = JSON.parse(raw);
        setHistoryList(Array.isArray(h) ? h : []);
      }
    } catch (e) { }
  }, []);

  useEffect(() => {
    if (!rootPath) return;
    setStatus('Scanning folder...');
    fetch('http://localhost:3001/watch/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: rootPath })
    }).then(r => r.json()).then(data => {
      if (data.error) { setStatus(data.error); setTree([]); setFlatList([]); return; }
      const initMap = {};
      if (Array.isArray(data.tree) && data.tree.length > 0) {
        data.tree.forEach(n => {
          const key = n.name;
          initMap[key] = true;
        });
      }
      setExpandedMap(initMap);
      const sortedTree = sortTreeFiles(data.tree || [], sortBy, sortOrder);
      setTree(sortedTree);
      setFlatList(applySortToFlat(data.flat || [], sortBy, sortOrder));
      setStatus('');
    }).catch(e => { setStatus('Scan failed'); setTree([]); setFlatList([]); });
  }, [rootPath]);

  useEffect(() => {
    setFlatList(prev => applySortToFlat(prev, sortBy, sortOrder));
    setTree(prev => sortTreeFiles(prev, sortBy, sortOrder));
  }, [sortBy, sortOrder]);

  function applySortToFlat(list, sortByParam = sortBy, sortOrderParam = sortOrder) {
    const copy = Array.isArray(list) ? list.slice() : [];
    const newArray = copy.sort((a, b) => {
      const la = (a.name || '').toLowerCase();
      const lb = (b.name || '').toLowerCase();

      if (sortByParam === 'name') {
        const cmp = la.localeCompare(lb);
        return sortOrderParam === 'asc' ? cmp : -cmp;
      } else {
        const va = a.mtimeMs || a.mtime || 0;
        const vb = b.mtimeMs || b.mtime || 0;
        if (va < vb) return sortOrderParam === 'asc' ? -1 : 1;
        if (va > vb) return sortOrderParam === 'asc' ? 1 : -1;
        const cmp = la.localeCompare(lb);
        return sortOrderParam === 'asc' ? cmp : -cmp;
      }
    });
    return newArray;
  }

  function sortTreeFiles(nodes, sortByParam = sortBy, sortOrderParam = sortOrder) {
    if (!Array.isArray(nodes)) return [];
    return nodes.map(n => {
      const nn = { ...n };
      if (Array.isArray(nn.files)) {
        nn.files = applySortToFlat(nn.files, sortByParam, sortOrderParam);
      }
      if (Array.isArray(nn.folders)) {
        nn.folders = sortTreeFiles(nn.folders, sortByParam, sortOrderParam);
      }
      return nn;
    });
  }

  function persistHistory(list) {
    try { localStorage.setItem('watch_folder_history', JSON.stringify(list)); } catch (e) { }
  }

  function saveFolderToHistory(folder) {
    if (!folder) return;
    const normalized = folder.trim();
    const updated = [normalized, ...historyList.filter(h => h !== normalized)].slice(0, 5);
    setHistoryList(updated);
    persistHistory(updated);
  }

  function onPickFolder(e) {
    const v = e.target.value.trim();
    if (!v) return;
    setRootPath(v);
    setSelected(null);
    setPreviewURL(null);
    setPlaylist([]);
    setPlayingIndex(-1);
    setMode('single');
    saveFolderToHistory(v);
  }

  function onOpenClick() {
    if (!folderRef.current) return;
    const v = folderRef.current.value.trim();
    if (!v) return;
    setRootPath(v);
    setSelected(null);
    setPreviewURL(null);
    setPlaylist([]);
    setPlayingIndex(-1);
    setMode('single');
    saveFolderToHistory(v);
  }

  function onHistorySelect(e) {
    const v = e.target.value;
    if (!v) return;
    if (folderRef.current) folderRef.current.value = v;
    setRootPath(v);
    setSelected(null);
    setPreviewURL(null);
    setPlaylist([]);
    setPlayingIndex(-1);
    setMode('single');
    saveFolderToHistory(v);
  }

  function toggleFolder(key) {
    setExpandedMap(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function pickRandom() {
    if (!flatList.length) return;
    setMode('random');
    const item = flatList[Math.floor(Math.random() * flatList.length)];
    openFile(item.path);
  }

  async function openFile(relPath) {
    setStatus('Preparing stream...');
    setProgress(0.02);
    try {
      const resp = await fetch('http://localhost:3001/watch/stream-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: rootPath, path: relPath })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'server' }));
        setStatus(err.error || 'server error');
        setProgress(0);
        return;
      }
      const meta = await resp.json();
      if (meta.remuxNeeded) {
        setStatus('Remuxing for browser playback...');
        setProgress(0.05);
        const remuxResp = await fetch('http://localhost:3001/watch/remux', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: rootPath, path: relPath })
        });
        if (!remuxResp.ok) { setStatus('Remux failed'); setProgress(0); return; }
        const blob = await remuxResp.blob();
        const url = URL.createObjectURL(blob);
        setPreviewURL(url);
        setSelected(relPath);
        setStatus('');
        setProgress(1);
        setTimeout(() => setProgress(0), 600);
        return;
      }
      const streamURL = `http://localhost:3001/watch/file?folder=${encodeURIComponent(rootPath)}&path=${encodeURIComponent(relPath)}`;
      setPreviewURL(streamURL);
      setSelected(relPath);
      setStatus('');
      setProgress(1);
      setTimeout(() => setProgress(0), 600);
    } catch (e) {
      setStatus('Play failed');
      setProgress(0);
    }
  }

  function formatSize(size) {
    if (size >= 1024 * 1024 * 1024) {
      return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderTree(nodes, prefix = '') {
    return nodes.map(n => {
      const key = prefix + n.name;
      const isExpanded = !!expandedMap[key];
      return (
        <div className="folder" key={key}>
          <div className="folder-header">
            <button className={'toggle-btn' + (isExpanded ? ' expanded' : '')} onClick={() => toggleFolder(key)}>
              {isExpanded ? '▾' : '▸'}
            </button>
            <div className="folder-name">{n.name}</div>
          </div>
          {isExpanded && (
            <div className="children">
              {n.files && n.files.map(f => (
                <div
                  key={f.path}
                  className={'file-item' + (selected === f.path ? ' selected' : '')}
                  title={f.name}
                  onClick={() => {
                    setMode('single');
                    setPlaylist([]);
                    setPlayingIndex(-1);
                    openFile(f.path);
                  }}
                >
                  <div className="file-name" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{f.name}</div>
                  <div className="file-small">{formatSize(f.size)}</div>
                </div>
              ))}
              {n.folders && renderTree(n.folders, key + '/')}
            </div>
          )}
        </div>
      );
    });
  }

  const buildPlaylistFromFlat = useCallback((list, shuffled = false) => {
    const arr = list.map(f => f.path);
    if (shuffled) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    return arr;
  }, []);

  function playAll(shuffle = false) {
    if (!flatList.length) return;
    const pl = buildPlaylistFromFlat(flatList, shuffle);
    setPlaylist(pl);
    setPlayingIndex(0);
    setMode(shuffle ? 'all-random' : 'all');
    openFile(pl[0]);
  }

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    function onEnded() {
      if (mode === 'single') return;
      if (mode === 'random') {
        if (!flatList.length) return;
        const item = flatList[Math.floor(Math.random() * flatList.length)];
        openFile(item.path);
        return;
      }
      if (mode === 'all' || mode === 'all-random') {
        if (!playlist.length) return;
        let next;
        if (mode === 'all') {
          next = playingIndex + 1;
          if (next >= playlist.length) next = 0;
        } else {
          next = Math.floor(Math.random() * playlist.length);
        }
        setPlayingIndex(next);
        openFile(playlist[next]);
      }
    }
    vid.addEventListener('ended', onEnded);
    return () => vid.removeEventListener('ended', onEnded);
  }, [videoRef, playlist, playingIndex, mode, flatList]);

  function playNext() {
    if (mode === 'single') {
      return;
    }
    if (mode === 'random') {
      if (!flatList.length) return;
      const item = flatList[Math.floor(Math.random() * flatList.length)];
      openFile(item.path);
      return;
    }
    if (mode === 'all') {
      if (!playlist.length) return;
      const next = (playingIndex + 1) % playlist.length;
      setPlayingIndex(next);
      openFile(playlist[next]);
      return;
    }
    if (mode === 'all-random') {
      if (!playlist.length) return;
      const next = Math.floor(Math.random() * playlist.length);
      setPlayingIndex(next);
      openFile(playlist[next]);
      return;
    }
  }

  function playPrevious() {
    if (mode === 'single') {
      return;
    }
    if (mode === 'random') {
      if (!flatList.length) return;
      const item = flatList[Math.floor(Math.random() * flatList.length)];
      openFile(item.path);
      return;
    }
    if (mode === 'all') {
      if (!playlist.length) return;
      const prev = (playingIndex - 1 + playlist.length) % playlist.length;
      setPlayingIndex(prev);
      openFile(playlist[prev]);
      return;
    }
    if (mode === 'all-random') {
      if (!playlist.length) return;
      const prev = Math.floor(Math.random() * playlist.length);
      setPlayingIndex(prev);
      openFile(playlist[prev]);
      return;
    }
  }

  return (
    <div className="watch-container">
      <aside className="watch-left">
        <div className="controls-top">
          <input ref={folderRef} type="text" placeholder="Enter folder path (absolute)" onBlur={onPickFolder} />
          <button onClick={onOpenClick}>Open</button>
          <select className="history-select" onChange={onHistorySelect} value="">
            <option value="">Recent</option>
            {historyList.map((h, i) => (
              <option key={h} value={h}>{i + 1}: {h}</option>
            ))}
          </select>
        </div>

        <div className="controls-top" style={{ marginTop: '8px' }}>
          <button onClick={pickRandom} className="random">Random</button>
          <button onClick={() => { playAll(false); }}>Play all</button>
          <button onClick={() => { playAll(true); }}>Play all random</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>Sort:</span>
            <select className="history-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="updated">Updated</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>Order:</span>
            <select className="history-select" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>
          </div>
        </div>

        <div className="library" style={{ marginTop: '8px' }}>
          {tree.length === 0 && <div className="empty">No videos. Enter folder path above and press Open.</div>}
          {renderTree(tree)}
        </div>
      </aside>

      <main className="watch-main">
        <div className="player-top">
          <div className="title">{selected || 'No video selected'}</div>
          <div className="status">{status}</div>
        </div>
        <div className="player-controls" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          {mode !== 'single' && mode !== 'random' && (
            <>
              <button className="random" onClick={playPrevious}>Previous</button>
              <button className="random" onClick={playNext}>Next</button>
            </>
          )}

          <div style={{ marginLeft: 'auto' }}>{mode === 'single' ? 'Mode: single' : mode === 'random' ? 'Mode: random' : mode === 'all' ? 'Mode: all' : 'Mode: all-random'}</div>
        </div>
        <div className="player-box">
          {previewURL ? (
            previewURL.startsWith('blob:') ? (
              <video ref={videoRef} src={previewURL} controls autoPlay style={{ width: '100%', height: '100%' }} />
            ) : (
              <video ref={videoRef} src={previewURL} controls autoPlay style={{ width: '100%', height: '100%' }} />
            )
          ) : (
            <div className="placeholder">Select a file to play</div>
          )}
        </div>
        <div className="progress-row">
          <progress value={progress} max="1"></progress>
        </div>
      </main>
    </div>
  );
}
