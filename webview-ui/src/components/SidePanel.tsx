import React from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { TableOfContents } from '@shared/editor/components/TableOfContents';
import { ListOfFigures } from '@shared/editor/components/ListOfFigures';
import { ListOfTables } from '@shared/editor/components/ListOfTables';
import { DocumentSettingsPanel } from '@shared/editor/components/DocumentSettingsPanel';
import { PanelEmptyState } from '@shared/editor/components/PanelEmptyState';
import { TemplatePanel } from '@shared/editor/components/TemplatePanel';
import type { ManagedTemplateDescriptor } from '@shared/types/messages';
import type { DocumentSettings, ResolvedEditorSettings } from '@shared/types';
import type { EditorToHostMessage } from '@shared/types/messages';
import { FileJson, Download, Upload, Loader2, FolderOpen } from 'lucide-react';
import type { ActivityTab } from '@shared/editor/components/ActivityBar';

// Legacy alias kept for any other imports that still reference SidePanelTab
export type SidePanelTab = ActivityTab;

interface SidePanelProps {
  activeTab: ActivityTab;
  editor: TiptapEditor | null;
  settings: ResolvedEditorSettings;
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  onUpdateDocSettings: (settings: Partial<DocumentSettings> | null) => void;
  onPostMessage?: (message: EditorToHostMessage) => void;
  onViewJson?: () => void;
  onExport?: (format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides') => void;
  onImport?: (format: 'markdown' | 'html') => void;
  isExporting?: boolean;
  templates?: readonly ManagedTemplateDescriptor[];
  templateDiagnosticCount?: number;
  isTemplateCatalogLoading?: boolean;
  isApplyingTemplate?: boolean;
  isManagingTemplate?: boolean;
  personalTemplateRootPath?: string;
  personalTemplateRootScope?: 'local' | 'remote';
  onRefreshTemplates?: () => void;
  onApplyTemplate?: (templateId: string) => void;
  onSavePersonalTemplate?: () => void;
  onUpdatePersonalTemplate?: (template: ManagedTemplateDescriptor) => void;
  onDuplicatePersonalTemplate?: (template: ManagedTemplateDescriptor) => void;
  onDeletePersonalTemplate?: (template: ManagedTemplateDescriptor) => void;
  onOpenPersonalTemplateFolder?: () => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  activeTab,
  editor,
  settings,
  showNumbering,
  onToggleNumbering,
  showDecoration,
  onToggleDecoration,
  onUpdateDocSettings,
  onPostMessage,
  onViewJson,
  onExport,
  onImport,
  isExporting = false,
  templates = [],
  templateDiagnosticCount = 0,
  isTemplateCatalogLoading = false,
  isApplyingTemplate = false,
  isManagingTemplate = false,
  personalTemplateRootPath = '',
  personalTemplateRootScope = 'local',
  onRefreshTemplates,
  onApplyTemplate,
  onSavePersonalTemplate,
  onUpdatePersonalTemplate,
  onDuplicatePersonalTemplate,
  onDeletePersonalTemplate,
  onOpenPersonalTemplateFolder,
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
          <TableOfContents editor={editor} showNumbering={showNumbering} settings={settings} />
        )}
        {activeTab === 'lof' && (
          <ListOfFigures editor={editor} settings={settings} />
        )}
        {activeTab === 'lot' && (
          <ListOfTables editor={editor} settings={settings} />
        )}
        {activeTab === 'settings' && (
          <DocumentSettingsPanel
            onUpdateSettings={onUpdateDocSettings}
            onSelectCssFile={onPostMessage ? (target) => onPostMessage({ type: 'selectCssFile', target }) : undefined}
            onClearCssFile={onPostMessage ? (target) => onPostMessage({ type: 'clearCssFile', target }) : undefined}
          />
        )}
        {activeTab === 'file' && (
          <FilePanel
            onViewJson={onViewJson}
            onExport={onExport}
            onImport={onImport}
            isExporting={isExporting}
          />
        )}
        {activeTab === 'template' && onRefreshTemplates && onApplyTemplate
          && onSavePersonalTemplate && onUpdatePersonalTemplate && onDuplicatePersonalTemplate
          && onDeletePersonalTemplate && onOpenPersonalTemplateFolder && (
          <TemplatePanel
            templates={templates}
            diagnosticCount={templateDiagnosticCount}
            isLoading={isTemplateCatalogLoading}
            isApplying={isApplyingTemplate}
            isManaging={isManagingTemplate}
            personalRootPath={personalTemplateRootPath}
            personalRootScope={personalTemplateRootScope}
            onRefresh={onRefreshTemplates}
            onApply={onApplyTemplate}
            onSaveCurrent={onSavePersonalTemplate}
            onEdit={onUpdatePersonalTemplate}
            onDuplicate={onDuplicatePersonalTemplate}
            onDelete={onDeletePersonalTemplate}
            onOpenPersonalFolder={onOpenPersonalTemplateFolder}
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

const FilePanel: React.FC<FilePanelProps> = ({ onViewJson, onExport, onImport, isExporting = false }) => {
  if (!onExport && !onImport && !onViewJson) {
    return (
      <div className="side-panel-section">
        <PanelEmptyState
          icon={<FolderOpen size={22} />}
          title="파일 작업을 사용할 수 없습니다"
          message="이 문서에서는 내보내기·가져오기 명령을 사용할 수 없습니다."
          hint="문서를 다시 열거나 확장 프로그램을 재시작해 보세요."
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
