import React, { useState } from 'react';
import './subtitle.css';

export default function SubtitleModal({ isOpen, onClose, filePath }) {
  console.log({ isOpen, onClose, filePath });

  const [pathInput, setPathInput] = useState(filePath || '');
  const [language, setLanguage] = useState('en');
  const [searchName, setSearchName] = useState('');
  const [results, setResults] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Reset state each time modal opens/closes
  React.useEffect(() => {
    if (isOpen) {
      setPathInput(filePath || '');
      setLanguage('en');
      setSearchName('');
      setResults([]);
      setSelectedFileId(null);
      setError(null);
      setMessage(null);
    }
  }, [isOpen, filePath]);

  if (!isOpen) return null;

  async function handleSearch(e) {
    e && e.preventDefault();
    setError(null);
    setMessage(null);

    if (!searchName) {
      setError('Search name is required.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/subtitles/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: pathInput,
          searchName,
          language
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'Search failed');
      }
      setResults(json.results || []);
      if ((json.results || []).length === 0) setMessage('No subtitles found.');
    } catch (err) {
      setError(err.message || 'Search error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setError(null);
    setMessage(null);
    if (!selectedFileId) {
      setError('Select a subtitle file to download.');
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch('http://localhost:3001/subtitles/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: pathInput,
          fileId: selectedFileId
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Download failed');
      setMessage(`Downloaded: ${json.path}`);
    } catch (err) {
      setError(err.message || 'Download error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="sub-modal-backdrop" onMouseDown={onClose}>
      <div className="sub-modal" onMouseDown={e => e.stopPropagation()}>
        <header className="sub-modal-header">
          <h3>Download Subtitles</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <form className="sub-form" onSubmit={handleSearch}>
          <label>
            Path (absolute)
            <input
              type="text"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              placeholder="/home/user/Videos/movie.mkv"
              required
            />
          </label>

          <label>
            Language
            <input
              type="text"
              value={language}
              onChange={e => setLanguage(e.target.value)}
              placeholder="en"
            />
          </label>

          <label>
            Search name (required)
            <input
              type="text"
              value={searchName}
              onChange={e => setSearchName(e.target.value)}
              placeholder="Movie Title S01E02 or Movie Title 2020"
              required
            />
          </label>

          <div className="actions-row">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
            <button type="button" className="btn" onClick={() => { setResults([]); setSelectedFileId(null); }}>
              Clear
            </button>
          </div>
        </form>

        <section className="results">
          <h4>Results</h4>
          {error && <div className="error">{error}</div>}
          {message && <div className="message">{message}</div>}

          <div className="results-list">
            {results.map((r) => (
              <div key={r.subtitle_id} className={`result-row ${selectedFileId === (r.files?.[0]?.file_id || r.subtitle_id) ? 'selected' : ''}`}>
                <div className="result-meta">
                  <div className="title">{r.release || r.raw?.attributes?.release || r.raw?.attributes?.feature_details?.title || 'Unknown'}</div>
                  <div className="sub-info">
                    <span>{r.language}</span>
                    <span>{r.download_count ? `${r.download_count} downloads` : ''}</span>
                    <span>{r.year || ''}</span>
                    {r.hearing_impaired ? <span>HI</span> : null}
                  </div>
                </div>

                <div className="file-list">
                  {(r.files || []).map(f => (
                    <label key={f.file_id} className="file-item">
                      <input
                        type="radio"
                        name="selectedSubtitle"
                        value={f.file_id}
                        checked={selectedFileId === f.file_id}
                        onChange={() => setSelectedFileId(f.file_id)}
                      />
                      <span className="file-name">{f.file_name || `(id: ${f.file_id})`}</span>
                    </label>
                  ))}

                  {/* fallback if no files: allow selecting subtitle_id */}
                  {(!r.files || r.files.length === 0) && (
                    <label className="file-item">
                      <input
                        type="radio"
                        name="selectedSubtitle"
                        value={r.subtitle_id}
                        checked={selectedFileId === r.subtitle_id}
                        onChange={() => setSelectedFileId(r.subtitle_id)}
                      />
                      <span className="file-name">Use subtitle id {r.subtitle_id}</span>
                    </label>
                  )}
                </div>
              </div>
            ))}
            {results.length === 0 && !loading && <div className="empty">No results to show.</div>}
          </div>
        </section>

        <footer className="sub-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleDownload} disabled={downloading || !selectedFileId}>
            {downloading ? 'Downloading...' : 'Download Selected'}
          </button>
        </footer>
      </div>
    </div>
  );
}
