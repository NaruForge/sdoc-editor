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
import { useEditorI18n } from '../i18n';

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
  name: string;
  extension: string;
  description: string;
  icon: ReactNode;
}

const EXPORT_PRESENTATIONS: Record<FileExportFormat, FormatPresentation> = {
  html: {
    name: 'HTML',
    extension: '.html',
    description: 'Web page for sharing or publishing.',
    icon: <CodeXml size={18} aria-hidden="true" />,
  },
  pdf: {
    name: 'PDF',
    extension: '.pdf',
    description: 'Print-ready portable document.',
    icon: <FileType2 size={18} aria-hidden="true" />,
  },
  markdown: {
    name: 'Markdown',
    extension: '.md',
    description: 'Plain-text Markdown document.',
    icon: <FileText size={18} aria-hidden="true" />,
  },
  adoc: {
    name: 'AsciiDoc',
    extension: '.adoc',
    description: 'AsciiDoc source document.',
    icon: <Braces size={18} aria-hidden="true" />,
  },
  slides: {
    name: 'Slides',
    extension: '.html',
    description: 'Browser presentation powered by reveal.js.',
    icon: <Presentation size={18} aria-hidden="true" />,
  },
};

const IMPORT_PRESENTATIONS: Record<FileImportFormat, FormatPresentation> = {
  markdown: {
    name: 'Markdown',
    extension: '.md',
    description: 'Import Markdown content into this document.',
    icon: <FileText size={18} aria-hidden="true" />,
  },
  html: {
    name: 'HTML',
    extension: '.html',
    description: 'Import HTML content into this document.',
    icon: <CodeXml size={18} aria-hidden="true" />,
  },
};

function OperationStatus({ state }: { state: FileOperationState }): React.ReactElement | null {
  if (state.phase === 'idle') return null;

  if (state.phase === 'running') {
    const action = state.kind === 'export' ? 'Exporting' : 'Importing';
    return (
      <div className="file-operation-status is-running" role="status" aria-live="polite">
        <LoaderCircle size={14} aria-hidden="true" />
        <span>{state.stage || `${action} ${state.format}…`}</span>
      </div>
    );
  }
  if (state.phase === 'succeeded') {
    if (state.result === 'fallback') {
      return (
        <div className="file-operation-status is-warning" role="status" aria-live="polite">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>Completed with fallback.</span>
        </div>
      );
    }
    return (
      <div className="file-operation-status is-succeeded" role="status" aria-live="polite">
        <CircleCheck size={14} aria-hidden="true" />
        <span>File operation completed.</span>
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
      <span>File operation cancelled.</span>
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
          <strong>{presentation.name}</strong>
          <span className="file-operation-extension">{presentation.extension}</span>
        </span>
        <span className="file-operation-description">{presentation.description}</span>
        {unavailable && (
          <span id={reasonId} className="file-operation-unavailable">
            <TriangleAlert size={12} aria-hidden="true" />
            Unavailable: {capability.unavailableReason}
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
          <summary>Advanced</summary>
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
                Inspect the structured document source.
              </span>
            </span>
          </button>
        </details>
      )}

      {exportFormats.length === 0 && importFormats.length === 0 && !onViewJson && (
        <p className="files-panel-unavailable" role="status">
          File operations are unavailable in this host.
        </p>
      )}
    </section>
  );
};
