import React, { useEffect, useId, useRef, type ReactNode } from 'react';
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
  isFileOperationActive,
  type FileOperationPlanView,
  type FileOperationResultAction,
  type FileOperationKind,
  type FileOperationState,
} from '../fileOperations';
import type { DocumentSettingKey, DocumentSettingSource } from '../../types';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';
import { ModalDialog } from './ModalDialog';

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
  onConfirm: (planId: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onResultAction: (action: FileOperationResultAction, artifactId?: string) => void;
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

const SETTING_LABEL_KEYS: Partial<Record<DocumentSettingKey, EditorTranslationKey>> = {
  headingNumbering: 'settings.headingNumbering',
  headingStartNumber: 'settings.headingStartNumber',
  headingDecoration: 'settings.decoration',
  captionStyle: 'settings.captionStyle',
  captionNumbering: 'files.settingCaptionNumbering',
  equationNumbering: 'files.settingEquationNumbering',
  crossRefIncludeCaption: 'settings.includeCaptionCrossRef',
  slideCssPath: 'settings.slideCss',
  htmlCssPath: 'settings.htmlCss',
  pdfScale: 'settings.pdfScale',
  selfContained: 'settings.htmlEmbedding',
  slideBreakLevel: 'settings.slideSplit',
  slideTransition: 'settings.transition',
  showTitleSlide: 'settings.titleSlide',
  outputDir: 'settings.outputFolder',
};

const SETTINGS_SOURCE_LABEL_KEYS = {
  document: 'settings.sourceDocument',
  'book-profile': 'settings.sourceBook',
  host: 'settings.sourceHost',
  'built-in': 'settings.sourceBuiltIn',
  'temporary-view': 'settings.sourceTemporary',
} as const satisfies Record<DocumentSettingSource, EditorTranslationKey>;

const headingColorLevel = (key: DocumentSettingKey): number | undefined => {
  const match = /^headingH([1-6])Color$/.exec(key);
  return match ? Number(match[1]) : undefined;
};

function PreflightDialog({
  plan,
  onConfirm,
  onCancel,
  fallbackFocusRef,
}: {
  plan: FileOperationPlanView;
  onConfirm: () => void;
  onCancel: () => void;
  fallbackFocusRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement {
  const { t } = useEditorI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const importPreview = plan.importPreview;
  const knownWarnings = new Set([
    'The existing destination will be replaced.',
    'PDF is unavailable; an HTML fallback will be created.',
    'The document body will be replaced; metadata and settings are preserved.',
  ]);
  const additionalWarnings = plan.warnings.filter((warning) => !knownWarnings.has(warning));
  const settingLabel = (key: DocumentSettingKey): string => {
    const level = headingColorLevel(key);
    if (level !== undefined) return t('settings.headingColor', { level });
    const labelKey = SETTING_LABEL_KEYS[key];
    return labelKey ? t(labelKey) : key;
  };
  return (
    <ModalDialog
      className="file-operation-preflight"
      role="alertdialog"
      size="md"
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocusRef={cancelRef}
      fallbackFocusRef={fallbackFocusRef}
      onCancel={onCancel}
    >
      <div className="modal-body">
        <h3 id={titleId}>{t(plan.intent.kind === 'export'
          ? 'files.confirmExportTitle' : 'files.confirmImportTitle')}</h3>
        <p id={descriptionId}>{t('files.preflightDescription')}</p>
        <dl className="file-operation-summary">
        <div><dt>{t('files.source')}</dt><dd>{plan.source.displayName}</dd></div>
        <div><dt>{t('files.size')}</dt><dd>{t('files.bytes', { count: plan.source.sizeBytes })}</dd></div>
        {plan.destination && (
          <>
            <div>
              <dt>{t('files.destination')}</dt>
              <dd>{plan.destination.displayName}</dd>
            </div>
            {plan.destination.scope && <div>
              <dt>{t('files.destinationScope')}</dt>
              <dd>{t(`files.destinationScope.${plan.destination.scope}` as EditorTranslationKey)}</dd>
            </div>}
            {plan.destination.relativePath && <div>
              <dt>{t('files.relativePath')}</dt>
              <dd><code>{plan.destination.relativePath}</code></dd>
            </div>}
          </>
        )}
        </dl>
        {plan.effectiveSettings && <section
          className="file-operation-effective-settings"
          aria-labelledby={`${titleId}-settings`}
        >
          <h4 id={`${titleId}-settings`}>{t('files.effectiveSettings')}</h4>
          <dl>
            {plan.effectiveSettings.items.map((item) => <div key={item.key}>
              <dt>{settingLabel(item.key)}</dt>
              <dd>
                <code>{item.value}</code>
                <span className="settings-badge">{t(SETTINGS_SOURCE_LABEL_KEYS[item.source])}</span>
              </dd>
            </div>)}
          </dl>
          <p className="file-operation-fingerprint">
            <span>{t('files.settingsFingerprint')}</span> <code>{plan.effectiveSettings.fingerprint}</code>
          </p>
        </section>}
        {plan.diagram && <section className="file-operation-diagram-summary">
          <h4>{t('files.diagramPolicy')}</h4>
          <p>{t(plan.diagram.failurePolicy === 'fail'
            ? 'files.diagramPolicyFail' : 'files.diagramPolicyFallback')}</p>
          <p>{t(plan.diagram.fallbackCount === 0
            ? 'files.diagramFallbackNone'
            : plan.diagram.fallbackCount === 1
              ? 'files.diagramFallbackOne'
              : 'files.diagramFallbackCount', { count: plan.diagram.fallbackCount })}</p>
        </section>}
        {plan.destination?.exists && (
          <p className="file-operation-overwrite"><TriangleAlert size={14} aria-hidden="true" />
            {t('files.overwriteWarning')}
          </p>
        )}
        {plan.intent.kind === 'export' && plan.intent.format === 'pdf'
          && plan.destination?.displayName.toLowerCase().endsWith('.html') && (
          <p className="file-operation-overwrite"><TriangleAlert size={14} aria-hidden="true" />
            {t('files.pdfFallbackWarning')}
          </p>
        )}
        {importPreview && (
          <div className="file-operation-import-preview">
            <p>{t('files.topLevelBlocks', { count: importPreview.topLevelBlockCount })}</p>
            <p>{t('files.importPreservesSettings')}</p>
            {importPreview.outline.length > 0 && (
              <ol aria-label={t('files.importOutline')}>
                {importPreview.outline.map((item, index) => (
                  <li key={`${item.level}-${index}`}>{item.title}</li>
                ))}
              </ol>
            )}
          </div>
        )}
        {additionalWarnings.length > 0 && (
          <ul className="file-operation-warnings">
            {additionalWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        )}
      </div>
      <div className="modal-footer file-operation-dialog-actions">
        <button ref={cancelRef} type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="is-primary" onClick={onConfirm}>
          {t(plan.intent.kind === 'export' ? 'files.exportFile' : 'files.importContent')}
        </button>
      </div>
    </ModalDialog>
  );
}

function OperationStatus({
  state,
  onCancel,
  onRetry,
  onResultAction,
}: {
  state: FileOperationState;
  onCancel: () => void;
  onRetry: () => void;
  onResultAction: (action: FileOperationResultAction, artifactId?: string) => void;
}): React.ReactElement | null {
  const { t } = useEditorI18n();
  if (state.phase === 'idle') return null;
  if (state.phase === 'awaiting-confirmation') return null;

  if (state.phase === 'preflighting' || state.phase === 'running') {
    return (
      <div className="file-operation-status is-running" role="status" aria-live="polite">
        <LoaderCircle size={14} aria-hidden="true" />
        <span>{state.stage}</span>
        <button type="button" autoFocus onClick={onCancel}>
          {t('files.cancelOperation')}
        </button>
      </div>
    );
  }
  if (state.phase === 'succeeded') {
    const importedToBuffer = state.intent?.kind === 'import';
    return (
      <div className={`file-operation-result ${state.result === 'fallback' ? 'is-warning' : 'is-succeeded'}`} role="status" aria-live="polite">
        {state.result === 'fallback'
          ? <TriangleAlert size={14} aria-hidden="true" />
          : <CircleCheck size={14} aria-hidden="true" />}
        <span>{t(importedToBuffer
          ? 'files.importApplied'
          : state.result === 'fallback' ? 'files.completedWithFallback' : 'files.completed')}</span>
        {importedToBuffer && <span className="file-operation-persistence-note">
          {t('files.importSaveRequired')}
        </span>}
        {state.details?.artifact && (
          <span className="file-operation-artifact">
            {state.details.artifact.displayName} · {t('files.bytes', { count: state.details.artifact.sizeBytes })}
          </span>
        )}
        {state.details && state.details.warnings.length > 0 && (
          <ul className="file-operation-warnings">
            {state.details.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        )}
        {state.details && state.details.availableActions.length > 0 && (
          <div className="file-operation-result-actions">
            {state.details.availableActions.map((item) => (
              <button
                key={item.action}
                type="button"
                onClick={() => onResultAction(item.action, 'artifactId' in item ? item.artifactId : undefined)}
              >
                {t(`files.action.${item.action}` as EditorTranslationKey)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div className="file-operation-status is-failed" role="alert" aria-live="assertive">
        <CircleX size={14} aria-hidden="true" />
        <span>{state.error.message}</span>
        {state.error.retryable && state.intent && (
          <button type="button" onClick={onRetry}>{t('common.retry')}</button>
        )}
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
  onTrigger,
}: {
  kind: FileOperationKind;
  capability: FileFormatCapability<Format>;
  presentation: FormatPresentation;
  busy: boolean;
  running: boolean;
  onStart: (kind: FileOperationKind, format: Format) => void;
  onTrigger: (element: HTMLButtonElement) => void;
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
      onClick={(event) => {
        if (!disabled) {
          onTrigger(event.currentTarget);
          onStart(kind, capability.format);
        }
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
  onConfirm,
  onCancel,
  onRetry,
  onResultAction,
  onViewJson,
}) => {
  const { t } = useEditorI18n();
  const busy = isFileOperationActive(operationState);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusPendingRef = useRef(false);
  useEffect(() => {
    if (restoreFocusPendingRef.current && !isFileOperationActive(operationState)) {
      restoreFocusPendingRef.current = false;
      triggerRef.current?.focus();
    }
  }, [operationState]);
  const cancelAndRestore = (): void => {
    restoreFocusPendingRef.current = true;
    onCancel();
  };

  return (
    <section className="files-panel side-panel-section" aria-busy={busy}>
      {operationState.phase === 'awaiting-confirmation' && (
        <PreflightDialog
          plan={operationState.plan}
          fallbackFocusRef={triggerRef}
          onConfirm={() => {
            restoreFocusPendingRef.current = true;
            onConfirm(operationState.plan.planId);
          }}
          onCancel={cancelAndRestore}
        />
      )}
      <div
        className="files-panel-background"
        inert={operationState.phase === 'awaiting-confirmation' ? true : undefined}
        aria-hidden={operationState.phase === 'awaiting-confirmation' ? true : undefined}
      >
      <OperationStatus
        state={operationState}
        onCancel={cancelAndRestore}
        onRetry={() => {
          restoreFocusPendingRef.current = true;
          onRetry();
        }}
        onResultAction={(action, artifactId) => {
          if (action === 'repeat' || action === 'undo') {
            restoreFocusPendingRef.current = true;
          }
          onResultAction(action, artifactId);
        }}
      />

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
                onTrigger={(element) => {
                  triggerRef.current = element;
                  restoreFocusPendingRef.current = true;
                }}
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
                onTrigger={(element) => {
                  triggerRef.current = element;
                  restoreFocusPendingRef.current = true;
                }}
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
      </div>
    </section>
  );
};
