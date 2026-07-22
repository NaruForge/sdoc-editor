import type { EditorToHostMessage, HostToEditorMessage } from './messages';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasString = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'string';

const hasNumber = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'number' && Number.isFinite(value[key]);

export function isEditorToHostMessage(value: unknown): value is EditorToHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'ready':
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
    case 'initializeEmptyDocument':
      return (value.mode === 'blank' || value.mode === 'template')
        && hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'baseRevision');
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
    case 'requestFlush':
      return hasString(value, 'sessionId') && hasString(value, 'requestId');
    case 'init':
    case 'update':
      return hasString(value, 'sessionId') && hasString(value, 'documentId')
        && hasNumber(value, 'revision')
        && (value.readOnlyReason === undefined || hasString(value, 'readOnlyReason'))
        && (value.type !== 'init' || value.initializationRequired === undefined
          || typeof value.initializationRequired === 'boolean')
        && isRecord(value.content) && value.content.type === 'doc';
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
