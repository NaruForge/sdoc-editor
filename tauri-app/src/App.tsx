import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { EditorProvider, useEditorContext } from './context/EditorContext';
import { Editor } from './components/Editor';
import { createTauriAdapter, type TauriAdapter } from './adapters/tauriMessaging';

type AppView = 'welcome' | 'editor' | 'json';

const AppContent: React.FC = () => {
  const { dispatch } = useEditorContext();
  const [view, setView] = useState<AppView>('welcome');
  const [doc, setDoc] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [jsonContent, setJsonContent] = useState('');

  const adapter = useMemo(() => createTauriAdapter(), []);

  const loadDocument = useCallback(async (path: string) => {
    try {
      const result: any = await invoke('open_document', { path });
      setDoc(result.doc);
      setMeta(result.meta);
      setView('editor');

      const editorSettings: any = await invoke('get_editor_settings');
      dispatch({ type: 'SET_SETTINGS', payload: editorSettings });

      // Start watching drawio directory
      await invoke('start_file_watcher').catch(() => {});
    } catch (e: any) {
      console.error('Failed to open document:', e);
      alert(`문서를 열 수 없습니다: ${e}`);
    }
  }, [dispatch]);

  const handleNew = useCallback(async () => {
    const path = await save({
      filters: [{ name: 'Structured Document', extensions: ['sdoc'] }],
    });
    if (path) {
      const result: any = await invoke('new_document', { path });
      setDoc(result.doc);
      setMeta(result.meta);
      setView('editor');

      const editorSettings: any = await invoke('get_editor_settings');
      dispatch({ type: 'SET_SETTINGS', payload: editorSettings });
    }
  }, [dispatch]);

  const handleOpen = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Structured Document', extensions: ['sdoc', 'tiptap.json'] }],
    });
    if (selected) {
      const path = typeof selected === 'string' ? selected : (selected as any).path;
      await loadDocument(path);
    }
  }, [loadDocument]);

  const handleJsonView = useCallback(async () => {
    const path: string | null = await invoke('get_current_file_path');
    if (path) {
      const text: string = await invoke('read_import_file', { path });
      setJsonContent(text);
      setView('json');
    }
  }, []);

  // Listen for menu events from Rust backend
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    (async () => {
      unlisteners.push(await listen('menu-new', () => handleNew()));
      unlisteners.push(await listen('menu-open', () => handleOpen()));
      unlisteners.push(await listen('menu-save', () => {
        (window as any).__editorFlushUpdate?.();
      }));
      // File dropped or opened via CLI
      unlisteners.push(await listen<string[]>('tauri://file-drop', async (event) => {
        const files = event.payload;
        if (files.length > 0) {
          await loadDocument(files[0]);
        }
      }));
    })();
    return () => { unlisteners.forEach(u => u()); };
  }, [handleNew, handleOpen, loadDocument]);

  // Check for CLI argument (file path passed on launch)
  useEffect(() => {
    (async () => {
      try {
        const recent: string[] = await invoke('get_recent_files');
        setRecentFiles(recent);
      } catch {}
      // Check if a file was passed as argument
      try {
        const currentPath: string | null = await invoke('get_current_file_path');
        if (currentPath) {
          await loadDocument(currentPath);
        }
      } catch {}
    })();
  }, [loadDocument]);

  if (view === 'json') {
    return (
      <div className="json-viewer">
        <div className="json-viewer-toolbar">
          <button onClick={() => setView('editor')}>← 편집기로 돌아가기</button>
          <button onClick={() => navigator.clipboard.writeText(jsonContent)}>복사</button>
        </div>
        <pre className="json-viewer-content">{jsonContent}</pre>
      </div>
    );
  }

  if (view === 'welcome' || !doc) {
    return (
      <div className="welcome-screen">
        <div className="welcome-content">
          <h1>Structured Doc Editor</h1>
          <p>구조화 문서 편집기</p>
          <div className="welcome-actions">
            <button className="welcome-btn primary" onClick={handleNew}>새 문서 만들기</button>
            <button className="welcome-btn" onClick={handleOpen}>문서 열기</button>
          </div>
          {recentFiles.length > 0 && (
            <div className="welcome-recent">
              <h3>최근 문서</h3>
              <ul>
                {recentFiles.map((file, i) => (
                  <li key={i}>
                    <button className="recent-file-btn" onClick={() => loadDocument(file)}>
                      {file.split(/[\\/]/).pop()}
                      <span className="recent-file-path">{file}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <Editor adapter={adapter} initialDoc={doc} initialMeta={meta} onJsonView={handleJsonView} />;
};

const App: React.FC = () => {
  return (
    <EditorProvider>
      <AppContent />
    </EditorProvider>
  );
};

export default App;
