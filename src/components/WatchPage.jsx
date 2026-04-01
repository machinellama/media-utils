// src/WatchPage.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Dropdown, Button, Modal } from 'finallyreact';
import SubtitleModal from './SubtitleModal';

import './watch.css';

const RECENT_HISTORY_LIMIT = 10;

export default function WatchPage(props) {
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
  const [sortBy, setSortBy] = useState(localStorage.getItem('watch_sort_by') || 'updated');
  const [sortOrder, setSortOrder] = useState(localStorage.getItem('watch_sort_order') || 'desc');
  const [deleting, setDeleting] = useState(false);
  const [showSubModal, setShowSubModal] = useState(false);

  async function deleteFile(relPath) {
    if (!rootPath || !relPath) return;
    setDeleting(true);
    setStatus('Deleting...');
    try {
      const resp = await fetch('http://localhost:3001/watch/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: rootPath, path: relPath })
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j.error) {
        setStatus(j.error || 'Delete failed');
        setDeleting(false);
        return;
      }
      // reset player and selection
      setPreviewURL(null);
      setSelected(null);
      setPlaylist([]);
      setPlayingIndex(-1);
      setMode('single');
      setStatus('Deleted');

      // remove deleted file from flatList and tree in-memory
      setFlatList(prevFlat => {
        const next = (prevFlat || []).filter(f => f.path !== relPath);
        return next;
      });

      setTree(prevTree => {
        // recursively remove file from tree structure
        function removeFromNodes(nodes) {
          if (!Array.isArray(nodes)) return nodes;
          return nodes.map(n => {
            const nn = { ...n };
            if (Array.isArray(nn.files)) {
              nn.files = nn.files.filter(f => f.path !== relPath);
            }
            if (Array.isArray(nn.folders)) {
              nn.folders = removeFromNodes(nn.folders);
            }
            return nn;
          });
        }
        return removeFromNodes(prevTree);
      });

      setDeleting(false);
    } catch (e) {
      setStatus('Delete failed');
      setDeleting(false);
    }
  }


  useEffect(() => {
    try {
      const raw = localStorage.getItem('watch_folder_history');
      if (raw) {
        const h = JSON.parse(raw);
        const hList = Array.isArray(h) ? h : [];
        const firstHistory = hList?.[0] || null;

        setHistoryList(hList);

        if (firstHistory) {
          setRootPath(firstHistory);
          if (folderRef.current) folderRef.current.value = firstHistory;
        }
      }
    } catch (e) {
      console.error('watch folder useEffect', { e });
    }
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
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    return copy.sort((a, b) => {
      const la = (a.name || '').toLowerCase();
      const lb = (b.name || '').toLowerCase();

      if (sortByParam === 'name') {
        const cmp = collator.compare(la, lb);
        return sortOrderParam === 'asc' ? cmp : -cmp;
      } else if (sortByParam === 'updated') {
        const va = a.mtimeMs ?? a.mtime ?? 0;
        const vb = b.mtimeMs ?? b.mtime ?? 0;
        if (va < vb) return sortOrderParam === 'asc' ? -1 : 1;
        if (va > vb) return sortOrderParam === 'asc' ? 1 : -1;
        const cmp = collator.compare(la, lb);
        return sortOrderParam === 'asc' ? cmp : -cmp;
      } else if (sortByParam === 'size') {
        const sa = typeof a.size === 'number' ? a.size : Number(a.size) || 0;
        const sb = typeof b.size === 'number' ? b.size : Number(b.size) || 0;
        if (sa < sb) return sortOrderParam === 'asc' ? -1 : 1;
        if (sa > sb) return sortOrderParam === 'asc' ? 1 : -1;
        const cmp = collator.compare(la, lb);
        return sortOrderParam === 'asc' ? cmp : -cmp;
      }

      // default fallback: sort by name
      const cmp = collator.compare(la, lb);
      return sortOrderParam === 'asc' ? cmp : -cmp;
    });
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
    const updated = [normalized, ...historyList.filter(h => h !== normalized)].slice(0, RECENT_HISTORY_LIMIT);
    setHistoryList(updated);
    persistHistory(updated);
  }

  function updateRootFolder(newPath) {
    console.log({ newPath });
    if (!newPath) return;
    setRootPath(newPath);
    if (folderRef.current) folderRef.current.value = newPath;
    setSelected(null);
    setPreviewURL(null);
    setPlaylist([]);
    setPlayingIndex(-1);
    setMode('single');
    saveFolderToHistory(newPath);
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
      const streamURL = `http://localhost:3001/watch/file?folder=${encodeURIComponent(rootPath)}&path=${encodeURIComponent(relPath)}`;
      const v = videoRef?.current;

      const attemptServerRemux = async () => {
        setStatus('Remuxing for browser playback...');
        setProgress(0.05);
        try {
          // Fetch the remote file as a blob so we can upload it to the splice/remux endpoint
          const fileResp = await fetch(streamURL);
          if (!fileResp.ok) throw new Error('fetch file failed');
          const blob = await fileResp.blob();
          const fileName = relPath.split('/').pop() || 'video';
          const form = new FormData();
          form.append('file', new File([blob], fileName, { type: blob.type }));
          form.append('remuxOnly', '1');

          const remuxResp = await fetch('http://localhost:3001/splice?remuxOnly=1', {
            method: 'POST',
            body: form,
          });
          if (!remuxResp.ok) {
            const err = await remuxResp.json().catch(() => ({ error: 'server error' }));
            setStatus('Remux failed: ' + (err.error || remuxResp.statusText));
            setProgress(0);
            return;
          }

          // Stream response -> blob with progress if length present
          const reader = remuxResp.body.getReader();
          const contentLength = remuxResp.headers.get('Content-Length');
          let received = 0;
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (contentLength) setProgress(0.05 + 0.6 * (received / contentLength));
          }
          const out = new Blob(chunks, { type: 'video/mp4' });
          const url = URL.createObjectURL(out);
          setPreviewURL(url);
          setSelected(relPath);
          setStatus('');
          setProgress(1);
          setTimeout(() => setProgress(0), 600);
        } catch (err) {
          console.error('remux failed', err);
          setStatus('Remux failed: ' + (err.message || 'error'));
          setProgress(0);
        }
      };

      // If no video element ref, just set the stream URL directly (and fall back to remux via user action)
      if (!v) {
        setPreviewURL(streamURL);
        setSelected(relPath);
        setStatus('');
        setProgress(1);
        setTimeout(() => setProgress(0), 600);
        return;
      }

      // Try to let the browser probe the remote stream; on error, fetch+upload to server remux
      let metadataLoaded = false;
      const onLoaded = () => {
        metadataLoaded = true;
        cleanup();
        setPreviewURL(streamURL);
        setSelected(relPath);
        setStatus('');
        setProgress(1);
        setTimeout(() => setProgress(0), 600);
      };
      const onErr = () => {
        cleanup();
        attemptServerRemux();
      };
      const cleanup = () => {
        v.removeEventListener('loadedmetadata', onLoaded);
        v.removeEventListener('error', onErr);
      };

      v.pause();
      v.src = streamURL;
      v.load();
      v.addEventListener('loadedmetadata', onLoaded, { once: true });
      v.addEventListener('error', onErr, { once: true });

      // If neither event fires within 1s, assume browser accepted it
      setTimeout(() => {
        if (!metadataLoaded) cleanup();
      }, 1000);

    } catch (e) {
      console.error('openFile failed', e);
      setStatus('Play failed');
      setProgress(0);
    }
  }


  function formatSize(size) {
    if (size >= 1024 * 1024 * 1024) {
      return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    return (size / (1024 * 1024)).toFixed(2) + ' MB';
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
            <button className="toggle-btn" onClick={() => {
              console.log({ n });
              updateRootFolder(n.absolutePath || n.path);
            }}>
              →
            </button>
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
    <div className="watch-container cloud-3 w-full">
      <aside className="watch-left fill-height scroll">
        <div className="controls-top">
          <Dropdown
            className="cloud-3 w-full"
            color="green-7"
            textInputProps={{
              outline: false,
              dropdownArrowProps: {
                className: 'green-7'
              },
              onKeyDown: (e) => {
                e?.stopPropagation();
                if (e.key === 'Enter') {
                  console.log('dropdown search', e.target.value);
                  updateRootFolder(e.target.value)
                }
              }
            }}
            optionContainerProps={{
              className: 'stone-10 w-fit'
            }}
            options={historyList.map((h, i) => {
              return {
                value: h,
                label: h
              }
            })}
            onChange={(e) => {
              console.log(e.target.value);
              updateRootFolder(e.target.value)
            }}
            value={rootPath}
          />
        </div>

        <div className="flex">
          <Button onClick={pickRandom} text="Random" size="sm" rounded={false} className="mr-1/5 px-1/2 cloud-3" borderColor="purple-8" color="stone-10" />
          <Button onClick={() => { playAll(false); }} text="Play All" size="sm" rounded={false} className="mr-1/5 px-1/2 cloud-3" borderColor="purple-8" color="stone-10" />
          <Button onClick={() => { playAll(true); }} text="All Random" size="sm" rounded={false} className="mr-1/5 px-1/2 cloud-3" borderColor="purple-8" color="stone-10" />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>Sort:</span>
            <select className="history-select" value={sortBy} onChange={(e) => {
              const sortValue = e.target.value;
              setSortBy(sortValue);
              localStorage.setItem('watch_sort_by', sortValue);
            }}>
              <option value="updated">Updated</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>Order:</span>
            <select className="history-select" value={sortOrder} onChange={(e) => {
              const sortValue = e.target.value;
              setSortOrder(sortValue);
              localStorage.setItem('watch_sort_order', sortValue);
            }}>
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>
          </div>
        </div>

        <div className="library" style={{ marginTop: '8px' }}>
          {rootPath && (
            <div className="folder-header">
              <button className="toggle-btn" onClick={() => updateRootFolder(rootPath.split('/').slice(0, -1).join('/'))}>
                ↑
              </button>
              <div className="folder-name">{rootPath}</div>
            </div>
          )}
          {tree.length === 0 && <div className="empty">No videos. Enter folder path above and press Open.</div>}
          {renderTree(tree)}
        </div>
      </aside>

      <main className="watch-main fill-height w-full">
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
        <div className="player-box fill-height w-full test">
          {previewURL ? (
            previewURL.startsWith('blob:') ? (
              <video ref={videoRef} src={previewURL} controls autoPlay style={{ width: '100%', height: '100%' }} />
            ) : (
              <video ref={videoRef} src={previewURL} controls autoPlay style={{ width: '100%', height: '100%' }} />
            )
          ) : (
            <div className="placeholder w-full">Select a file to play</div>
          )}
        </div>
        <div className="player-actions w-full flex justify-between">
          <Button
            onClick={() => {
              props.setSelectedVideoURL?.(previewURL, selected, rootPath);
            }}
            disabled={!selected}
            className="output-name cloud-3"
            text="Splice"
            size="sm"
            color="stone-10"
          />

          <div className="flex">
            <div>
              <Button
                onClick={() => setShowSubModal(true)}
                text="Subs"
                disabled={!selected || deleting}
                className="output-name cloud-3 mr-1/2"
                size="sm"
                color="stone-10"
              />

              <SubtitleModal
                filePath={`${rootPath}/${selected}`}
                isOpen={showSubModal}
                onClose={() => setShowSubModal(false)}
              />
            </div>
            <Button
              onClick={() => { if (selected) deleteFile(selected); }}
              disabled={!selected || deleting}
              className="output-name cloud-3 mr-1/2"
              text={deleting ? 'Deleting...' : 'Delete'}
              size="sm"
              color="stone-10"
            />
          </div>
        </div>

        <div className="progress-row">
          <progress value={progress} max="1"></progress>
        </div>
      </main>
    </div>
  );
}