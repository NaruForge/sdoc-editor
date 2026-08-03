import React, { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Editor as TiptapEditor } from '@tiptap/react';
import { TableOfContents } from '@shared/editor/components/TableOfContents';
import { ListOfFigures } from '@shared/editor/components/ListOfFigures';
import { ListOfTables } from '@shared/editor/components/ListOfTables';
import { DocumentSettingsPanel } from '@shared/editor/components/DocumentSettingsPanel';
import { TemplatePanel } from '@shared/editor/components/TemplatePanel';
import { FilesPanel, type FileExportFormat, type FileImportFormat } from '@shared/editor/components/FilesPanel';
import { SidePanelTabs } from '@shared/editor/components/SidePanelTabs';
import { DiagramRendererSettingsPanel } from '@shared/editor/components/DiagramRendererSettingsPanel';
import { ViewControlPanel } from '@shared/editor/components/ViewControlPanel';
import type { DocumentSettings, ResolvedEditorSettings } from '@shared/types';
import type { ManagedTemplateDescriptor, PersonalTemplateMetadataInput } from '@shared/types/messages';
import type { TemplateSessionEvent, TemplateSessionState } from '@shared/editor/templateSession';
import type { FileOperationKind, FileOperationState } from '@shared/editor/fileOperations';
import { FolderOpen, RefreshCw, FilePlus, FileText, FileImage, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import type { ExplorerEntry } from '../App';
import { ExplorerContextMenu, type ExplorerContextMenuTarget } from './ExplorerContextMenu';
import { open as openWithSystemApp } from '@tauri-apps/plugin-shell';
import type { SidePanelSelection } from '@shared/editor/activityState';
import { ResponsiveSidePanel } from '@shared/editor/components/ResponsiveSidePanel';
import { useEditorI18n, type UiLanguagePreference } from '@shared/editor/i18n';
import type { DiagramRendererSettings } from '@shared/diagramRenderer';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

/** Returns true for image-like files (including drawio.svg diagrams) shown with a distinct icon. */
function isImageLikeEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.drawio.svg')) return true;
  const ext = lower.split('.').pop() || '';
  return IMAGE_EXTENSIONS.includes(ext) || ext === 'svg';
}

interface SidePanelProps {
  selection: SidePanelSelection;
  onSelectionChange: (selection: SidePanelSelection) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  editor: TiptapEditor | null;
  settings: ResolvedEditorSettings;
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  uiLanguagePreference: UiLanguagePreference;
  onUiLanguagePreferenceChange: (preference: UiLanguagePreference) => void;
  onUpdateDocSettings: (settings: Partial<DocumentSettings> | null) => void;
  onViewJson?: () => void;
  onFileOperation: (
    kind: FileOperationKind,
    format: FileExportFormat | FileImportFormat,
  ) => void;
  fileOperationState: FileOperationState;
  diagramRendererSettings: DiagramRendererSettings;
  onDiagramRendererSettingsChange: (settings: DiagramRendererSettings) => void;
  onTestDiagramRenderer?: (settings: DiagramRendererSettings) => Promise<void>;
  workspaceFolder?: string | null;
  workspaceEntries?: ExplorerEntry[];
  currentPath?: string | null;
  onSelectFolder?: () => void;
  onCreateInFolder?: (folder?: string) => void;
  onCreateFolder?: (parent: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  onRefreshWorkspace?: () => void;
  onRenameEntry?: (path: string, newName: string) => void;
  onDeleteEntry?: (entry: ExplorerEntry) => void;
  onUndoDelete?: () => void;
  hasDeletionHistory?: boolean;
  onHoverPath?: (path: string | null) => void;
  templateSession: TemplateSessionState;
  dispatchTemplateSession: React.Dispatch<TemplateSessionEvent>;
  onRefreshTemplates?: () => void;
  onApplyTemplate?: (templateId: string) => void;
  onSavePersonalTemplate?: (metadata: PersonalTemplateMetadataInput) => void;
  onUpdatePersonalTemplate?: (template: ManagedTemplateDescriptor, metadata: PersonalTemplateMetadataInput) => void;
  onDuplicatePersonalTemplate?: (template: ManagedTemplateDescriptor, metadata: PersonalTemplateMetadataInput) => void;
  onDeletePersonalTemplate?: (template: ManagedTemplateDescriptor, visibleIndex: number) => void;
  onOpenPersonalTemplateFolder?: () => void;
  onClose: () => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  selection,
  onSelectionChange,
  returnFocusRef,
  editor,
  settings,
  showNumbering,
  onToggleNumbering,
  showDecoration,
  onToggleDecoration,
  uiLanguagePreference,
  onUiLanguagePreferenceChange,
  onUpdateDocSettings,
  onViewJson,
  onFileOperation,
  fileOperationState,
  diagramRendererSettings,
  onDiagramRendererSettingsChange,
  onTestDiagramRenderer,
  workspaceFolder,
  workspaceEntries = [],
  currentPath,
  onSelectFolder,
  onCreateInFolder,
  onCreateFolder,
  onOpenWorkspaceFile,
  onRefreshWorkspace,
  onRenameEntry,
  onDeleteEntry,
  onUndoDelete,
  hasDeletionHistory,
  onHoverPath,
  templateSession,
  dispatchTemplateSession,
  onRefreshTemplates,
  onApplyTemplate,
  onSavePersonalTemplate,
  onUpdatePersonalTemplate,
  onDuplicatePersonalTemplate,
  onDeletePersonalTemplate,
  onOpenPersonalTemplateFolder,
  onClose,
}) => {
  const { t } = useEditorI18n();
  const title = selection.destination === 'workspace'
    ? t('activity.workspace')
    : selection.destination === 'navigate'
      ? t('activity.navigate')
      : selection.destination === 'design'
        ? t('activity.design')
        : selection.destination === 'templates'
          ? t('activity.templates')
          : t('activity.publish');
  return (
    <ResponsiveSidePanel
      title={title}
      closeLabel={t('panel.close')}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
        {(selection.destination === 'navigate'
          || selection.destination === 'design'
          || selection.destination === 'publish') && (
          <SidePanelTabs
            selection={selection}
            onSelectionChange={onSelectionChange}
          />
        )}
        {selection.destination === 'design' && selection.tab === 'view' && (
          <ViewControlPanel
            showNumbering={showNumbering}
            onToggleNumbering={onToggleNumbering}
            showDecoration={showDecoration}
            onToggleDecoration={onToggleDecoration}
            uiLanguagePreference={uiLanguagePreference}
            onUiLanguagePreferenceChange={onUiLanguagePreferenceChange}
          />
        )}
        {selection.destination === 'workspace' && (
          <ExplorerPanel
            key={workspaceFolder ?? 'no-workspace'}
            workspaceFolder={workspaceFolder}
            entries={workspaceEntries}
            currentPath={currentPath}
            onSelectFolder={onSelectFolder}
            onCreateInFolder={onCreateInFolder}
            onCreateFolder={onCreateFolder}
            onOpenFile={onOpenWorkspaceFile}
            onRefresh={onRefreshWorkspace}
            onRenameEntry={onRenameEntry}
            onDeleteEntry={onDeleteEntry}
            onUndoDelete={onUndoDelete}
            hasDeletionHistory={hasDeletionHistory}
            onHoverPath={onHoverPath}
          />
        )}
        {selection.destination === 'navigate' && selection.tab === 'toc' && (
          <TableOfContents editor={editor} showNumbering={showNumbering} settings={settings} />
        )}
        {selection.destination === 'navigate' && selection.tab === 'figures' && (
          <ListOfFigures editor={editor} settings={settings} />
        )}
        {selection.destination === 'navigate' && selection.tab === 'tables' && (
          <ListOfTables editor={editor} settings={settings} />
        )}
        {selection.destination === 'design' && selection.tab === 'document' && (
          <DocumentSettingsPanel exportMode="settings" onUpdateSettings={onUpdateDocSettings} />
        )}
        {selection.destination === 'publish' && selection.tab === 'export' && (
          <>
          <DocumentSettingsPanel exportMode="export" onUpdateSettings={onUpdateDocSettings} />
          <DiagramRendererSettingsPanel
            settings={diagramRendererSettings}
            onChange={onDiagramRendererSettingsChange}
            onTest={onTestDiagramRenderer}
          />
          <FilesPanel
            onViewJson={onViewJson}
            exportFormats={[
              { format: 'html', available: true },
              { format: 'markdown', available: true },
              { format: 'adoc', available: true },
              { format: 'pdf', available: false, unavailableReason: 'PDF export is available in the VS Code host.' },
              { format: 'slides', available: false, unavailableReason: 'Slides export is available in the VS Code host.' },
            ]}
            importFormats={[]}
            operationState={fileOperationState}
            onStart={onFileOperation}
          />
          </>
        )}
        {selection.destination === 'publish' && selection.tab === 'import' && (
          <FilesPanel
            onViewJson={onViewJson}
            exportFormats={[]}
            importFormats={[
              { format: 'markdown', available: true },
              { format: 'html', available: true },
            ]}
            operationState={fileOperationState}
            onStart={onFileOperation}
          />
        )}
        {selection.destination === 'templates' && (
          <TemplatePanel
            session={templateSession}
            dispatch={dispatchTemplateSession}
            onRefresh={onRefreshTemplates}
            onApply={onApplyTemplate}
            onSaveCurrent={onSavePersonalTemplate}
            onEdit={onUpdatePersonalTemplate}
            onDuplicate={onDuplicatePersonalTemplate}
            onDelete={onDeletePersonalTemplate}
            onOpenPersonalFolder={onOpenPersonalTemplateFolder}
          />
        )}
    </ResponsiveSidePanel>
  );
};

// ─── File Panel ──────────────────────────────────────────────────

interface ExplorerPanelProps {
  workspaceFolder?: string | null;
  entries: ExplorerEntry[];
  currentPath?: string | null;
  onSelectFolder?: () => void;
  onCreateInFolder?: (folder?: string) => void;
  onCreateFolder?: (parent: string) => void;
  onOpenFile?: (path: string) => void;
  onRefresh?: () => void;
  onRenameEntry?: (path: string, newName: string) => void;
  onDeleteEntry?: (entry: ExplorerEntry) => void;
  onUndoDelete?: () => void;
  hasDeletionHistory?: boolean;
  onHoverPath?: (path: string | null) => void;
}

const ExplorerPanel: React.FC<ExplorerPanelProps> = ({
  workspaceFolder,
  entries,
  currentPath,
  onSelectFolder,
  onCreateInFolder,
  onCreateFolder,
  onOpenFile,
  onRefresh,
  onRenameEntry,
  onDeleteEntry,
  onUndoDelete,
  hasDeletionHistory,
  onHoverPath,
}) => {
  const { t } = useEditorI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ExplorerContextMenuTarget } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // 폴더가 접혀 있으면 그 하위(더 깊은 depth) 항목을 DFS 선형 목록에서 걸러낸다.
  const visibleEntries = useMemo(() => {
    const visible: ExplorerEntry[] = [];
    let hideUntilDepth = Infinity;
    for (const entry of entries) {
      if (entry.depth >= hideUntilDepth) {
        continue;
      }
      hideUntilDepth = Infinity;
      visible.push(entry);
      if (entry.kind === 'folder' && collapsedFolders.has(entry.path)) {
        hideUntilDepth = entry.depth + 1;
      }
    }
    return visible;
  }, [entries, collapsedFolders]);

  const toggleFolder = (path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const openEntryContextMenu = (e: React.MouseEvent, entry: ExplorerEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: { path: entry.path, kind: entry.kind, isRoot: false },
    });
  };

  const openRootContextMenu = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || !workspaceFolder) return;
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: { path: workspaceFolder, kind: 'folder', isRoot: true },
    });
  };

  const startRename = (entry: ExplorerEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
  };

  const commitRename = (entry: ExplorerEntry) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (trimmed && trimmed !== entry.name) {
      onRenameEntry?.(entry.path, trimmed);
    }
  };

  const handleRevealInFileExplorer = (path: string) => {
    invoke('reveal_in_file_explorer', { path }).catch((error: unknown) => {
      console.warn('Failed to reveal path in file explorer', error);
    });
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path).catch((error: unknown) => {
      console.warn('Failed to copy path to clipboard', error);
    });
  };

  const handleEntryClick = (entry: ExplorerEntry) => {
    if (renamingPath === entry.path) return;
    if (entry.kind === 'folder') {
      toggleFolder(entry.path);
    } else if (entry.isDocument) {
      onOpenFile?.(entry.path);
    } else {
      // 문서가 아닌 파일(이미지, drawio 소스 등)은 시스템 기본 앱으로 연다.
      openWithSystemApp(entry.path).catch((err: unknown) => {
        console.warn('Failed to open file with system default app', err);
      });
    }
  };

  return (
    <div className="side-panel-section explorer-panel">
      <div className="side-panel-section-title">
        <FolderOpen size={13} />
        {t('panel.explorer')}
      </div>
      <div className="explorer-actions">
        <button className="explorer-action-btn" onClick={onSelectFolder}>
          <FolderOpen size={13} />
          {t('explorer.openFolder')}
        </button>
        <button className="explorer-action-btn" onClick={() => onCreateInFolder?.()} disabled={!workspaceFolder}>
          <FilePlus size={13} />
          {t('explorer.newDocument')}
        </button>
        <button
          className="explorer-icon-btn"
          onClick={onRefresh}
          disabled={!workspaceFolder}
          title={t('explorer.refresh')}
          aria-label={t('explorer.refresh')}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {workspaceFolder ? (
        <>
          <div className="explorer-root" title={workspaceFolder}>{workspaceFolder.split(/[\\/]/).pop() || workspaceFolder}</div>
          <div className="explorer-list" onContextMenu={openRootContextMenu}>
            {entries.length === 0 && <div className="explorer-empty">{t('explorer.empty')}</div>}
            {visibleEntries.map((entry) => (
              <button
                key={entry.path}
                className={`explorer-entry explorer-entry-${entry.kind}${entry.path === currentPath ? ' is-active' : ''}`}
                onClick={() => handleEntryClick(entry)}
                onContextMenu={(e) => openEntryContextMenu(e, entry)}
                onMouseEnter={() => onHoverPath?.(entry.path)}
                onMouseLeave={() => onHoverPath?.(null)}
                title={entry.path}
              >
                <span className="explorer-indent" style={{ width: `${entry.depth * 12}px` }} />
                {entry.kind === 'folder' ? (
                  collapsedFolders.has(entry.path) ? <ChevronRight size={13} className="explorer-chevron" /> : <ChevronDown size={13} className="explorer-chevron" />
                ) : (
                  <span className="explorer-chevron-spacer" />
                )}
                {entry.kind === 'folder' ? <Folder size={13} /> : isImageLikeEntry(entry.name) ? <FileImage size={13} /> : <FileText size={13} />}
                {renamingPath === entry.path ? (
                  <input
                    className="explorer-entry-rename-input"
                    autoFocus
                    value={renameValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(entry)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(entry);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenamingPath(null);
                      }
                    }}
                  />
                ) : (
                  <span className="explorer-entry-name">{entry.name}</span>
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="explorer-empty">{t('explorer.openFolderHint')}</div>
      )}
      {contextMenu && (
        <ExplorerContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          target={contextMenu.target}
          onClose={() => setContextMenu(null)}
          onCreateHere={(folder) => onCreateInFolder?.(folder)}
          onCreateFolderHere={(folder) => onCreateFolder?.(folder)}
          onRename={() => {
            const entry = entries.find((e) => e.path === contextMenu.target.path);
            if (entry) startRename(entry);
          }}
          onDelete={() => {
            const entry = entries.find((e) => e.path === contextMenu.target.path);
            if (entry) onDeleteEntry?.(entry);
          }}
          onUndoDelete={onUndoDelete}
          hasDeletionHistory={hasDeletionHistory}
          onRevealInFileExplorer={handleRevealInFileExplorer}
          onCopyPath={handleCopyPath}
          onRefresh={() => onRefresh?.()}
        />
      )}
    </div>
  );
};
