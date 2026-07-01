import React from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { TableOfContents } from './TableOfContents';
import { ListOfFigures } from './ListOfFigures';
import { ListOfTables } from './ListOfTables';
import { DocumentSettingsPanel } from './DocumentSettingsPanel';
import { PanelEmptyState } from './PanelEmptyState';
import type { DocumentSettings } from '@shared/types';
import { FileJson, Download, Upload, Loader2, FolderOpen, RefreshCw, FilePlus, FileText, Folder } from 'lucide-react';
import type { ExplorerEntry } from '../App';

export type ActivityTab = 'explorer' | 'view' | 'toc' | 'lof' | 'lot' | 'settings' | 'file';

// Legacy alias kept for any other imports that still reference SidePanelTab
export type SidePanelTab = ActivityTab;

interface SidePanelProps {
  activeTab: ActivityTab;
  editor: TiptapEditor | null;
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  onUpdateDocSettings: (settings: Partial<DocumentSettings> | null) => void;
  onViewJson?: () => void;
  onExport?: (format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides') => void;
  onImport?: (format: 'markdown' | 'html') => void;
  isExporting?: boolean;
  workspaceFolder?: string | null;
  workspaceEntries?: ExplorerEntry[];
  currentPath?: string | null;
  onSelectFolder?: () => void;
  onCreateInFolder?: () => void;
  onOpenWorkspaceFile?: (path: string) => void;
  onRefreshWorkspace?: () => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  activeTab,
  editor,
  showNumbering,
  onToggleNumbering,
  showDecoration,
  onToggleDecoration,
  onUpdateDocSettings,
  onViewJson,
  onExport,
  onImport,
  isExporting = false,
  workspaceFolder,
  workspaceEntries = [],
  currentPath,
  onSelectFolder,
  onCreateInFolder,
  onOpenWorkspaceFile,
  onRefreshWorkspace,
}) => {
  return (
    <div className="side-panel">
      <div className="side-panel-content">
        {activeTab === 'view' && (
          <ViewControlPanel
            showNumbering={showNumbering}
            onToggleNumbering={onToggleNumbering}
            showDecoration={showDecoration}
            onToggleDecoration={onToggleDecoration}
          />
        )}
        {activeTab === 'explorer' && (
          <ExplorerPanel
            workspaceFolder={workspaceFolder}
            entries={workspaceEntries}
            currentPath={currentPath}
            onSelectFolder={onSelectFolder}
            onCreateInFolder={onCreateInFolder}
            onOpenFile={onOpenWorkspaceFile}
            onRefresh={onRefreshWorkspace}
          />
        )}
        {activeTab === 'toc' && (
          <TableOfContents editor={editor} showNumbering={showNumbering} />
        )}
        {activeTab === 'lof' && (
          <ListOfFigures editor={editor} />
        )}
        {activeTab === 'lot' && (
          <ListOfTables editor={editor} />
        )}
        {activeTab === 'settings' && (
          <DocumentSettingsPanel onUpdateSettings={onUpdateDocSettings} />
        )}
        {activeTab === 'file' && (
          <FilePanel
            onViewJson={onViewJson}
            onExport={onExport}
            onImport={onImport}
            isExporting={isExporting}
          />
        )}
      </div>
    </div>
  );
};

// ─── View Control Panel ──────────────────────────────────────────

interface ViewControlPanelProps {
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
}

const ViewControlPanel: React.FC<ViewControlPanelProps> = ({
  showNumbering,
  onToggleNumbering,
  showDecoration,
  onToggleDecoration,
}) => (
  <div className="side-panel-section">
    <div className="side-panel-section-title">뷰 컨트롤</div>
    <div className="side-panel-section-desc">편집 화면에만 적용되는 표시 옵션입니다. 내보내기 결과에는 영향을 주지 않습니다.</div>
    <label className="side-panel-toggle-row">
      <span className="side-panel-toggle-label">헤딩 번호 매김</span>
      <button
        className={`side-panel-toggle-btn${showNumbering ? ' is-active' : ''}`}
        onClick={onToggleNumbering}
        title={showNumbering ? '번호 숨기기' : '번호 표시'}
      >
        {showNumbering ? 'ON' : 'OFF'}
      </button>
    </label>
    <label className="side-panel-toggle-row">
      <span className="side-panel-toggle-label">헤딩 장식 (색상/선)</span>
      <button
        className={`side-panel-toggle-btn${showDecoration ? ' is-active' : ''}`}
        onClick={onToggleDecoration}
        title={showDecoration ? '장식 숨기기' : '장식 표시'}
      >
        {showDecoration ? 'ON' : 'OFF'}
      </button>
    </label>
  </div>
);

// ─── File Panel ──────────────────────────────────────────────────

interface FilePanelProps {
  onViewJson?: () => void;
  onExport?: (format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides') => void;
  onImport?: (format: 'markdown' | 'html') => void;
  isExporting?: boolean;
}

const EXPORT_FORMATS: { format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides'; label: string; supported: boolean }[] = [
  { format: 'html', label: 'HTML', supported: true },
  { format: 'pdf', label: 'PDF (Tauri 미지원)', supported: false },
  { format: 'markdown', label: 'Markdown', supported: true },
  { format: 'adoc', label: 'AsciiDoc', supported: true },
  { format: 'slides', label: 'Slides (Tauri 미지원)', supported: false },
];

const IMPORT_FORMATS: { format: 'markdown' | 'html'; label: string }[] = [
  { format: 'markdown', label: 'Markdown' },
  { format: 'html', label: 'HTML' },
];

const FilePanel: React.FC<FilePanelProps> = ({ onViewJson, onExport, onImport, isExporting = false }) => {
  if (!onExport && !onImport && !onViewJson) {
    return (
      <div className="side-panel-section">
        <PanelEmptyState
          icon={<FolderOpen size={22} />}
          title="파일 작업을 사용할 수 없습니다"
          message="이 문서에서는 내보내기·가져오기 명령을 사용할 수 없습니다."
          hint="문서를 다시 열거나 앱을 재시작해 보세요."
        />
      </div>
    );
  }

  return (
  <div className="side-panel-section">
    {onExport && (
      <>
        <div className="side-panel-section-title">
          <Download size={13} style={{ marginRight: 4, flexShrink: 0 }} />
          내보내기
          {isExporting && (
            <Loader2 size={12} style={{ marginLeft: 'auto', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          )}
        </div>
        <div className="side-panel-section-desc">선택한 형식으로 현재 문서를 변환해 저장합니다.</div>
        {EXPORT_FORMATS.map(({ format, label, supported }) => {
          const disabled = isExporting || !supported;
          return (
          <button
            key={format}
            className={`side-panel-file-btn${disabled ? ' is-disabled' : ''}`}
            onClick={() => !disabled && onExport(format)}
            disabled={disabled}
            title={supported ? undefined : 'Tauri 앱에서는 아직 지원되지 않습니다.'}
          >
            {label}
          </button>
        );})}
      </>
    )}

    {onImport && (
      <>
        <div className="side-panel-section-title" style={{ marginTop: 12 }}>
          <Upload size={13} style={{ marginRight: 4, flexShrink: 0 }} />
          가져오기
        </div>
        <div className="side-panel-section-desc">외부 파일을 현재 편집기 형식으로 불러옵니다.</div>
        {IMPORT_FORMATS.map(({ format, label }) => (
          <button
            key={format}
            className="side-panel-file-btn"
            onClick={() => onImport(format)}
          >
            {label}
          </button>
        ))}
      </>
    )}

    {onViewJson && (
      <>
        <div className="side-panel-section-title" style={{ marginTop: 12 }}>
          <FileJson size={13} style={{ marginRight: 4, flexShrink: 0 }} />
          개발
        </div>
        <button className="side-panel-file-btn" onClick={onViewJson}>
          JSON 소스 보기
        </button>
      </>
    )}
  </div>
  );
};

interface ExplorerPanelProps {
  workspaceFolder?: string | null;
  entries: ExplorerEntry[];
  currentPath?: string | null;
  onSelectFolder?: () => void;
  onCreateInFolder?: () => void;
  onOpenFile?: (path: string) => void;
  onRefresh?: () => void;
}

const ExplorerPanel: React.FC<ExplorerPanelProps> = ({
  workspaceFolder,
  entries,
  currentPath,
  onSelectFolder,
  onCreateInFolder,
  onOpenFile,
  onRefresh,
}) => (
  <div className="side-panel-section explorer-panel">
    <div className="side-panel-section-title">
      <FolderOpen size={13} />
      탐색기
    </div>
    <div className="explorer-actions">
      <button className="explorer-action-btn" onClick={onSelectFolder}>
        <FolderOpen size={13} />
        폴더 열기
      </button>
      <button className="explorer-action-btn" onClick={onCreateInFolder} disabled={!workspaceFolder}>
        <FilePlus size={13} />
        새 문서
      </button>
      <button className="explorer-icon-btn" onClick={onRefresh} disabled={!workspaceFolder} title="새로고침">
        <RefreshCw size={13} />
      </button>
    </div>
    {workspaceFolder ? (
      <>
        <div className="explorer-root" title={workspaceFolder}>{workspaceFolder.split(/[\\/]/).pop() || workspaceFolder}</div>
        <div className="explorer-list">
          {entries.length === 0 && <div className="explorer-empty">표시할 .sdoc / .tiptap.json 파일이 없습니다.</div>}
          {entries.map((entry) => (
            <button
              key={entry.path}
              className={`explorer-entry explorer-entry-${entry.kind}${entry.path === currentPath ? ' is-active' : ''}`}
              onClick={() => entry.kind === 'file' && onOpenFile?.(entry.path)}
              disabled={entry.kind !== 'file'}
              title={entry.path}
            >
              <span className="explorer-indent" style={{ width: `${entry.depth * 12}px` }} />
              {entry.kind === 'folder' ? <Folder size={13} /> : <FileText size={13} />}
              <span className="explorer-entry-name">{entry.name}</span>
            </button>
          ))}
        </div>
      </>
    ) : (
      <div className="explorer-empty">좌측 사이드바에서 폴더를 열면 문서 목록이 표시됩니다.</div>
    )}
  </div>
);
