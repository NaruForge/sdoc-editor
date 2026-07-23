import type { EditorToHostMessage, HostToEditorMessage } from './messages';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasString = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'string';

const hasNumber = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'number' && Number.isFinite(value[key]);

const hasTemplateRequestIdentity = (value: Record<string, unknown>): boolean =>
  hasString(value, 'requestId')
  && hasString(value, 'sessionId')
  && hasString(value, 'documentId')
  && hasNumber(value, 'baseRevision');

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

export function isEditorToHostMessage(value: unknown): value is EditorToHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'ready':
    case 'requestTemplateCatalog':
    case 'viewJson':
    case 'importDrawio':
    case 'insertExistingImage':
    case 'browseSdocFiles':
    case 'importMarkdown':
    case 'importHtml':
    case 'flushComplete':
      return true;
    case 'edit':
      return isRecord(value.content) && value.content.type === 'doc'
        && (value.sessionId === undefined || hasString(value, 'sessionId'))
        && (value.documentId === undefined || hasString(value, 'documentId'))
        && (value.editId === undefined || hasString(value, 'editId'))
        && (value.baseRevision === undefined || hasNumber(value, 'baseRevision'));
    case 'applyTemplate':
      return typeof value.templateId === 'string' && value.templateId.length > 0
        && hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'baseRevision');
    case 'savePersonalTemplate':
      return hasTemplateRequestIdentity(value);
    case 'updatePersonalTemplate':
    case 'duplicatePersonalTemplate':
      return hasTemplateRequestIdentity(value)
        && hasString(value, 'templateId')
        && hasString(value, 'revisionToken');
    case 'deletePersonalTemplate':
      return hasString(value, 'requestId')
        && hasString(value, 'templateId')
        && hasString(value, 'revisionToken');
    case 'openPersonalTemplateFolder':
      return hasString(value, 'requestId');
    case 'saveImage':
      return hasString(value, 'imageName') && hasString(value, 'imageData') && hasString(value, 'extension');
    case 'createDrawio':
      return hasString(value, 'fileName');
    case 'openDrawio':
      return hasString(value, 'drawioPath');
    case 'replaceImage':
      return hasNumber(value, 'pos');
    case 'export':
      return ['html', 'adoc', 'markdown', 'pdf', 'slides'].includes(String(value.format));
    case 'openDocument':
      return hasString(value, 'path') && (value.anchor === undefined || typeof value.anchor === 'string');
    case 'updateMeta':
      return isRecord(value.meta);
    case 'updateDocSettings':
      return value.settings === null || isRecord(value.settings);
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
    case 'exportDone':
    case 'showJsonViewer':
      return true;
    case 'templateApplicationFinished':
      return typeof value.applied === 'boolean';
    case 'templateOperationFinished':
      return hasString(value, 'requestId')
        && ['save', 'update', 'duplicate', 'delete', 'open-folder'].includes(String(value.operation))
        && typeof value.succeeded === 'boolean'
        && (value.templateId === undefined || hasString(value, 'templateId'))
        && (value.message === undefined || hasString(value, 'message'));
    case 'requestFlush':
      return hasString(value, 'sessionId') && hasString(value, 'requestId');
    case 'init':
    case 'update':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision')
        && (value.readOnlyReason === undefined || hasString(value, 'readOnlyReason'))
        && isRecord(value.content) && value.content.type === 'doc';
    case 'templateCatalog':
      return Array.isArray(value.templates) && value.templates.every(isTemplateDescriptor)
        && typeof value.diagnosticCount === 'number'
        && Number.isFinite(value.diagnosticCount) && value.diagnosticCount >= 0
        && hasString(value, 'personalRootPath')
        && (value.personalRootScope === 'local' || value.personalRootScope === 'remote');
    case 'editAcknowledged':
      return hasString(value, 'sessionId') && hasString(value, 'editId') && hasNumber(value, 'revision');
    case 'editRejected':
      return hasString(value, 'sessionId') && hasString(value, 'editId') && hasNumber(value, 'revision')
        && hasString(value, 'reason') && isRecord(value.content) && value.content.type === 'doc';
    case 'importContent':
      return isRecord(value.content) && value.content.type === 'doc';
    case 'settingsChanged':
      return isRecord(value.settings);
    case 'docSettingsChanged':
      return value.docSettings === null || isRecord(value.docSettings);
    case 'metaUpdate':
      return isRecord(value.meta);
    case 'importHtml':
      return hasString(value, 'html');
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
    case 'exportStarted':
      return ['html', 'adoc', 'markdown', 'pdf', 'slides'].includes(String(value.format));
    case 'sdocFileBrowseResult':
      return hasString(value, 'path') && hasString(value, 'fileName') && Array.isArray(value.targets);
    case 'importMarkdownText':
      return hasString(value, 'text');
    default:
      return false;
  }
}
