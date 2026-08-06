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
  isRecord(value) && hasString(value, 'code') && hasString(value, 'message')
  && typeof value.retryable === 'boolean';

const isFileOperationState = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.phase !== 'string') return false;
  switch (value.phase) {
    case 'idle':
      return true;
    case 'running':
      return hasString(value, 'requestId')
        && (value.kind === 'export' || value.kind === 'import')
        && hasString(value, 'format') && hasString(value, 'stage');
    case 'succeeded':
      return hasString(value, 'requestId')
        && (value.result === 'completed' || value.result === 'fallback');
    case 'failed':
      return hasString(value, 'requestId') && isFileOperationError(value.error);
    case 'cancelled':
      return hasString(value, 'requestId');
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
        && isRecord(value.content) && value.content.type === 'doc';
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
        && hasString(value, 'documentId') && hasString(value, 'html');
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
      return hasString(value, 'sessionId') && isFileOperationState(value.state);
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
