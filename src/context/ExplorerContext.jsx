import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo
} from 'react';

const LS_KEY = 'media_utils_explorer_v1';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function makeId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function itemKey(root, rel) {
  return `${root}::${rel}`;
}

function parseKey(k) {
  const i = k.indexOf('::');
  if (i < 0) return null;
  return { root: k.slice(0, i), rel: k.slice(i + 2) };
}

const ExplorerContext = createContext(null);

export function ExplorerProvider({ children }) {
  const persisted = loadPersisted();
  const initialTabs =
    persisted?.tabs?.length > 0
      ? persisted.tabs
      : [{ id: makeId(), rootPath: '', sort: 'name', sortDir: 'asc', searchQuery: '' }];
  const [tabs, setTabs] = useState(() => initialTabs);
  const [activeTabId, setActiveTabId] = useState(() => {
    if (persisted?.activeTabId && initialTabs.some(t => t.id === persisted.activeTabId)) {
      return persisted.activeTabId;
    }
    return initialTabs[0].id;
  });
  const [favorites, setFavorites] = useState(() => persisted?.favorites || []);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [clipboard, setClipboard] = useState(null);
  const [preview, setPreview] = useState(null);

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) || tabs[0],
    [tabs, activeTabId]
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          tabs,
          activeTabId,
          favorites
        })
      );
    } catch {
      /* ignore */
    }
  }, [tabs, activeTabId, favorites]);

  const updateTab = useCallback((tabId, patch) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, ...patch } : t)));
  }, []);

  const addTab = useCallback(() => {
    const id = makeId();
    setTabs(prev => [
      ...prev,
      {
        id,
        rootPath: activeTab?.rootPath || '',
        sort: 'name',
        sortDir: 'asc',
        searchQuery: ''
      }
    ]);
    setActiveTabId(id);
  }, [activeTab?.rootPath]);

  const removeTab = useCallback(
    tabId => {
      setTabs(prev => {
        if (prev.length <= 1) return prev;
        const next = prev.filter(t => t.id !== tabId);
        if (tabId === activeTabId) setActiveTabId(next[0].id);
        return next;
      });
    },
    [activeTabId]
  );

  const toggleFavorite = useCallback(path => {
    const p = path.trim();
    if (!p) return;
    setFavorites(prev => {
      if (prev.includes(p)) return prev.filter(x => x !== p);
      return [p, ...prev].slice(0, 50);
    });
  }, []);

  const selectOnly = useCallback((root, rel) => {
    setSelectedKeys([itemKey(root, rel)]);
  }, []);

  const toggleSelect = useCallback((root, rel) => {
    const k = itemKey(root, rel);
    setSelectedKeys(prev => (prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]));
  }, []);

  const selectRange = useCallback((keysInOrder, anchorKey, endKey) => {
    const a = keysInOrder.indexOf(anchorKey);
    const b = keysInOrder.indexOf(endKey);
    if (a < 0 || b < 0) return;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const slice = keysInOrder.slice(lo, hi + 1);
    setSelectedKeys(slice);
  }, []);

  const selectAllKeys = useCallback(keys => {
    setSelectedKeys(keys);
  }, []);

  const clearSelection = useCallback(() => setSelectedKeys([]), []);

  const copySelection = useCallback(() => {
    const items = selectedKeys.map(parseKey).filter(Boolean);
    if (!items.length) return;
    setClipboard({ mode: 'copy', items });
  }, [selectedKeys]);

  const cutSelection = useCallback(() => {
    const items = selectedKeys.map(parseKey).filter(Boolean);
    if (!items.length) return;
    setClipboard({ mode: 'cut', items });
  }, [selectedKeys]);

  const clearClipboard = useCallback(() => setClipboard(null), []);

  const value = useMemo(
    () => ({
      tabs,
      setTabs,
      activeTabId,
      setActiveTabId,
      activeTab,
      updateTab,
      addTab,
      removeTab,
      favorites,
      toggleFavorite,
      selectedKeys,
      setSelectedKeys,
      selectOnly,
      toggleSelect,
      selectRange,
      selectAllKeys,
      clearSelection,
      clipboard,
      setClipboard,
      copySelection,
      cutSelection,
      clearClipboard,
      preview,
      setPreview
    }),
    [
      tabs,
      activeTabId,
      activeTab,
      updateTab,
      addTab,
      removeTab,
      favorites,
      toggleFavorite,
      selectedKeys,
      selectOnly,
      toggleSelect,
      selectRange,
      selectAllKeys,
      clearSelection,
      clipboard,
      copySelection,
      cutSelection,
      clearClipboard,
      preview
    ]
  );

  return <ExplorerContext.Provider value={value}>{children}</ExplorerContext.Provider>;
}

export function useExplorer() {
  const ctx = useContext(ExplorerContext);
  if (!ctx) throw new Error('useExplorer requires provider');
  return ctx;
}

export { parseKey };
