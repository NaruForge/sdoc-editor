import React from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { TableOfContents } from '@shared/editor/components/TableOfContents';
import { ListOfFigures } from '@shared/editor/components/ListOfFigures';
import { ListOfTables } from '@shared/editor/components/ListOfTables';
import { DocumentSettingsPanel } from '@shared/editor/components/DocumentSettingsPanel';
import { TemplatePanel } from '@shared/editor/components/TemplatePanel';
import { FilesPanel } from '@shared/editor/components/FilesPanel';
import { ResponsiveSidePanel } from '@shared/editor/components/ResponsiveSidePanel';
import { SidePanelTabs } from '@shared/editor/components/SidePanelTabs';
import { DiagramRendererSettingsPanel } from '@shared/editor/components/DiagramRendererSettingsPanel';
import { ViewControlPanel } from '@shared/editor/components/ViewControlPanel';
import type { SidePanelSelection } from '@shared/editor/activityState';
import type { FileOperationKind, FileOperationState } from '@shared/editor/fileOperations';
import type {
  FileExportFormat,
  FileImportFormat,
} from '@shared/editor/components/FilesPanel';
import type { ManagedTemplateDescriptor, EditorToHostMessage, PersonalTemplateMetadataInput } from '@shared/types/messages';
import type { TemplateSessionEvent, TemplateSessionState } from '@shared/editor/templateSession';
import type { DocumentSettings, ResolvedEditorSettings } from '@shared/types';
import { useEditorI18n, type UiLanguagePreference } from '@shared/editor/i18n';
import type { DiagramRendererSettings } from '@shared/diagramRenderer';

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
  onPostMessage?: (message: EditorToHostMessage) => void;
  onViewJson?: () => void;
  onFileOperation: (
    kind: FileOperationKind,
    format: FileExportFormat | FileImportFormat,
  ) => void;
  fileOperationState: FileOperationState;
  diagramRendererSettings: DiagramRendererSettings;
  onDiagramRendererSettingsChange: (settings: DiagramRendererSettings) => void;
  onTestDiagramRenderer?: (settings: DiagramRendererSettings) => Promise<void>;
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

const EXPORT_FORMATS = [
  { format: 'html', available: true },
  { format: 'pdf', available: true },
  { format: 'markdown', available: true },
  { format: 'adoc', available: true },
  { format: 'slides', available: true },
] as const;

const IMPORT_FORMATS = [
  { format: 'markdown', available: true },
  { format: 'html', available: true },
] as const;

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
  onPostMessage,
  onViewJson,
  onFileOperation,
  fileOperationState,
  diagramRendererSettings,
  onDiagramRendererSettingsChange,
  onTestDiagramRenderer,
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
  const title = selection.destination === 'navigate'
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
      <div id="side-panel-tab-content" role="tabpanel">
        {selection.destination === 'navigate' && selection.tab === 'toc' && (
          <TableOfContents editor={editor} showNumbering={showNumbering} settings={settings} />
        )}
        {selection.destination === 'navigate' && selection.tab === 'figures' && (
          <ListOfFigures editor={editor} settings={settings} />
        )}
        {selection.destination === 'navigate' && selection.tab === 'tables' && (
          <ListOfTables editor={editor} settings={settings} />
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
        {selection.destination === 'design' && selection.tab === 'document' && (
          <DocumentSettingsPanel
            exportMode="settings"
            onUpdateSettings={onUpdateDocSettings}
            onSelectCssFile={onPostMessage
              ? (target) => onPostMessage({ type: 'selectCssFile', target })
              : undefined}
            onClearCssFile={onPostMessage
              ? (target) => onPostMessage({ type: 'clearCssFile', target })
              : undefined}
          />
        )}
        {selection.destination === 'publish' && selection.tab === 'export' && (
          <>
            <DocumentSettingsPanel
              exportMode="export"
              onUpdateSettings={onUpdateDocSettings}
              onSelectCssFile={onPostMessage
                ? (target) => onPostMessage({ type: 'selectCssFile', target })
                : undefined}
              onClearCssFile={onPostMessage
                ? (target) => onPostMessage({ type: 'clearCssFile', target })
                : undefined}
            />
            <DiagramRendererSettingsPanel
              settings={diagramRendererSettings}
              onChange={onDiagramRendererSettingsChange}
              onTest={onTestDiagramRenderer}
            />
            <FilesPanel
              exportFormats={EXPORT_FORMATS}
              importFormats={[]}
              operationState={fileOperationState}
              onStart={onFileOperation}
              onViewJson={onViewJson}
            />
          </>
        )}
        {selection.destination === 'publish' && selection.tab === 'import' && (
          <FilesPanel
            exportFormats={[]}
            importFormats={IMPORT_FORMATS}
            operationState={fileOperationState}
            onStart={onFileOperation}
            onViewJson={onViewJson}
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
      </div>
    </ResponsiveSidePanel>
  );
};
