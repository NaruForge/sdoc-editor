import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { EditorProvider, useEditorContext } from '@shared/editor/context/EditorContext';
import { Editor } from './components/Editor';
import { createTauriAdapter } from './adapters/tauriMessaging';
import type { SdocMeta, TiptapNode } from '@shared/types';
import { migrateAttributes } from '@shared/document/sdocUtils';
import { parseDocumentContract, validateDocumentSettings } from '@shared/document/documentContract';
import { ConfirmDialog } from './components/ConfirmDialog';
import { UndoToast } from './components/UndoToast';
import { resolveTauriEditorSettings } from './settingsAdapter';
import { closeTauriApplication, createCloseRequestHandler } from './applicationLifecycle';

type AppView = 'welcome' | 'editor' | 'json';

export interface ExplorerEntry {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  depth: number;
  /** True for `.sdoc`/`.tiptap.json` files openable directly in the editor. Other files
   *  (images, drawio sources, etc.) must be opened with the system's default application. */
  isDocument: boolean;
}

interface OpenDocumentResult {
  doc: TiptapNode;
  meta: SdocMeta;
  filePath: string;
  documentId: string;
  revision: number;
}

function getDialogPath(selected: string | string[] | null): string | null {
  if (typeof selected === 'string') {
    return selected;
  }
  return selected?.[0] ?? null;
}

/** 경로 비교를 위해 슬래시를 통일하고 대소문자를 무시하도록 정규화한다. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** filePath가 folder 내부(임의 depth의 하위 경로 포함)에 있는지 확인한다. */
function isPathInsideFolder(filePath: string, folder: string): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedFolder = normalizePath(folder);
  return normalizedFile === normalizedFolder || normalizedFile.startsWith(`${normalizedFolder}/`);
}

const AppContent: React.FC = () => {
  const { dispatch } = useEditorContext();
  const [view, setView] = useState<AppView>('welcome');
  const [doc, setDoc] = useState<TiptapNode | null>(null);
  const [meta, setMeta] = useState<SdocMeta | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [recentErrors, setRecentErrors] = useState<Record<string, string>>({});
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [recentFolderErrors, setRecentFolderErrors] = useState<Record<string, string>>({});
  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [workspaceEntries, setWorkspaceEntries] = useState<ExplorerEntry[]>([]);
  const [jsonContent, setJsonContent] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ExplorerEntry | null>(null);
  const [undoInfo, setUndoInfo] = useState<{ message: string } | null>(null);
  const [hasDeletionHistory, setHasDeletionHistory] = useState(false);

  // loadDocument 내부에서 최신 workspaceFolder 값을 참조하기 위한 ref.
  // loadDocument의 useCallback deps에 workspaceFolder를 직접 넣으면 폴더 전환마다
  // 이 콜백을 구독하는 다른 effect(menu-open 등)가 재구독되므로 ref로 우회한다.
  const workspaceFolderRef = useRef(workspaceFolder);
  useEffect(() => {
    workspaceFolderRef.current = workspaceFolder;
  }, [workspaceFolder]);

  const adapter = useMemo(() => createTauriAdapter(), []);
  const closeApplication = useCallback(async () => {
    const { exit } = await import('@tauri-apps/plugin-process');
    await closeTauriApplication({
      flush: () => adapter.flushAndWait(),
      stopWatchers: () => invoke('stop_file_watcher'),
      exit: () => exit(0),
    });
  }, [adapter]);

  useEffect(() => () => adapter.dispose(), [adapter]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const handleCloseRequest = createCloseRequestHandler(closeApplication, (error) => {
      alert(`Unable to close because the document could not be saved: ${String(error)}`);
    });
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const registeredUnlisten = await window.onCloseRequested(handleCloseRequest);
      if (cancelled) registeredUnlisten();
      else unlisten = registeredUnlisten;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [adapter, closeApplication]);

  const loadWorkspace = useCallback(async (folder?: string | null) => {
    const target = folder ?? workspaceFolder;
    if (!target) {
      setWorkspaceEntries([]);
      return;
    }
    const entries = await invoke<ExplorerEntry[]>('list_folder_documents', { folder: target });
    setWorkspaceFolder(target);
    setWorkspaceEntries(entries);
    // 워크스페이스 폴더를 감시해, 외부 프로그램(예: draw.io 데스크톱 앱)이나 OS 탐색기에서
    // 파일을 추가/삭제/이름 변경해도 수동 새로고침 없이 사이드바가 자동 갱신되도록 한다.
    // 이미 동일 폴더를 감시 중이면 백엔드에서 no-op 처리되므로 매번 호출해도 무해하다.
    invoke('start_workspace_watcher', { folder: target }).catch((error: unknown) => {
      console.warn('Failed to start workspace watcher', error);
    });
  }, [workspaceFolder]);

  const loadDocument = useCallback(async (path: string, options: { fromRecent?: boolean } = {}) => {
    try {
      await adapter.flushAndWait();
      const result = await invoke<OpenDocumentResult>('open_document', { path });
      const contract = parseDocumentContract({ sdoc: '1.0', meta: result.meta, doc: result.doc });
      if (!contract.ok) {
        throw new Error(contract.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; '));
      }
      adapter.setDocumentSession(result.documentId, result.revision);
      setDoc(contract.envelope.doc);
      setMeta(contract.envelope.meta);
      setCurrentPath(result.filePath);
      setView('editor');

      const nativeSettings: unknown = await invoke('get_editor_settings');
      const docSettings = validateDocumentSettings(contract.envelope.meta.settings)
        ? contract.envelope.meta.settings : null;
      dispatch({ type: 'SET_DOC_SETTINGS', payload: docSettings });
      dispatch({ type: 'SET_SETTINGS', payload: resolveTauriEditorSettings(nativeSettings, docSettings) });

      // Start watching drawio directory
      await invoke('start_file_watcher').catch((error: unknown) => {
        console.warn('Failed to start file watcher', error);
      });
      const folder = result.filePath.split(/[\\/]/).slice(0, -1).join('/');
      const currentWorkspace = workspaceFolderRef.current;
      const isInsideCurrentWorkspace = currentWorkspace ? isPathInsideFolder(result.filePath, currentWorkspace) : false;
      // 이미 열려 있는 워크스페이스 하위 문서를 여는 경우에는 탐색기 루트를 파일의
      // 직속 부모 폴더로 좁히지 않고 기존 워크스페이스 루트를 그대로 유지한다.
      if (folder && !isInsideCurrentWorkspace) {
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
  }, [adapter, dispatch, loadWorkspace]);

  const handleNew = useCallback(async () => {
    await adapter.flushAndWait();
    const path = await save({
      filters: [{ name: 'Structured Document', extensions: ['sdoc'] }],
    });
    if (path) {
      const result = await invoke<OpenDocumentResult>('new_document', { path });
      adapter.setDocumentSession(result.documentId, result.revision);
      setDoc(migrateAttributes(result.doc));
      setMeta(result.meta);
      setCurrentPath(result.filePath);
      setView('editor');

      const nativeSettings: unknown = await invoke('get_editor_settings');
      const docSettings = validateDocumentSettings(result.meta.settings) ? result.meta.settings : null;
      dispatch({ type: 'SET_DOC_SETTINGS', payload: docSettings });
      dispatch({ type: 'SET_SETTINGS', payload: resolveTauriEditorSettings(nativeSettings, docSettings) });
      await invoke('start_file_watcher');
      await loadWorkspace(result.filePath.split(/[\\/]/).slice(0, -1).join('/')).catch((error: unknown) => {
        console.warn('Failed to refresh workspace', error);
      });
    }
  }, [adapter, dispatch, loadWorkspace]);

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

  const handleExit = useCallback(async () => {
    await closeApplication();
  }, [closeApplication]);

  const handleSelectFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      const folder = getDialogPath(selected);
      if (!folder) {
        return;
      }
      await invoke('set_current_folder', { path: folder });
      await loadWorkspace(folder);
      invoke<string[]>('get_recent_folders').then(setRecentFolders).catch(() => {});
    } catch (error: unknown) {
      // 다이얼로그/폴더 전환 실패를 조용히 무시하지 않고 사용자에게 알려 원인 파악을 돕는다.
      console.error('Failed to select/open folder:', error);
      alert(`폴더를 여는 중 오류가 발생했습니다: ${error}`);
    }
  }, [loadWorkspace]);

  /** 최근 작업 폴더 목록 항목을 클릭했을 때 해당 폴더를 워크스페이스로 연다. */
  const handleOpenRecentFolder = useCallback(async (folder: string) => {
    try {
      await invoke('set_current_folder', { path: folder });
      await loadWorkspace(folder);
      setRecentFolderErrors(prev => {
        const next = { ...prev };
        delete next[folder];
        return next;
      });
      invoke<string[]>('get_recent_folders').then(setRecentFolders).catch(() => {});
    } catch (error: unknown) {
      setRecentFolderErrors(prev => ({ ...prev, [folder]: String(error) }));
    }
  }, [loadWorkspace]);

  const handleCreateInFolder = useCallback(async (targetFolder?: string) => {
    const folder = targetFolder ?? workspaceFolder;
    if (!folder) {
      await handleSelectFolder();
      return;
    }
    const fileName = window.prompt('새 문서 파일 이름', 'untitled.sdoc');
    if (!fileName) {
      return;
    }
    await adapter.flushAndWait();
    const result = await invoke<OpenDocumentResult>('create_document_in_folder', {
      folder,
      fileName,
    });
    adapter.setDocumentSession(result.documentId, result.revision);
    setDoc(result.doc);
    setMeta(result.meta);
    setCurrentPath(result.filePath);
    setView('editor');
    const nativeSettings: unknown = await invoke('get_editor_settings');
    const docSettings = validateDocumentSettings(result.meta.settings) ? result.meta.settings : null;
    dispatch({ type: 'SET_DOC_SETTINGS', payload: docSettings });
    dispatch({ type: 'SET_SETTINGS', payload: resolveTauriEditorSettings(nativeSettings, docSettings) });
    await invoke('start_file_watcher');
    await loadWorkspace(workspaceFolder ?? folder);
  }, [adapter, dispatch, handleSelectFolder, loadWorkspace, workspaceFolder]);

  const handleRenameEntry = useCallback(async (path: string, newName: string) => {
    try {
      await adapter.flushAndWait();
      const renamed = await invoke<ExplorerEntry>('rename_entry', { path, newName });
      if (currentPath === path) {
        await loadDocument(renamed.path);
      }
      await loadWorkspace(workspaceFolder);
    } catch (e: unknown) {
      alert(`이름을 변경할 수 없습니다: ${e}`);
    }
  }, [adapter, currentPath, loadDocument, loadWorkspace, workspaceFolder]);

  /** 탐색기에서 파일/폴더를 삭제(휴지통으로 이동)한다. 현재 열려 있는 문서(또는 그 하위)를
   *  삭제한 경우 편집기를 닫고 시작 화면으로 돌아가 존재하지 않는 파일에 저장을 시도하는
   *  것을 방지한다. `window.confirm`은 Tauri WebView에서 클릭 전에 즉시 반환되는 경우가 있어
   *  커스텀 확인 모달(pendingDelete state)로 실제 삭제를 수행한다. */
  const handleDeleteEntry = useCallback((entry: ExplorerEntry) => {
    setPendingDelete(entry);
  }, []);

  const performDelete = useCallback(async (entry: ExplorerEntry) => {
    try {
      await adapter.flushAndWait();
      await invoke('delete_entry', { path: entry.path });
      if (currentPath && isPathInsideFolder(currentPath, entry.path)) {
        setDoc(null);
        setMeta(null);
        setCurrentPath(null);
        setView('welcome');
      }
      await loadWorkspace(workspaceFolder);
      setUndoInfo({ message: `'${entry.name}'을(를) 휴지통으로 이동했습니다.` });
      setHasDeletionHistory(true);
    } catch (e: unknown) {
      alert(`삭제할 수 없습니다: ${e}`);
    }
  }, [adapter, currentPath, loadWorkspace, workspaceFolder]);

  const handleConfirmDelete = useCallback(() => {
    if (pendingDelete) {
      const entry = pendingDelete;
      setPendingDelete(null);
      void performDelete(entry);
    }
  }, [pendingDelete, performDelete]);

  /** 가장 최근 삭제를 복원한다. 토스트의 "실행 취소"와 탐색기 우클릭 메뉴의 "삭제 취소"
   *  양쪽에서 공유하는 핸들러. */
  const handleUndoDelete = useCallback(async () => {
    setUndoInfo(null);
    try {
      await invoke('undo_last_delete');
      await loadWorkspace(workspaceFolder);
    } catch (e: unknown) {
      alert(`되돌릴 수 없습니다: ${e}`);
    } finally {
      const remaining = await invoke<boolean>('has_recent_deletions').catch(() => false);
      setHasDeletionHistory(remaining);
    }
  }, [loadWorkspace, workspaceFolder]);

  const handleCreateFolder = useCallback(async (parent: string) => {
    const folderName = window.prompt('새 폴더 이름', 'New Folder');
    if (!folderName) {
      return;
    }
    try {
      await invoke<ExplorerEntry>('create_folder', { parent, folderName });
      await loadWorkspace(workspaceFolder ?? parent);
    } catch (e: unknown) {
      alert(`폴더를 생성할 수 없습니다: ${e}`);
    }
  }, [loadWorkspace, workspaceFolder]);

  const handleJsonView = useCallback(async () => {
    await adapter.flushAndWait();
    const path: string | null = await invoke('get_current_file_path');
    if (path) {
      const text: string = await invoke('read_import_file', { path });
      setJsonContent(text);
      setView('json');
    }
  }, [adapter]);

  // Listen for OS-level events forwarded from the Rust backend
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    (async () => {
      // File dropped or opened via CLI
      unlisteners.push(await listen<string[]>('tauri://file-drop', async (event) => {
        const files = event.payload;
        if (files.length > 0) {
          await loadDocument(files[0]);
        }
      }));
    })();
    return () => { unlisteners.forEach(u => u()); };
  }, [loadDocument]);

  // Check for CLI argument (file path passed on launch)
  // 앱 시작 시 1회만 실행되어야 하는 초기화 로직. loadDocument/loadWorkspace는
  // workspaceFolder state에 의존해 재생성되므로 deps에 넣으면 폴더 전환 시마다
  // 재실행되어 백엔드에 남아있는 "이전 문서 경로"를 다시 열어 방금 선택한 새 폴더를
  // 덮어써버리는 버그가 있었다. ref로 최신 함수를 참조해 마운트 시 1회만 실행한다.
  const loadDocumentRef = useRef(loadDocument);
  const loadWorkspaceRef = useRef(loadWorkspace);
  useEffect(() => {
    loadDocumentRef.current = loadDocument;
    loadWorkspaceRef.current = loadWorkspace;
  }, [loadDocument, loadWorkspace]);

  // 워크스페이스 폴더 하위에서 파일이 생성/삭제/이름 변경되면 백엔드 워커가 debounce된
  // 'workspace-changed' 이벤트를 보낸다 — 외부 프로그램(draw.io 등)이 만든 변경까지
  // 포함해 사이드바를 수동 새로고침 없이 자동 갱신한다(VS Code 탐색기와 동일한 동작).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<{ folder: string }>('workspace-changed', () => {
        loadWorkspaceRef.current().catch((error: unknown) => {
          console.warn('Failed to auto-refresh workspace', error);
        });
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const recent = await invoke<string[]>('get_recent_files');
        setRecentFiles(recent);
      } catch (error: unknown) {
        console.warn('Failed to load recent files', error);
      }
      try {
        const folders = await invoke<string[]>('get_recent_folders');
        setRecentFolders(folders);
      } catch (error: unknown) {
        console.warn('Failed to load recent folders', error);
      }
      try {
        const folder = await invoke<string | null>('get_current_folder');
        if (folder) {
          await loadWorkspaceRef.current(folder);
        }
      } catch (error: unknown) {
        console.warn('Failed to load current folder', error);
      }
      // Check if a file was passed as argument
      try {
        const path = await invoke<string | null>('get_current_file_path');
        if (path) {
          await loadDocumentRef.current(path);
        }
      } catch (error: unknown) {
        console.warn('Failed to load startup document', error);
      }
    })();
  }, []);

  const overlays = (
    <>
      {pendingDelete && (
        <ConfirmDialog
          title="삭제 확인"
          message={pendingDelete.kind === 'folder'
            ? `'${pendingDelete.name}' 폴더와 하위 내용을 모두 휴지통으로 이동할까요?`
            : `'${pendingDelete.name}' 파일을 휴지통으로 이동할까요?`}
          confirmLabel="삭제"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {undoInfo && (
        <UndoToast
          message={undoInfo.message}
          onUndo={handleUndoDelete}
          onDismiss={() => setUndoInfo(null)}
        />
      )}
    </>
  );

  if (view === 'json') {
    return (
      <>
        <div className="json-viewer">
          <div className="json-viewer-toolbar">
            <button onClick={() => setView('editor')}>← 편집기로 돌아가기</button>
            <button onClick={() => navigator.clipboard.writeText(jsonContent)}>복사</button>
          </div>
          <pre className="json-viewer-content">{jsonContent}</pre>
        </div>
        {overlays}
      </>
    );
  }

  if (view === 'welcome' || !doc) {
    return (
      <>
      <div className="welcome-screen">
        <div className="welcome-content">
          <h1>Structured Doc Editor</h1>
          <p>이전에 작업하던 폴더를 이어서 열거나, 새 폴더/문서를 열어 시작하세요.</p>
          <div className="welcome-actions">
            <button className="welcome-btn primary" onClick={handleNew}>새 문서 만들기</button>
            <button className="welcome-btn" onClick={handleOpen}>문서 열기</button>
            <button className="welcome-btn" onClick={handleSelectFolder}>폴더 열기</button>
          </div>
          <div className="welcome-samples">
            <strong>Tip</strong>
            <span>샘플 문서는 폴더를 연 뒤 “새 문서”로 빠르게 만들 수 있습니다. 최근 문서가 이동/삭제되면 오류가 아래에 표시됩니다.</span>
          </div>
          {recentFolders.filter(folder => !workspaceFolder || normalizePath(folder) !== normalizePath(workspaceFolder)).length > 0 && (
            <div className="welcome-recent-folders">
              <h3>최근 작업 폴더</h3>
              <ul>
                {recentFolders
                  .filter(folder => !workspaceFolder || normalizePath(folder) !== normalizePath(workspaceFolder))
                  .map((folder, i) => (
                    <li key={i}>
                      <button className="recent-file-btn" onClick={() => handleOpenRecentFolder(folder)}>
                        {folder.split(/[\\/]/).pop()}
                        <span className="recent-file-path">{folder}</span>
                        {recentFolderErrors[folder] && <span className="recent-file-error">열기 실패: {recentFolderErrors[folder]}</span>}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {workspaceFolder && (
            <div className="welcome-workspace">
              <div className="welcome-workspace-header">
                <h3>열린 폴더</h3>
                <button onClick={() => handleCreateInFolder()}>새 문서</button>
              </div>
              <div className="welcome-workspace-path">{workspaceFolder}</div>
              {workspaceEntries.filter(entry => entry.isDocument).length === 0 ? (
                <div className="welcome-workspace-empty">문서가 없습니다. 새 문서를 만들어 시작하세요.</div>
              ) : (
                <ul>
                  {workspaceEntries.filter(entry => entry.isDocument).map(entry => (
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
      {overlays}
      </>
    );
  }

  return <>
    <Editor
    key={currentPath ?? 'untitled'}
    adapter={adapter}
    initialDoc={doc}
    initialMeta={meta}
    currentPath={currentPath}
    workspaceFolder={workspaceFolder}
    workspaceEntries={workspaceEntries}
    onSelectFolder={handleSelectFolder}
    onCreateInFolder={handleCreateInFolder}
    onCreateFolder={handleCreateFolder}
    onOpenWorkspaceFile={(path) => loadDocument(path)}
    onRefreshWorkspace={() => loadWorkspace()}
    onRenameEntry={handleRenameEntry}
    onDeleteEntry={handleDeleteEntry}
    onUndoDelete={handleUndoDelete}
    hasDeletionHistory={hasDeletionHistory}
    onJsonView={handleJsonView}
    onNewDocument={handleNew}
    onOpenDocument={handleOpen}
    onExit={handleExit}
    />
    {overlays}
  </>;
};

const App: React.FC = () => {
  return (
    <EditorProvider>
      <AppContent />
    </EditorProvider>
  );
};

export default App;
