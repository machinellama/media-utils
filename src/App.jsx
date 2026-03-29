// src/App.jsx
import React, { useState } from 'react';
import SplicePage from './components/SplicePage';
import CombinePage from './components/CombinePage';
import WatchPage from './components/WatchPage';

import { Button, classnames } from 'finallyreact';

import 'finallyreact/main.css';
import './styles.css';

export default function App() {
  const [page, setPage] = useState('watch');
  const [selectedVideoURL, setSelectedVideoURL] = useState(null);
  const [selectedVideoName, setSelectedVideoName] = useState(null);

  function getButton(name) {
    const active = name === page;

    return (
      <Button
        className={classnames('w-fit mb-1/2', active ? 'cloud-10' : 'cloud-3')}
        onClick={() => setPage(name)}
        text={name}
        size="sm"
        rounded={true}
        color={name === page ? 'sky-4' : 'cloud-10'}
      />
    )
  }

  return (
    <div className="gray-10-bg flex p-1/4">
      <div className="block w-min-content ml-1/4 mr-1/2">
        <div className="semibold mb-1/4 cloud-3">Video</div>
        {getButton('watch')}
        {getButton('splice')}
        {getButton('combine')}

        <div className="semibold mb-1/4 cloud-3">Images</div>
        {getButton('view')}
      </div>

      <main className="app-main w-full">
        {page === 'splice' && (
          <SplicePage selectedVideoURL={selectedVideoURL} selectedVideoName={selectedVideoName} />
        )}
        {page === 'combine' && (
          <CombinePage />
        )}
        {page === 'watch' && (
          <WatchPage setSelectedVideoURL={(url, name) => {
            setSelectedVideoURL(url);
            setSelectedVideoName(name);
            setPage('splice');
          }} />
        )}
      </main>
    </div>
  );
}
