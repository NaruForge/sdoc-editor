import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { EditorProvider, useEditorContext } from './context/EditorContext';
import { Editor } from './components/Editor';
import { createTauriAdapter } from './adapters/tauriMessaging';
import type { JSONContent } from '@tiptap/react';
import type { DocumentSettings, SdocMeta } from '@shared/types';
import type { EditorSettings } from './context/EditorContext';

type AppView = 'welcome' | 'editor' | 'json';

export interface ExplorerEntry {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  depth: number;
}

interface OpenDocumentResult {
  doc: JSONContent;
  meta: SdocMeta;
  filePath: string;
}

const DOC_SETTING_KEYS: (keyof EditorSettings & keyof DocumentSettings)[] = [
  'headingNumbering',
  'headingDecoration',
  'headingH1Color',
  'headingH2Color',
  'headingH3Color',
  'captionStyle',
  'captionNumbering',
  'equationNumbering',
  'crossRefIncludeCaption',
  'pdfScale',
  'selfContained',
  'slideBreakLevel',
  'slideTransition',
  'showTitleSlide',
  'outputDir',
];

function toEditorSettingsPatch(settings: Partial<DocumentSettings> | null | undefined): Partial<EditorSettings> {
  const patch: Partial<EditorSettings> = {};
  if (!settings) {
    return patch;
  }
  for (const key of DOC_SETTING_KEYS) {
    const value = settings[key];
    if (value !== undefined) {
      patch[key] = value as never;
    }
  }
  return patch;
}

function getDialogPath(selected: string | string[] | null): string | null {
  if (typeof selected === 'string') {
    return selected;
  }
  return selected?.[0] ?? null;
}

const AppContent: React.FC = () => {
  const { dispatch } = useEditorContext();
  const [view, setView] = useState<AppView>('welcome');
  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [meta, setMeta] = useState<SdocMeta | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [recentErrors, setRecentErrors] = useState<Record<string, string>>({});
  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [workspaceEntries, setWorkspaceEntries] = useState<ExplorerEntry[]>([]);
  const [jsonContent, setJsonContent] = useState('');

  const adapter = useMemo(() => createTauriAdapter(), []);

  const loadWorkspace = useCallback(async (folder?: string | null) => {
    const target = folder ?? workspaceFolder;
    if (!target) {
      setWorkspaceEntries([]);
      return;
    }
    const entries = await invoke<ExplorerEntry[]>('list_folder_documents', { folder: target });
    setWorkspaceFolder(target);
    setWorkspaceEntries(entries);
  }, [workspaceFolder]);

  const loadDocument = useCallback(async (path: string, options: { fromRecent?: boolean } = {}) => {
    try {
      const result = await invoke<OpenDocumentResult>('open_document', { path });
      setDoc(result.doc);
      setMeta(result.meta);
      setCurrentPath(result.filePath);
      setView('editor');

      const editorSettings = await invoke<Partial<EditorSettings>>('get_editor_settings');
      const docSettings = result.meta.settings ?? null;
      dispatch({ type: 'SET_DOC_SETTINGS', payload: docSettings });
      dispatch({ type: 'SET_SETTINGS', payload: { ...editorSettings, ...toEditorSettingsPatch(docSettings) } });

      // Start watching drawio directory
      await invoke('start_file_watcher').catch((error: unknown) => {
        console.warn('Failed to start file watcher', error);
      });
      const folder = result.filePath.split(/[\\/]/).slice(0, -1).join('/');
      if (folder) {
        setWorkspaceFolder(folder);
        await loadWorkspace(folder).catch((error: unknown) => {
          console.warn('Failed to refresh workspace', error);
        });
      }
      setRecentErrors(prev => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    } catch (e: unknown) {
      console.error('Failed to open document:', e);
      if (options.fromRecent) {
        setRecentErrors(prev => ({ ...prev, [path]: String(e) }));
      }
      alert(`문서를 열 수 없습니다: ${e}`);
    }
  }, [dispatch, loadWorkspace]);

  const handleNew = useCallback(async () => {
    const path = await save({
      filters: [{ name: 'Structured Document', extensions: ['sdoc'] }],
    });
    if (path) {
      const result = await invoke<OpenDocumentResult>('new_document', { path });
      setDoc(result.doc);
      setMeta(result.meta);
      setCurrentPath(result.filePath);
      setView('editor');

      const editorSettings = await invoke<Partial<EditorSettings>>('get_editor_settings');
      dispatch({ type: 'SET_DOC_SETTINGS', payload: result.meta.settings ?? null });
      dispatch({ type: 'SET_SETTINGS', payload: editorSettings });
      await loadWorkspace(result.filePath.split(/[\\/]/).slice(0, -1).join('/')).catch((error: unknown) => {
        console.warn('Failed to refresh workspace', error);
      });
    }
  }, [dispatch, loadWorkspace]);

  const handleOpen = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Structured Document', extensions: ['sdoc', 'tiptap.json'] }],
    });
    const path = getDialogPath(selected);
    if (path) {
      await loadDocument(path);
    }
  }, [loadDocument]);

  const handleSelectFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    const folder = getDialogPath(selected);
    if (!folder) {
      return;
    }
    await invoke('set_current_folder', { path: folder });
    await loadWorkspace(folder);
  }, [loadWorkspace]);

  const handleCreateInFolder = useCallback(async () => {
    if (!workspaceFolder) {
      await handleSelectFolder();
      return;
    }
    const fileName = window.prompt('새 문서 파일 이름', 'untitled.sdoc');
    if (!fileName) {
      return;
    }
    const result = await invoke<OpenDocumentResult>('create_document_in_folder', {
      folder: workspaceFolder,
      fileName,
    });
    setDoc(result.doc);
    setMeta(result.meta);
    setCurrentPath(result.filePath);
    setView('editor');
    const editorSettings = await invoke<Partial<EditorSettings>>('get_editor_settings');
    dispatch({ type: 'SET_DOC_SETTINGS', payload: result.meta.settings ?? null });
    dispatch({ type: 'SET_SETTINGS', payload: editorSettings });
    await loadWorkspace(workspaceFolder);
  }, [dispatch, handleSelectFolder, loadWorkspace, workspaceFolder]);

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
        window.__editorFlushUpdate?.();
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
        const recent = await invoke<string[]>('get_recent_files');
        setRecentFiles(recent);
      } catch (error: unknown) {
        console.warn('Failed to load recent files', error);
      }
      try {
        const folder = await invoke<string | null>('get_current_folder');
        if (folder) {
          await loadWorkspace(folder);
        }
      } catch (error: unknown) {
        console.warn('Failed to load current folder', error);
      }
      // Check if a file was passed as argument
      try {
        const path = await invoke<string | null>('get_current_file_path');
        if (path) {
          await loadDocument(path);
        }
      } catch (error: unknown) {
        console.warn('Failed to load startup document', error);
      }
    })();
  }, [loadDocument, loadWorkspace]);

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
          <p>폴더를 열어 .sdoc / .tiptap.json 문서를 탐색하거나 최근 문서를 이어서 편집하세요.</p>
          <div className="welcome-actions">
            <button className="welcome-btn primary" onClick={handleNew}>새 문서 만들기</button>
            <button className="welcome-btn" onClick={handleOpen}>문서 열기</button>
            <button className="welcome-btn" onClick={handleSelectFolder}>폴더 열기</button>
          </div>
          <div className="welcome-samples">
            <strong>Tip</strong>
            <span>샘플 문서는 폴더를 연 뒤 “새 문서”로 빠르게 만들 수 있습니다. 최근 문서가 이동/삭제되면 오류가 아래에 표시됩니다.</span>
          </div>
          {workspaceFolder && (
            <div className="welcome-workspace">
              <div className="welcome-workspace-header">
                <h3>열린 폴더</h3>
                <button onClick={handleCreateInFolder}>새 문서</button>
              </div>
              <div className="welcome-workspace-path">{workspaceFolder}</div>
              {workspaceEntries.filter(entry => entry.kind === 'file').length === 0 ? (
                <div className="welcome-workspace-empty">문서가 없습니다. 새 문서를 만들어 시작하세요.</div>
              ) : (
                <ul>
                  {workspaceEntries.filter(entry => entry.kind === 'file').map(entry => (
                    <li key={entry.path}>
                      <button className="recent-file-btn" onClick={() => loadDocument(entry.path)}>
                        {entry.name}
                        <span className="recent-file-path">{entry.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {recentFiles.length > 0 && (
            <div className="welcome-recent">
              <h3>최근 문서</h3>
              <ul>
                {recentFiles.map((file, i) => (
                  <li key={i}>
                    <button className="recent-file-btn" onClick={() => loadDocument(file, { fromRecent: true })}>
                      {file.split(/[\\/]/).pop()}
                      <span className="recent-file-path">{file}</span>
                      {recentErrors[file] && <span className="recent-file-error">열기 실패: {recentErrors[file]}</span>}
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

  return <Editor
    key={currentPath ?? 'untitled'}
    adapter={adapter}
    initialDoc={doc}
    initialMeta={meta}
    currentPath={currentPath}
    workspaceFolder={workspaceFolder}
    workspaceEntries={workspaceEntries}
    onSelectFolder={handleSelectFolder}
    onCreateInFolder={handleCreateInFolder}
    onOpenWorkspaceFile={(path) => loadDocument(path)}
    onRefreshWorkspace={() => loadWorkspace()}
    onJsonView={handleJsonView}
  />;
};

const App: React.FC = () => {
  return (
    <EditorProvider>
      <AppContent />
    </EditorProvider>
  );
};

export default App;
