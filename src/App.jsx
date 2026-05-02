import React from 'react';
import { ExplorerProvider } from '@/context/ExplorerContext';
import ExplorerApp from '@/components/explorer/ExplorerApp';

export default function App() {
  return (
    <ExplorerProvider>
      <ExplorerApp />
    </ExplorerProvider>
  );
}
