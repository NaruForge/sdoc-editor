import type { EditorToHostMessage, HostToEditorMessage } from './messages';
import { isDiagramImageDataUrl } from '../diagramRenderer';
import { MAX_ASSET_BYTES } from '../resourceLimits';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasString = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'string';

const hasNumber = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'number' && Number.isFinite(value[key]);

const isBoundedBase64Asset = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length <= Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 4;

const isDiagramRendererSettings = (value: unknown): boolean =>
  isRecord(value)
  && typeof value.consent === 'string'
  && ['undecided', 'granted', 'declined'].includes(value.consent)
  && typeof value.endpoint === 'string'
  && value.endpoint.length <= 2048
  && typeof value.allowPrivateNetwork === 'boolean';

const hasTemplateRequestIdentity = (value: Record<string, unknown>): boolean =>
  hasString(value, 'requestId')
  && hasString(value, 'sessionId')
  && hasString(value, 'documentId')
  && hasNumber(value, 'baseRevision');

const isPersonalTemplateMetadataInput = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.name !== 'string') return false;
  const name = value.name;
  if (name !== name.trim() || name.length < 1 || name.length > 200) return false;
  if (value.description !== undefined
    && (typeof value.description !== 'string' || value.description.length > 2_000)) return false;
  if (value.category !== undefined
    && (typeof value.category !== 'string' || value.category.length > 100)) return false;
  return true;
};

const TEMPLATE_ERROR_CODES = [
  'catalog-unavailable', 'document-changed', 'template-unavailable',
  'template-changed', 'invalid-document', 'operation-failed',
] as const;

const containsUnsafeAbsolutePath = (value: string): boolean =>
  /(?:file:\/{2,}|[A-Za-z]:[\\/]|\\\\|(?:^|[\s("'=])\/(?!\/)(?:[^/\s]+\/)*[^/\s]*)/i.test(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const FILE_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const FILE_OPERATION_FORMATS = ['html', 'adoc', 'markdown', 'pdf', 'slides'] as const;
const FILE_OPERATION_ACTIONS = ['open', 'reveal', 'copy', 'repeat', 'undo'] as const;
const FILE_OPERATION_SETTING_KEYS = [
  'headingNumbering', 'headingStartNumber', 'headingDecoration',
  'headingH1Color', 'headingH2Color', 'headingH3Color',
  'headingH4Color', 'headingH5Color', 'headingH6Color',
  'captionStyle', 'captionNumbering', 'equationNumbering', 'crossRefIncludeCaption',
  'slideCssPath', 'htmlCssPath', 'pdfScale', 'selfContained',
  'slideBreakLevel', 'slideTransition', 'showTitleSlide', 'outputDir',
] as const;
const FILE_OPERATION_SETTING_SOURCES = [
  'document', 'book-profile', 'host', 'built-in', 'temporary-view',
] as const;

const isFileOperationId = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && FILE_OPERATION_ID_PATTERN.test(value);

const isSafeFileOperationText = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= maxLength
  && !/[\u0000-\u001F\u007F]/.test(value)
  && !containsUnsafeAbsolutePath(value);

// Document identity is an opaque host correlation token and is commonly a file URI.
// It is never rendered as a result path or used to resolve a filesystem target.
const isFileOperationDocumentId = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 4_096
  && !/[\u0000-\u001F\u007F]/.test(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= 0;

const hasFileOperationRequestIdentity = (value: Record<string, unknown>): boolean =>
  isFileOperationId(value.requestId)
  && isFileOperationId(value.sessionId)
  && isFileOperationDocumentId(value.documentId);

const isFileOperationIntent = (value: unknown): boolean => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'format'])) return false;
  if (value.kind === 'import') return value.format === 'html' || value.format === 'markdown';
  return value.kind === 'export' && FILE_OPERATION_FORMATS.includes(
    String(value.format) as typeof FILE_OPERATION_FORMATS[number],
  );
};

const isFileOperationSourceView = (value: unknown): boolean =>
  isRecord(value)
  && hasOnlyKeys(value, ['displayName', 'sizeBytes', 'revision'])
  && isSafeFileOperationText(value.displayName, 260)
  && isNonNegativeInteger(value.sizeBytes)
  && (value.revision === undefined || isNonNegativeInteger(value.revision));

const isPortableRelativePath = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length < 3 || value.length > 4_096
    || /[\u0000-\u001F\u007F]/.test(value) || value.includes('\\')
    || !value.startsWith('./') || value.includes(':')) return false;
  return value.split('/').every((segment) => segment !== '..');
};

const isFileOperationDestinationView = (value: unknown): boolean => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['displayName', 'exists', 'scope', 'relativePath'])
    || !isSafeFileOperationText(value.displayName, 520)
    || typeof value.exists !== 'boolean') return false;
  const hasScope = value.scope !== undefined || value.relativePath !== undefined;
  return !hasScope || (
    (value.scope === 'document' || value.scope === 'workspace' || value.scope === 'book')
    && isPortableRelativePath(value.relativePath)
  );
};

const isFileOperationEffectiveSettings = (value: unknown): boolean =>
  isRecord(value)
  && hasOnlyKeys(value, ['fingerprint', 'items'])
  && typeof value.fingerprint === 'string'
  && /^sha256:[0-9a-f]{64}$/.test(value.fingerprint)
  && Array.isArray(value.items)
  && value.items.length <= FILE_OPERATION_SETTING_KEYS.length
  && value.items.every((item) => isRecord(item)
    && hasOnlyKeys(item, ['key', 'value', 'source'])
    && FILE_OPERATION_SETTING_KEYS.includes(
      String(item.key) as typeof FILE_OPERATION_SETTING_KEYS[number],
    )
    && typeof item.value === 'string'
    && item.value.length <= 1_000
    && FILE_OPERATION_SETTING_SOURCES.includes(
      String(item.source) as typeof FILE_OPERATION_SETTING_SOURCES[number],
    ));

const isFileOperationDiagram = (value: unknown): boolean =>
  isRecord(value)
  && hasOnlyKeys(value, ['failurePolicy', 'fallbackCount'])
  && (value.failurePolicy === 'fail' || value.failurePolicy === 'source-fallback')
  && isNonNegativeInteger(value.fallbackCount);

const isFileOperationImportPreview = (value: unknown): boolean => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['outline', 'topLevelBlockCount', 'replacement', 'preserved'])
    || !Array.isArray(value.outline)
    || value.outline.length > 200
    || !isNonNegativeInteger(value.topLevelBlockCount)
    || value.replacement !== 'body-only'
    || !Array.isArray(value.preserved)
    || value.preserved.length !== 2
    || value.preserved[0] !== 'metadata'
    || value.preserved[1] !== 'settings') return false;
  return value.outline.every((item) => isRecord(item)
    && hasOnlyKeys(item, ['level', 'title'])
    && isNonNegativeInteger(item.level)
    && item.level >= 1
    && item.level <= 6
    && isSafeFileOperationText(item.title, 500));
};

const isFileOperationWarnings = (value: unknown): value is string[] =>
  Array.isArray(value)
  && value.length <= 100
  && value.every((warning) => isSafeFileOperationText(warning, 1_000));

const isFileOperationPlanView = (value: unknown): boolean => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'planId', 'intent', 'source', 'destination', 'importPreview',
      'effectiveSettings', 'diagram', 'warnings', 'requiresConfirmation',
    ])
    || !isFileOperationId(value.planId)
    || !isFileOperationIntent(value.intent)
    || !isFileOperationSourceView(value.source)
    || !isFileOperationWarnings(value.warnings)
    || (value.effectiveSettings !== undefined
      && !isFileOperationEffectiveSettings(value.effectiveSettings))
    || (value.diagram !== undefined && !isFileOperationDiagram(value.diagram))
    || typeof value.requiresConfirmation !== 'boolean') return false;
  const intent = value.intent as { kind: 'export' | 'import' };
  if (intent.kind === 'import') {
    return value.destination === undefined && isFileOperationImportPreview(value.importPreview);
  }
  return isFileOperationDestinationView(value.destination) && value.importPreview === undefined;
};

const isFileOperationArtifactView = (value: unknown): boolean =>
  isRecord(value)
  && hasOnlyKeys(value, ['artifactId', 'displayName', 'sizeBytes'])
  && isFileOperationId(value.artifactId)
  && isSafeFileOperationText(value.displayName, 260)
  && isNonNegativeInteger(value.sizeBytes);

const isFileOperationResult = (value: unknown): boolean => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['outcome', 'artifact', 'warnings', 'availableActions'])
    || (value.outcome !== 'completed' && value.outcome !== 'fallback')
    || (value.artifact !== undefined && !isFileOperationArtifactView(value.artifact))
    || !isFileOperationWarnings(value.warnings)
    || !Array.isArray(value.availableActions)
    || value.availableActions.length > FILE_OPERATION_ACTIONS.length
    || !value.availableActions.every((item) => {
      if (!isRecord(item)
        || !hasOnlyKeys(item, ['action', 'artifactId'])
        || !FILE_OPERATION_ACTIONS.includes(
          String(item.action) as typeof FILE_OPERATION_ACTIONS[number],
        )) return false;
      return item.action === 'repeat'
        ? item.artifactId === undefined
        : isFileOperationId(item.artifactId);
    })) return false;
  return new Set(value.availableActions.map((item) => (item as { action: unknown }).action)).size
    === value.availableActions.length;
};

const isTemplateOperationError = (value: unknown): boolean =>
  isRecord(value)
  && hasOnlyKeys(value, ['code', 'message'])
  && TEMPLATE_ERROR_CODES.includes(String(value.code) as typeof TEMPLATE_ERROR_CODES[number])
  && hasString(value, 'message')
  && String(value.message).length <= 1_000
  && !/[\u0000-\u001F\u007F]/.test(String(value.message))
  && !containsUnsafeAbsolutePath(String(value.message));

const isDocumentMutation = (value: unknown): boolean =>
  isRecord(value)
  && isRecord(value.content)
  && value.content.type === 'doc'
  && isRecord(value.meta)
  && (value.documentSettings === null || isRecord(value.documentSettings));

const isContractDiagnostics = (value: unknown): boolean =>
  Array.isArray(value)
  && value.length > 0
  && value.length <= 100
  && value.every((item) => isRecord(item)
    && hasString(item, 'path') && String(item.path).length <= 1_000
    && hasString(item, 'message') && String(item.message).length <= 2_000);

const isInvalidDocumentReason = (value: unknown): boolean =>
  ['invalid-json', 'malformed', 'unsupported-version', 'too-large'].includes(String(value));

const isEditorDocumentState = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.status === 'ready') return isDocumentMutation(value.snapshot);
  return value.status === 'invalid'
    && isInvalidDocumentReason(value.reason)
    && isContractDiagnostics(value.diagnostics);
};

const isMutationErrorCode = (value: unknown): boolean =>
  ['STALE_REVISION', 'EXTERNAL_CHANGE', 'INVALID_DOCUMENT', 'WRITE_FAILED', 'TRANSPORT_ERROR', 'UNKNOWN']
    .includes(String(value));

const isTemplatePreview = (value: unknown): boolean => {
  if (!isRecord(value) || !hasString(value, 'templateId') || !Array.isArray(value.outline)
    || !isRecord(value.counts) || !Array.isArray(value.settingsKeys)
    || typeof value.truncated !== 'boolean') return false;
  return value.outline.every((item) => isRecord(item)
    && hasNumber(item, 'level') && hasString(item, 'text')
    && typeof item.numbered === 'boolean' && typeof item.isTitle === 'boolean'
    && (item.id === undefined || typeof item.id === 'string'))
    && ['headings', 'paragraphs', 'tables', 'figures', 'equations', 'diagrams', 'codeBlocks']
      .every((key) => hasNumber(value.counts as Record<string, unknown>, key))
    && value.settingsKeys.every((item) => typeof item === 'string');
};

const isTemplateDescriptor = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return hasString(value, 'id')
    && hasString(value, 'name')
    && hasString(value, 'sourceLabel')
    && ['builtin', 'workspace', 'user'].includes(String(value.source))
    && (value.description === undefined || typeof value.description === 'string')
    && (value.category === undefined || typeof value.category === 'string')
    && (value.titleNodeId === undefined || typeof value.titleNodeId === 'string')
    && (value.revisionToken === undefined || typeof value.revisionToken === 'string')
    && (value.preview === undefined || isTemplatePreview(value.preview));
};

const TEMPLATE_DIAGNOSTIC_CODES = [
  'malformed-document', 'unsupported-version', 'legacy-document',
  'invalid-template-metadata', 'invalid-template-id', 'duplicate-template-id',
  'invalid-title-node', 'unsupported-assets', 'read-failed', 'unsafe-path',
  'file-too-large', 'candidate-limit-exceeded', 'unsupported-filesystem',
] as const;

const isTemplateCatalogDiagnosticView = (value: unknown): boolean =>
  isRecord(value)
  && hasString(value, 'id')
  && TEMPLATE_DIAGNOSTIC_CODES.includes(String(value.code) as typeof TEMPLATE_DIAGNOSTIC_CODES[number])
  && ['builtin', 'workspace', 'user', 'catalog'].includes(String(value.source))
  && (value.severity === 'warning' || value.severity === 'error')
  && hasString(value, 'targetLabel')
  && !/^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|etc|mnt|opt|private)\/)/i
    .test(String(value.targetLabel))
  && (value.jsonPath === undefined || (typeof value.jsonPath === 'string' && value.jsonPath.startsWith('/')))
  && (value.detail === undefined || typeof value.detail === 'string')
  && ['retry', 'fix-source', 'resolve-duplicate', 'none'].includes(String(value.recovery));

const isFileOperationError = (value: unknown): boolean =>
  isRecord(value)
  && hasOnlyKeys(value, ['code', 'message', 'retryable'])
  && isSafeFileOperationText(value.code, 80)
  && isSafeFileOperationText(value.message, 500)
  && typeof value.retryable === 'boolean';

const isFileOperationState = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.phase !== 'string') return false;
  switch (value.phase) {
    case 'idle':
      return hasOnlyKeys(value, ['phase']);
    case 'preflighting':
      return hasOnlyKeys(value, ['phase', 'requestId', 'intent', 'stage'])
        && isFileOperationId(value.requestId)
        && isFileOperationIntent(value.intent)
        && isSafeFileOperationText(value.stage, 500);
    case 'awaiting-confirmation':
      return hasOnlyKeys(value, ['phase', 'requestId', 'intent', 'plan'])
        && isFileOperationId(value.requestId)
        && isFileOperationIntent(value.intent)
        && isFileOperationPlanView(value.plan)
        && isRecord(value.intent)
        && isRecord(value.plan)
        && isRecord(value.plan.intent)
        && value.intent.kind === value.plan.intent.kind
        && value.intent.format === value.plan.intent.format;
    case 'running':
      if (!hasOnlyKeys(value, [
        'phase', 'requestId', 'kind', 'format', 'stage', 'intent', 'planId',
      ])
        || !isFileOperationId(value.requestId)) return false;
      if (value.kind !== 'export' && value.kind !== 'import') return false;
      if (!isSafeFileOperationText(value.format, 40)
        || !isSafeFileOperationText(value.stage, 500)) return false;
      if (value.intent === undefined) return value.planId === undefined;
      return isFileOperationIntent(value.intent)
        && (value.planId === undefined || isFileOperationId(value.planId))
        && isRecord(value.intent)
        && value.intent.kind === value.kind
        && value.intent.format === value.format;
    case 'succeeded':
      return hasOnlyKeys(value, ['phase', 'requestId', 'result', 'intent', 'details'])
        && isFileOperationId(value.requestId)
        && (value.result === 'completed' || value.result === 'fallback')
        && (value.intent === undefined || isFileOperationIntent(value.intent))
        && (value.details === undefined || (isFileOperationResult(value.details)
          && isRecord(value.details) && value.details.outcome === value.result));
    case 'failed':
      return hasOnlyKeys(value, ['phase', 'requestId', 'error', 'intent'])
        && isFileOperationId(value.requestId)
        && isFileOperationError(value.error)
        && (value.intent === undefined || isFileOperationIntent(value.intent));
    case 'cancelled':
      return hasOnlyKeys(value, ['phase', 'requestId', 'intent'])
        && isFileOperationId(value.requestId)
        && (value.intent === undefined || isFileOperationIntent(value.intent));
    default:
      return false;
  }
};

const isDiagramFailureCode = (value: unknown): boolean =>
  [
    'disabled', 'invalid-endpoint', 'blocked-address', 'source-too-large',
    'timeout', 'offline', 'rate-limited', 'server-error', 'redirect',
    'response-too-large', 'invalid-response', 'cancelled',
  ].includes(String(value));

export function isEditorToHostMessage(value: unknown): value is EditorToHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'ready':
    case 'viewJson':
    case 'importDrawio':
    case 'insertExistingImage':
    case 'browseSdocFiles':
      return true;
    case 'uiReady':
      return hasString(value, 'sessionId') && hasString(value, 'documentId');
    case 'editorTextFocusChanged':
      return hasString(value, 'sessionId')
        && hasString(value, 'documentId')
        && typeof value.focused === 'boolean';
    case 'webviewPerformanceMeasurement':
      return hasString(value, 'sessionId')
        && hasString(value, 'documentId')
        && value.name === 'webview-checkpoint-to-ack-received'
        && hasNumber(value, 'durationMs') && Number(value.durationMs) >= 0
        && hasNumber(value, 'operationCount')
        && Number.isSafeInteger(value.operationCount) && Number(value.operationCount) >= 0;
    case 'requestTemplateCatalog':
      return hasString(value, 'requestId');
    case 'flushComplete':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasString(value, 'requestId');
    case 'flushFailed':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasString(value, 'requestId')
        && isMutationErrorCode(value.code) && hasString(value, 'message');
    case 'edit':
      return hasString(value, 'sessionId')
        && hasString(value, 'documentId')
        && hasString(value, 'editId')
        && hasNumber(value, 'baseRevision')
        && hasNumber(value, 'localGeneration')
        && isDocumentMutation(value.mutation)
        && (value.flushRequestId === undefined || hasString(value, 'flushRequestId'));
    case 'applyTemplate':
      return typeof value.templateId === 'string' && value.templateId.length > 0
        && hasString(value, 'requestId')
        && hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'baseRevision');
    case 'createDocumentFromTemplate':
      return typeof value.templateId === 'string' && value.templateId.length > 0
        && hasString(value, 'requestId');
    case 'openExistingDocument':
      return hasString(value, 'requestId');
    case 'savePersonalTemplate':
      return hasTemplateRequestIdentity(value) && isPersonalTemplateMetadataInput(value.metadata);
    case 'updatePersonalTemplate':
    case 'duplicatePersonalTemplate':
      return hasTemplateRequestIdentity(value)
        && hasString(value, 'templateId')
        && hasString(value, 'revisionToken')
        && isPersonalTemplateMetadataInput(value.metadata);
    case 'deletePersonalTemplate':
      return hasString(value, 'requestId')
        && hasString(value, 'templateId')
        && hasString(value, 'revisionToken');
    case 'openPersonalTemplateFolder':
      return hasString(value, 'requestId');
    case 'saveImage':
      return hasString(value, 'imageName')
        && isBoundedBase64Asset(value.imageData)
        && hasString(value, 'extension');
    case 'createDrawio':
      return hasString(value, 'fileName');
    case 'openDrawio':
      return hasString(value, 'drawioPath');
    case 'replaceImage':
      return hasNumber(value, 'pos');
    case 'export':
      return hasString(value, 'requestId')
        && hasString(value, 'sessionId')
        && hasString(value, 'documentId')
        && ['html', 'adoc', 'markdown', 'pdf', 'slides'].includes(String(value.format));
    case 'fileOperationPrepare':
      return hasOnlyKeys(value, [
        'type', 'requestId', 'sessionId', 'documentId', 'baseRevision', 'intent',
      ])
        && hasFileOperationRequestIdentity(value)
        && isNonNegativeInteger(value.baseRevision)
        && isFileOperationIntent(value.intent);
    case 'fileOperationExecute':
      return hasOnlyKeys(value, ['type', 'requestId', 'sessionId', 'documentId', 'planId'])
        && hasFileOperationRequestIdentity(value)
        && isFileOperationId(value.planId);
    case 'fileOperationCancel':
      return hasOnlyKeys(value, ['type', 'requestId', 'sessionId', 'documentId', 'planId'])
        && hasFileOperationRequestIdentity(value)
        && (value.planId === undefined || isFileOperationId(value.planId));
    case 'fileOperationRetry':
      return hasOnlyKeys(value, [
        'type', 'requestId', 'sessionId', 'documentId', 'previousRequestId',
      ])
        && hasFileOperationRequestIdentity(value)
        && isFileOperationId(value.previousRequestId)
        && value.previousRequestId !== value.requestId;
    case 'fileOperationResultAction': {
      if (!hasOnlyKeys(value, [
        'type', 'requestId', 'actionRequestId', 'sessionId', 'documentId', 'action', 'artifactId',
      ])
        || !hasFileOperationRequestIdentity(value)
        || !isFileOperationId(value.actionRequestId)
        || value.actionRequestId === value.requestId
        || !FILE_OPERATION_ACTIONS.includes(
          String(value.action) as typeof FILE_OPERATION_ACTIONS[number],
        )) return false;
      return value.action === 'repeat'
        ? value.artifactId === undefined
        : isFileOperationId(value.artifactId);
    }
    case 'importMarkdown':
    case 'importHtml':
      return hasString(value, 'requestId')
        && hasString(value, 'sessionId')
        && hasString(value, 'documentId');
    case 'renderDiagram':
      return hasString(value, 'requestId')
        && ['plantuml', 'd2', 'graphviz'].includes(String(value.language))
        && hasString(value, 'source')
        && new TextEncoder().encode(value.source as string).byteLength <= 100 * 1024;
    case 'cancelDiagramRender':
      return hasString(value, 'requestId');
    case 'updateDiagramRendererSettings':
      return isDiagramRendererSettings(value.settings);
    case 'resolveDiagramRendererConsent':
      return hasString(value, 'requestId')
        && (value.consent === 'granted' || value.consent === 'declined');
    case 'updateUiLanguage':
      return value.preference === 'auto' || value.preference === 'en' || value.preference === 'ko';
    case 'testDiagramRendererConnection':
      return hasString(value, 'requestId') && isDiagramRendererSettings(value.settings);
    case 'fileOperationApplied':
      return hasString(value, 'requestId') && hasString(value, 'sessionId')
        && hasString(value, 'documentId') && typeof value.applied === 'boolean';
    case 'recoverInvalidDocument':
      return hasString(value, 'requestId') && hasString(value, 'sessionId')
        && hasString(value, 'documentId') && hasNumber(value, 'baseRevision')
        && isDocumentMutation(value.mutation);
    case 'externalChangeAdopted':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision');
    case 'openDocument':
      return hasString(value, 'path') && (value.anchor === undefined || typeof value.anchor === 'string');
    case 'selectCssFile':
    case 'clearCssFile':
      return value.target === 'slide' || value.target === 'html';
    default:
      return false;
  }
}

export function isHostToEditorMessage(value: unknown): value is HostToEditorMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'showJsonViewer':
      return true;
    case 'templateApplicationFinished':
      return hasString(value, 'requestId')
        && ['applied', 'cancelled', 'failed'].includes(String(value.result))
        && (value.result === 'failed'
          ? isTemplateOperationError(value.error)
          : value.error === undefined);
    case 'templateCreationFinished':
      return hasString(value, 'requestId')
        && ['created', 'cancelled', 'failed'].includes(String(value.result))
        && (value.result === 'failed'
          ? isTemplateOperationError(value.error)
          : value.error === undefined);
    case 'templateOperationFinished':
      return hasString(value, 'requestId')
        && ['save', 'update', 'duplicate', 'delete', 'open-folder'].includes(String(value.operation))
        && ['completed', 'cancelled', 'failed'].includes(String(value.result))
        && (value.templateId === undefined || hasString(value, 'templateId'))
        && (value.result === 'failed'
          ? isTemplateOperationError(value.error)
          : value.error === undefined);
    case 'requestFlush':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasString(value, 'requestId');
    case 'init':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision')
        && typeof value.isDirty === 'boolean'
        && (value.performanceEnabled === undefined
          || typeof value.performanceEnabled === 'boolean')
        && (value.locale === 'en' || value.locale === 'ko')
        && isEditorDocumentState(value.documentState);
    case 'externalInvalidDocument':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision') && isInvalidDocumentReason(value.reason)
        && isContractDiagnostics(value.diagnostics)
        && typeof value.canRecoverFromLocal === 'boolean';
    case 'invalidDocumentRecoveryResult':
      return hasString(value, 'requestId') && hasString(value, 'sessionId')
        && hasString(value, 'documentId') && hasNumber(value, 'revision')
        && (value.result === 'recovered' || value.result === 'rejected')
        && (value.modified === undefined || hasString(value, 'modified'))
        && (value.message === undefined || hasString(value, 'message'));
    case 'externalChange':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision') && isDocumentMutation(value.snapshot);
    case 'documentRevisionAdvanced':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision');
    case 'replaceDocument':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision')
        && (value.reason === 'user-reload' || value.reason === 'confirmed-template')
        && isDocumentMutation(value.snapshot);
    case 'templateCatalog':
      return Array.isArray(value.templates) && value.templates.every(isTemplateDescriptor)
        && hasString(value, 'requestId')
        && Array.isArray(value.diagnostics)
        && value.diagnostics.every(isTemplateCatalogDiagnosticView)
        && (value.personalRootScope === 'local' || value.personalRootScope === 'remote');
    case 'templateCatalogFailed':
      return hasString(value, 'requestId') && isTemplateOperationError(value.error);
    case 'editAcknowledged':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasString(value, 'editId') && hasNumber(value, 'revision')
        && hasString(value, 'modified');
    case 'documentSaveState':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'saveGeneration') && hasNumber(value, 'revision')
        && (value.phase === 'saving' || value.phase === 'saved' || value.phase === 'failed')
        && (value.modified === undefined || hasString(value, 'modified'))
        && (value.message === undefined || hasString(value, 'message'));
    case 'editRejected':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasString(value, 'editId') && hasNumber(value, 'revision')
        && isMutationErrorCode(value.code) && hasString(value, 'message')
        && (value.hostSnapshot === undefined || isDocumentMutation(value.hostSnapshot));
    case 'importContent':
      return hasString(value, 'requestId') && hasString(value, 'sessionId')
        && hasString(value, 'documentId')
        && isRecord(value.content) && value.content.type === 'doc'
        && (value.confirmation === undefined || value.confirmation === 'preflight-confirmed');
    case 'showFileOperation':
      return value.tab === 'export' || value.tab === 'import';
    case 'settingsChanged':
      return isRecord(value.settings);
    case 'uiLanguageChanged':
      return (value.preference === 'auto' || value.preference === 'en' || value.preference === 'ko')
        && (value.locale === 'en' || value.locale === 'ko');
    case 'docSettingsChanged':
      return value.docSettings === null || isRecord(value.docSettings);
    case 'documentSettingSelected':
      return (value.key === 'slideCssPath' || value.key === 'htmlCssPath')
        && (value.value === null || typeof value.value === 'string');
    case 'metaUpdate':
      return isRecord(value.meta);
    case 'importHtml':
      return hasString(value, 'requestId') && hasString(value, 'sessionId')
        && hasString(value, 'documentId') && hasString(value, 'html')
        && (value.confirmation === undefined || value.confirmation === 'preflight-confirmed');
    case 'imageSaved':
      return hasString(value, 'imagePath') && hasString(value, 'webviewUri') && hasString(value, 'imageName');
    case 'drawioCreated':
      return hasString(value, 'drawioPath') && hasString(value, 'webviewUri') && hasString(value, 'fileName');
    case 'imageInserted':
      return hasString(value, 'imagePath') && hasString(value, 'webviewUri') && hasString(value, 'fileName');
    case 'imageReplaced':
      return hasNumber(value, 'pos') && hasString(value, 'imagePath') && hasString(value, 'webviewUri') && hasString(value, 'fileName');
    case 'drawioFileUpdated':
      return hasString(value, 'documentId') && hasNumber(value, 'generation')
        && hasString(value, 'relativePath') && hasString(value, 'newWebviewUri');
    case 'fileOperationStatus':
      return isFileOperationId(value.sessionId)
        && (value.documentId === undefined || isFileOperationDocumentId(value.documentId))
        && isFileOperationState(value.state);
    case 'fileOperationResultActionStatus':
      return hasOnlyKeys(value, [
        'type', 'requestId', 'actionRequestId', 'sessionId', 'documentId',
        'action', 'status', 'error',
      ])
        && hasFileOperationRequestIdentity(value)
        && isFileOperationId(value.actionRequestId)
        && value.actionRequestId !== value.requestId
        && FILE_OPERATION_ACTIONS.includes(
          String(value.action) as typeof FILE_OPERATION_ACTIONS[number],
        )
        && (value.status === 'completed' || value.status === 'failed')
        && (value.status === 'failed'
          ? isFileOperationError(value.error)
          : value.error === undefined);
    case 'fileOperationPreflight':
      return hasOnlyKeys(value, [
        'type', 'requestId', 'sessionId', 'documentId', 'plan',
      ])
        && hasFileOperationRequestIdentity(value)
        && isFileOperationPlanView(value.plan);
    case 'diagramRenderResult':
      if (!hasString(value, 'requestId') || !isRecord(value.result)) return false;
      if (value.result.status === 'ready') {
        return hasString(value.result, 'dataUrl')
          && isDiagramImageDataUrl(String(value.result.dataUrl))
          && hasNumber(value.result, 'width') && hasNumber(value.result, 'height');
      }
      return value.result.status === 'error'
        && isDiagramFailureCode(value.result.code)
        && hasString(value.result, 'message')
        && typeof value.result.retryable === 'boolean';
    case 'diagramRendererSettings':
      return isDiagramRendererSettings(value.settings);
    case 'diagramRendererConsentResult':
      if (!hasString(value, 'requestId') || !isRecord(value.result)) return false;
      return value.result.status === 'resolved'
        ? isDiagramRendererSettings(value.result.settings)
        : value.result.status === 'error' && hasString(value.result, 'message');
    case 'sdocFileBrowseResult':
      return hasString(value, 'path') && hasString(value, 'fileName') && Array.isArray(value.targets);
    case 'importMarkdownText':
      return hasString(value, 'requestId') && hasString(value, 'sessionId')
        && hasString(value, 'documentId') && hasString(value, 'text');
    default:
      return false;
  }
}
