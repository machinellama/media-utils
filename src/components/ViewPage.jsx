import React, { useState, useEffect, useRef } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Dropdown, Button } from 'finallyreact';

import './view.css';

const HISTORY_LIMIT = 10;
const BASE_URL = 'http://localhost:3001/view';
const ZOOM_STEP = 0.15;
const MIN_ZOOM = 1;
const MAX_ZOOM = 30;

export default function ImagePage() {
  const [rootPath, setRootPath] = useState(localStorage.getItem('img_root') || '');
  const [history, setHistory] = useState(JSON.parse(localStorage.getItem('img_history') || '[]'));
  const [images, setImages] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [viewMode, setViewMode] = useState('grid');

  // Cropping States
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [newFileName, setNewFileName] = useState('');

  // Zoom States
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const activeThumbnailRef = useRef(null);
  const imgRef = useRef(null);
  const detailViewRef = useRef(null);
  const imageContainerRef = useRef(null);

  useEffect(() => {
    if (viewMode === 'detail' && activeThumbnailRef.current) {
      activeThumbnailRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [selectedIndex, viewMode]);

  // Reset zoom when changing images or exiting detail view
  useEffect(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [selectedIndex, viewMode]);

  const getImgUrl = (path, isThumb = false) => {
    const type = isThumb ? 'thumbnail' : 'file';
    return `${BASE_URL}/${type}?folder=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(path)}`;
  };

  const scanFolder = async (pathOverride) => {
    const target = pathOverride || rootPath;
    if (!target) return;
    try {
      const res = await fetch(`${BASE_URL}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: target })
      });
      const data = await res.json();
      if (data.images) {
        setImages(data.images);
        const newHistory = [target, ...history.filter(h => h !== target)].slice(0, HISTORY_LIMIT);
        setHistory(newHistory);
        localStorage.setItem('img_history', JSON.stringify(newHistory));
        localStorage.setItem('img_root', target);
      }
    } catch (e) { console.error("Scan error", e); }
  };

  const nextImg = () => {
    setIsCropping(false);
    setSelectedIndex(p => (p + 1) % images.length);
  }
  const prevImg = () => {
    setIsCropping(false);
    setSelectedIndex(p => (p - 1 + images.length) % images.length);
  }

  const handleDelete = async () => {
    const file = images[selectedIndex];
    try {
      await fetch(`${BASE_URL}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: rootPath, file: file.path })
      });
      const updated = images.filter((_, i) => i !== selectedIndex);
      setImages(updated);
      if (updated.length === 0) setViewMode('grid');
      else setSelectedIndex(prev => Math.min(prev, updated.length - 1));
    } catch (e) { alert("Delete failed"); }
  };

  const saveCrop = async () => {
    if (!completedCrop || !imgRef.current) return alert("Please select a crop area");

    const image = imgRef.current;

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    const actualCrop = {
      x: completedCrop.x * scaleX,
      y: completedCrop.y * scaleY,
      width: completedCrop.width * scaleX,
      height: completedCrop.height * scaleY
    };

    try {
      const res = await fetch(`${BASE_URL}/crop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: rootPath,
          file: images[selectedIndex].path,
          cropArea: actualCrop,
          rotation: rotation,
          newName: newFileName
        })
      });
      if (res.ok) {
        setIsCropping(false);
        scanFolder();
      }
    } catch (e) { alert("Crop failed"); }
  };

  const handleImageClick = () => {
    if (isCropping || zoom === 1) {
      setZoom(zoom === 1 ? 2 : 1);
      setPanX(0);
      setPanY(0);
    }
  };

  const handleWheel = (e) => {
    if (isCropping) return;
    e.preventDefault();
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)));
    setZoom(newZoom);
  };

  const handleMouseDown = (e) => {
    if (isCropping || zoom === 1) return;
    e.preventDefault();
    setIsPanning(true);
    setPanStart({ x: e.clientX - panX, y: e.clientY - panY });
  };

  const handleMouseMove = (e) => {
    if (!isPanning || isCropping) return;
    e.preventDefault();
    setPanX(e.clientX - panStart.x);
    setPanY(e.clientY - panStart.y);
  };

  const handleMouseUp = (e) => {
    if (isPanning) {
      e.preventDefault();
    }
    setIsPanning(false);
  };

  const resetZoom = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  return (
    <div className="image-page-container">
      <header className="image-header">
        {viewMode === 'grid' ? (
          <div className="flex">
            <Dropdown
              className="cloud-3 stone-10-bg w-full mr-1/2"
              color="green-7"
              textInputProps={{
                outline: false,
                inputProps: { className: 'min-w-30 w-full stone-10-bg cloud-3' },
                className: 'stone-10-bg cloud-3 min-w-30 w-full',
                dropdownArrowProps: { className: 'green-7' }
              }}
              optionContainerProps={{
                className: 'stone-10 w-fit'
              }}
              size="sm"
              options={history.map(h => ({ value: h, label: h }))}
              onSearch={(e) => {
                e?.stopPropagation();
                setRootPath(e.target.value)
              }}
              onChange={(e) => {
                setRootPath(e.target.value)
              }}
              value={rootPath}
            />
            <Button className="cloud-3 mr-1/2" color="stone-10" onClick={() => scanFolder()} text="View" size="sm" />
            <Button className="cloud-3" color="stone-10" onClick={() => {
              if (images.length) {
                setSelectedIndex(Math.floor(Math.random() * images.length));
                setViewMode('detail');
              }
            }} text="Random" size="sm" />
          </div>
        ) : (
          <>
            <div className="button-group">
              <button className="btn btn-ghost" onClick={() => { setViewMode('grid'); setIsCropping(false); }}>← Back</button>
              {!isCropping && (
                <>
                  <button className="btn btn-ghost" onClick={prevImg}>Prev</button>
                  <button className="btn btn-ghost" onClick={nextImg}>Next</button>
                </>
              )}
            </div>

            <div style={{ flex: 1, textAlign: 'center', fontSize: '13px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isCropping ? "Edit Mode" : images[selectedIndex]?.name}
            </div>

            <div className="button-group">
              {!isCropping ? (
                <>
                  {zoom !== 1 && (
                    <button className="btn btn-ghost" onClick={resetZoom}>Reset Zoom</button>
                  )}
                  <Button className="cloud-3" color="stone-10" onClick={() => {
                    if (images.length) {
                      setSelectedIndex(Math.floor(Math.random() * images.length));
                      setViewMode('detail');
                    }
                  }} text="Random" size="sm" />
                  <button className="btn btn-ghost" onClick={() => {
                    const cur = images[selectedIndex].path;
                    const parts = cur.split('.');
                    const ext = parts.pop();
                    setNewFileName(`${parts.join('.')}_cropped.${ext}`);
                    setRotation(0);
                    setCrop(undefined);
                    setIsCropping(true);
                  }}>Crop</button>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
                </>
              ) : (
                <>
                  <input className="filename-input" value={newFileName} onChange={e => setNewFileName(e.target.value)} placeholder="New filename" />
                  <button className="btn btn-success" onClick={saveCrop}>Save</button>
                  <button className="btn btn-ghost" onClick={() => setIsCropping(false)}>Cancel</button>
                </>
              )}
            </div>
          </>
        )}
      </header>

      {viewMode === 'grid' ? (
        <div className="image-grid">
          {images.map((img, idx) => (
            <div key={img.path} className="grid-item" onClick={() => { setSelectedIndex(idx); setViewMode('detail'); }}>
              <img src={getImgUrl(img.path, true)} alt="" loading="lazy" />
              <div className="grid-item-label">{img.name}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="detail-view">
          <div
            className="main-image-viewport"
            ref={detailViewRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'pointer',
              userSelect: 'none',
              WebkitUserSelect: 'none'
            }}
          >
            {isCropping ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxHeight: '100%', width: '100%' }}>
                <ReactCrop
                  crop={crop}
                  onChange={c => setCrop(c)}
                  onComplete={c => setCompletedCrop(c)}
                >
                  <img
                    ref={imgRef}
                    src={getImgUrl(images[selectedIndex].path)}
                    alt="Crop target"
                    style={{
                      maxHeight: '75vh',
                      maxWidth: '100%',
                      transform: `rotate(${rotation}deg)`
                    }}
                  />
                </ReactCrop>

                <div className="crop-controls-overlay">
                  <div className="control-row">
                    <label>Rotate</label>
                    <input type="range" min="0" max="360" step="1" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
                  </div>
                </div>
              </div>
            ) : (
              <div
                ref={imageContainerRef}
                onClick={handleImageClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  overflow: 'hidden',
                  userSelect: 'none',
                  WebkitUserSelect: 'none'
                }}
              >
                <img
                  src={getImgUrl(images[selectedIndex].path)}
                  alt=""
                  draggable={false}
                  style={{
                    transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
                    transformOrigin: 'center',
                    transition: isPanning ? 'none' : 'transform 0.2s ease-out',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    pointerEvents: isPanning ? 'none' : 'auto'
                  }}
                />
              </div>
            )}
          </div>

          <div className="carousel-bar">
            {images.map((img, idx) => (
              <div
                key={img.path}
                ref={idx === selectedIndex ? activeThumbnailRef : null}
                className={`carousel-item ${idx === selectedIndex ? 'active' : ''}`}
                onClick={() => { setSelectedIndex(idx); setIsCropping(false); }}
              >
                <img src={getImgUrl(img.path, true)} alt="" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
