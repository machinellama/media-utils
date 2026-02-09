// src/App.jsx
import React, { useState } from 'react';
import './styles.css';
import SplicePage from './components/SplicePage';
import CombinePage from './components/CombinePage';
import WatchPage from './components/WatchPage';

export default function App(){
  const [page, setPage] = useState('watch');
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>FinallyVideo</h1>
        <nav className="tabs">
          <button className={page==='watch'?'active':''} onClick={()=>setPage('watch')}>Watch</button>
          <button className={page==='splice'?'active':''} onClick={()=>setPage('splice')}>Splice</button>
          <button className={page==='combine'?'active':''} onClick={()=>setPage('combine')}>Combine</button>
        </nav>
      </header>
      <main className="app-main">
        {page==='splice' && <SplicePage/>}
        {page==='combine' && <CombinePage/>}
        {page==='watch' && <WatchPage/>}
      </main>
    </div>
  );
}
