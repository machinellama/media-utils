import React, { useState, useEffect, useRef } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Dropdown, Button } from 'finallyreact';

import './view.css';

const HISTORY_LIMIT = 10;
const BASE_URL = 'http://localhost:3001/view';

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
  
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const activeThumbnailRef = useRef(null);
  const imgRef = useRef(null); // Ref for the image to calculate scale

  useEffect(() => {
    if (viewMode === 'detail' && activeThumbnailRef.current) {
      activeThumbnailRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
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
      setShowDeleteModal(false);
      if (updated.length === 0) setViewMode('grid');
      else setSelectedIndex(prev => Math.min(prev, updated.length - 1));
    } catch (e) { alert("Delete failed"); }
  };

  const saveCrop = async () => {
    if (!completedCrop || !imgRef.current) return alert("Please select a crop area");

    const image = imgRef.current;
    
    // Calculate the scale between display size and natural size
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    // Adjust coordinates for the actual image resolution
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

  return (
    <div className="image-page-container">
      <header className="image-header">
        {viewMode === 'grid' ? (
          <div className="flex">
            <Dropdown
              className="cloud-3 stone-10-bg w-full mr-1/2"
              showClear={false}
              color="green-7"
              textInputProps={{
                showClear: true,
                outline: false,
                inputProps: { className: 'min-w-30 w-full stone-10-bg cloud-3' },
                className: 'stone-10-bg cloud-3 min-w-30 w-full',
                dropdownArrowProps: { className: 'green-7' }
              }}
              size="sm"
              options={history.map(h => ({ value: h, label: h }))}
              onChange={(e) => setRootPath(e.target.value)}
              value={rootPath}
            />
            <Button className="cloud-3 mr-1/2" color="stone-10" onClick={() => scanFolder()} text="Search" size="sm" />
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
                  <button className="btn btn-ghost" onClick={() => {
                    const cur = images[selectedIndex].path;
                    const parts = cur.split('.');
                    const ext = parts.pop();
                    setNewFileName(`${parts.join('.')}_cropped.${ext}`);
                    setRotation(0);
                    setCrop(undefined); 
                    setIsCropping(true);
                  }}>Crop</button>
                  <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>Delete</button>
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
          <div className="main-image-viewport">
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
              <img src={getImgUrl(images[selectedIndex].path)} alt="" />
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

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{marginTop:0}}>Delete?</h3>
            <p>Move this image to trash?</p>
            <div className="button-group" style={{justifyContent: 'center', marginTop: '20px'}}>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
              <button className="btn btn-ghost" onClick={() => setShowDeleteModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}