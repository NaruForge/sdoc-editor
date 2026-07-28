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
import { ResponsiveSidePanel } from '@shared/editor/components/ResponsiveSidePanel';
import { useEditorI18n, type EditorTranslationKey } from '@shared/editor/i18n';

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
  onClose: () => void;
}

const PANEL_TITLE_KEYS: Record<ActivityTab, EditorTranslationKey> = {
  explorer: 'panel.explorer',
  view: 'panel.view',
  toc: 'panel.contents',
  lof: 'panel.figures',
  lot: 'panel.tables',
  settings: 'panel.settings',
  file: 'panel.files',
  template: 'panel.templates',
};

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
  onClose,
}) => {
  const { t } = useEditorI18n();
  return (
    <ResponsiveSidePanel
      title={t(PANEL_TITLE_KEYS[activeTab])}
      closeLabel={t('panel.close')}
      onClose={onClose}
    >
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
    </ResponsiveSidePanel>
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
}) => {
  const { t } = useEditorI18n();
  return (
    <div className="side-panel-section">
      <div className="side-panel-section-title">{t('panel.viewControls')}</div>
      <div className="side-panel-section-desc">{t('panel.viewOnlyDescription')}</div>
      <label className="side-panel-toggle-row">
        <span className="side-panel-toggle-label">{t('panel.headingNumbering')}</span>
        <button
          type="button"
          className={`side-panel-toggle-btn${showNumbering ? ' is-active' : ''}`}
          onClick={onToggleNumbering}
          title={t(showNumbering ? 'panel.hideNumbering' : 'panel.showNumbering')}
          aria-label={t(showNumbering ? 'panel.hideNumbering' : 'panel.showNumbering')}
          aria-pressed={showNumbering}
        >
          {showNumbering ? 'ON' : 'OFF'}
        </button>
      </label>
      <label className="side-panel-toggle-row">
        <span className="side-panel-toggle-label">{t('panel.headingDecoration')}</span>
        <button
          type="button"
          className={`side-panel-toggle-btn${showDecoration ? ' is-active' : ''}`}
          onClick={onToggleDecoration}
          title={t(showDecoration ? 'panel.hideDecoration' : 'panel.showDecoration')}
          aria-label={t(showDecoration ? 'panel.hideDecoration' : 'panel.showDecoration')}
          aria-pressed={showDecoration}
        >
          {showDecoration ? 'ON' : 'OFF'}
        </button>
      </label>
    </div>
  );
};

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
  const { t } = useEditorI18n();
  if (!onExport && !onImport && !onViewJson) {
    return (
      <div className="side-panel-section">
        <PanelEmptyState
          icon={<FolderOpen size={22} />}
          title={t('panel.fileUnavailableTitle')}
          message={t('panel.fileUnavailableMessage')}
          hint={t('panel.restartExtension')}
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
          {t('panel.export')}
          {isExporting && (
            <Loader2 size={12} style={{ marginLeft: 'auto', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          )}
        </div>
        <div className="side-panel-section-desc">{t('panel.exportDescription')}</div>
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
          {t('panel.import')}
        </div>
        <div className="side-panel-section-desc">{t('panel.importDescription')}</div>
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
          {t('panel.development')}
        </div>
        <button className="side-panel-file-btn" onClick={onViewJson}>
          {t('panel.jsonSource')}
        </button>
      </>
    )}
  </div>
  );
};
