import React, { useId, type ReactNode } from 'react';
import {
  Braces,
  CircleCheck,
  CircleX,
  CodeXml,
  FileJson,
  FileText,
  FileType2,
  LoaderCircle,
  Presentation,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import {
  isFileOperationRunning,
  type FileOperationKind,
  type FileOperationState,
} from '../fileOperations';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

export type FileExportFormat = 'html' | 'pdf' | 'markdown' | 'adoc' | 'slides';
export type FileImportFormat = 'markdown' | 'html';

export type FileFormatCapability<Format extends string> =
  | { format: Format; available: true }
  | { format: Format; available: false; unavailableReason: string };

export interface FilesPanelProps {
  exportFormats: readonly FileFormatCapability<FileExportFormat>[];
  importFormats: readonly FileFormatCapability<FileImportFormat>[];
  operationState: FileOperationState;
  onStart: (
    kind: FileOperationKind,
    format: FileExportFormat | FileImportFormat,
  ) => void;
  onViewJson?: () => void;
}

interface FormatPresentation {
  nameKey: EditorTranslationKey;
  extension: string;
  descriptionKey: EditorTranslationKey;
  icon: ReactNode;
}

const EXPORT_PRESENTATIONS: Record<FileExportFormat, FormatPresentation> = {
  html: {
    nameKey: 'files.formatHtml',
    extension: '.html',
    descriptionKey: 'files.exportHtmlDescription',
    icon: <CodeXml size={18} aria-hidden="true" />,
  },
  pdf: {
    nameKey: 'files.formatPdf',
    extension: '.pdf',
    descriptionKey: 'files.exportPdfDescription',
    icon: <FileType2 size={18} aria-hidden="true" />,
  },
  markdown: {
    nameKey: 'files.formatMarkdown',
    extension: '.md',
    descriptionKey: 'files.exportMarkdownDescription',
    icon: <FileText size={18} aria-hidden="true" />,
  },
  adoc: {
    nameKey: 'files.formatAsciiDoc',
    extension: '.adoc',
    descriptionKey: 'files.exportAsciiDocDescription',
    icon: <Braces size={18} aria-hidden="true" />,
  },
  slides: {
    nameKey: 'files.formatSlides',
    extension: '.html',
    descriptionKey: 'files.exportSlidesDescription',
    icon: <Presentation size={18} aria-hidden="true" />,
  },
};

const IMPORT_PRESENTATIONS: Record<FileImportFormat, FormatPresentation> = {
  markdown: {
    nameKey: 'files.formatMarkdown',
    extension: '.md',
    descriptionKey: 'files.importMarkdownDescription',
    icon: <FileText size={18} aria-hidden="true" />,
  },
  html: {
    nameKey: 'files.formatHtml',
    extension: '.html',
    descriptionKey: 'files.importHtmlDescription',
    icon: <CodeXml size={18} aria-hidden="true" />,
  },
};

function OperationStatus({ state }: { state: FileOperationState }): React.ReactElement | null {
  const { t } = useEditorI18n();
  if (state.phase === 'idle') return null;

  if (state.phase === 'running') {
    return (
      <div className="file-operation-status is-running" role="status" aria-live="polite">
        <LoaderCircle size={14} aria-hidden="true" />
        <span>{state.stage || t(
          state.kind === 'export' ? 'files.exporting' : 'files.importing',
          { format: state.format },
        )}</span>
      </div>
    );
  }
  if (state.phase === 'succeeded') {
    if (state.result === 'fallback') {
      return (
        <div className="file-operation-status is-warning" role="status" aria-live="polite">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{t('files.completedWithFallback')}</span>
        </div>
      );
    }
    return (
      <div className="file-operation-status is-succeeded" role="status" aria-live="polite">
        <CircleCheck size={14} aria-hidden="true" />
        <span>{t('files.completed')}</span>
      </div>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div className="file-operation-status is-failed" role="alert" aria-live="assertive">
        <CircleX size={14} aria-hidden="true" />
        <span>{state.error.message}</span>
      </div>
    );
  }
  return (
    <div className="file-operation-status is-cancelled" role="status" aria-live="polite">
      <XCircle size={14} aria-hidden="true" />
      <span>{t('files.cancelled')}</span>
    </div>
  );
}

function FormatRow<Format extends FileExportFormat | FileImportFormat>({
  kind,
  capability,
  presentation,
  busy,
  running,
  onStart,
}: {
  kind: FileOperationKind;
  capability: FileFormatCapability<Format>;
  presentation: FormatPresentation;
  busy: boolean;
  running: boolean;
  onStart: (kind: FileOperationKind, format: Format) => void;
}): React.ReactElement {
  const { t } = useEditorI18n();
  const reasonId = useId();
  const unavailable = !capability.available;
  const disabled = busy || unavailable;
  return (
    <button
      type="button"
      className={[
        'file-operation-row',
        running ? 'is-running' : '',
        unavailable ? 'is-unavailable' : '',
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      aria-describedby={unavailable ? reasonId : undefined}
      onClick={() => {
        if (!disabled) onStart(kind, capability.format);
      }}
    >
      <span className="file-operation-format-icon">{presentation.icon}</span>
      <span className="file-operation-body">
        <span className="file-operation-heading">
          <strong>{t(presentation.nameKey)}</strong>
          <span className="file-operation-extension">{presentation.extension}</span>
        </span>
        <span className="file-operation-description">{t(presentation.descriptionKey)}</span>
        {unavailable && (
          <span id={reasonId} className="file-operation-unavailable">
            <TriangleAlert size={12} aria-hidden="true" />
            {t('files.unavailableReason', { reason: capability.unavailableReason })}
          </span>
        )}
      </span>
    </button>
  );
}

export const FilesPanel: React.FC<FilesPanelProps> = ({
  exportFormats,
  importFormats,
  operationState,
  onStart,
  onViewJson,
}) => {
  const { t } = useEditorI18n();
  const busy = isFileOperationRunning(operationState);

  return (
    <section className="files-panel side-panel-section" aria-busy={busy}>
      <OperationStatus state={operationState} />

      {exportFormats.length > 0 && (
        <section className="files-panel-group" aria-labelledby="files-export-title">
          <div id="files-export-title" className="side-panel-section-title">
            {t('panel.export')}
          </div>
          <p className="side-panel-section-desc">{t('panel.exportDescription')}</p>
          <div className="file-operation-list">
            {exportFormats.map((capability) => (
              <FormatRow
                key={capability.format}
                kind="export"
                capability={capability}
                presentation={EXPORT_PRESENTATIONS[capability.format]}
                busy={busy}
                running={operationState.phase === 'running'
                  && operationState.kind === 'export'
                  && operationState.format === capability.format}
                onStart={onStart}
              />
            ))}
          </div>
        </section>
      )}

      {importFormats.length > 0 && (
        <section className="files-panel-group" aria-labelledby="files-import-title">
          <div id="files-import-title" className="side-panel-section-title">
            {t('panel.import')}
          </div>
          <p className="side-panel-section-desc">{t('panel.importDescription')}</p>
          <div className="file-operation-list">
            {importFormats.map((capability) => (
              <FormatRow
                key={capability.format}
                kind="import"
                capability={capability}
                presentation={IMPORT_PRESENTATIONS[capability.format]}
                busy={busy}
                running={operationState.phase === 'running'
                  && operationState.kind === 'import'
                  && operationState.format === capability.format}
                onStart={onStart}
              />
            ))}
          </div>
        </section>
      )}

      {onViewJson && (
        <details className="files-panel-advanced">
          <summary>{t('files.advanced')}</summary>
          <button
            type="button"
            className="file-operation-row file-operation-json"
            disabled={busy}
            onClick={onViewJson}
          >
            <span className="file-operation-format-icon">
              <FileJson size={18} aria-hidden="true" />
            </span>
            <span className="file-operation-body">
              <span className="file-operation-heading">
                <strong>{t('panel.jsonSource')}</strong>
                <span className="file-operation-extension">.json</span>
              </span>
              <span className="file-operation-description">
                {t('files.jsonDescription')}
              </span>
            </span>
          </button>
        </details>
      )}

      {exportFormats.length === 0 && importFormats.length === 0 && !onViewJson && (
        <p className="files-panel-unavailable" role="status">
          {t('files.hostUnavailable')}
        </p>
      )}
    </section>
  );
};
