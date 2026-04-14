import React from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { TableOfContents } from './TableOfContents';
import { ListOfFigures } from './ListOfFigures';
import { ListOfTables } from './ListOfTables';
import { DocumentSettingsPanel } from './DocumentSettingsPanel';
import type { DocumentSettings } from '@shared/types';
import { FileJson, Download, Upload, Loader2 } from 'lucide-react';

export type ActivityTab = 'view' | 'toc' | 'lof' | 'lot' | 'settings' | 'file';

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

const EXPORT_FORMATS: { format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides'; label: string }[] = [
  { format: 'html', label: 'HTML' },
  { format: 'pdf', label: 'PDF' },
  { format: 'markdown', label: 'Markdown' },
  { format: 'adoc', label: 'AsciiDoc' },
  { format: 'slides', label: 'Slides (reveal.js)' },
];

const IMPORT_FORMATS: { format: 'markdown' | 'html'; label: string }[] = [
  { format: 'markdown', label: 'Markdown' },
  { format: 'html', label: 'HTML' },
];

const FilePanel: React.FC<FilePanelProps> = ({ onViewJson, onExport, onImport, isExporting = false }) => (
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
        {EXPORT_FORMATS.map(({ format, label }) => (
          <button
            key={format}
            className="side-panel-file-btn"
            onClick={() => !isExporting && onExport(format)}
            disabled={isExporting}
            style={{ opacity: isExporting ? 0.5 : 1, cursor: isExporting ? 'not-allowed' : 'pointer' }}
          >
            {label}
          </button>
        ))}
      </>
    )}

    {onImport && (
      <>
        <div className="side-panel-section-title" style={{ marginTop: 12 }}>
          <Upload size={13} style={{ marginRight: 4, flexShrink: 0 }} />
          가져오기
        </div>
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
