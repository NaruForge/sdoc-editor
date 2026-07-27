/**
 * Discriminated union types for Extension ↔ Webview message protocol.
 * Single source of truth — both sides should reference these types.
 */

import type {
  DocumentSettings,
  SdocMeta,
  SelfContainedMode,
  SlideBreakLevel,
  SlideTransition,
  TiptapNode,
} from '../types';
import type { TemplateDescriptor, TemplateStructuralPreview } from '../template';
import type {
  DocumentMutation,
  DocumentMutationErrorCode,
} from '../persistence/DocumentSyncCoordinator';

// ─── Editor Settings (Extension → Webview) ─────────────────────

export interface EditorSettings {
  imageCaptionPrefix: string;
  tableCaptionPrefix: string;
  equationCaptionPrefix: string;
  captionSeparator: string;
  imageCaptionSeparator: string;
  tableCaptionSeparator: string;
  equationCaptionSeparator: string;
  captionNumbering: 'sequential' | 'hierarchical';
  equationNumbering: 'sequential' | 'hierarchical';
  headingNumbering: boolean;
  headingDecoration: boolean;
  headingH1Color: string;
  headingH2Color: string;
  headingH3Color: string;
  headingH4Color: string;
  headingH5Color: string;
  headingH6Color: string;
  captionStyle?: DocumentSettings['captionStyle'];
  tableNumberStyle?: 'arabic' | 'roman';
  equationParens?: boolean;
  imageDefaultAlignment: 'left' | 'center' | 'right';
  defaultImageAlignment?: 'left' | 'center' | 'right';
  exportImagePath?: 'relative' | 'absolute';
  pdfScale?: number;
  selfContained?: SelfContainedMode;
  slideBreakLevel?: SlideBreakLevel;
  slideTransition?: SlideTransition;
  showTitleSlide?: boolean;
  outputDir?: string;
  fontFamily: string;
  fontWeightBody: number;
  fontWeightBold: number;
  fontWeightH1: number;
  fontWeightH2: number;
  fontWeightH3: number;
}

// ─── Extension → Webview Messages ───────────────────────────────

export interface InitMessage {
  type: 'init';
  sessionId: string;
  documentId: string;
  revision: number;
  readOnlyReason?: string;
  snapshot: DocumentMutation;
}

export interface TemplateCatalogMessage {
  type: 'templateCatalog';
  templates: ManagedTemplateDescriptor[];
  diagnosticCount: number;
  personalRootPath: string;
  personalRootScope: 'local' | 'remote';
}

export interface ManagedTemplateDescriptor extends TemplateDescriptor {
  revisionToken?: string;
  preview?: TemplateStructuralPreview;
}

export type PersonalTemplateOperation = 'save' | 'update' | 'duplicate' | 'delete' | 'open-folder';

export interface TemplateOperationFinishedMessage {
  type: 'templateOperationFinished';
  requestId: string;
  operation: PersonalTemplateOperation;
  succeeded: boolean;
  templateId?: string;
  message?: string;
}

export interface TemplateApplicationFinishedMessage {
  type: 'templateApplicationFinished';
  applied: boolean;
}

export interface ExternalChangeMessage {
  type: 'externalChange';
  sessionId: string;
  documentId: string;
  revision: number;
  snapshot: DocumentMutation;
}

export interface ReplaceDocumentMessage {
  type: 'replaceDocument';
  sessionId: string;
  documentId: string;
  revision: number;
  reason: 'user-reload' | 'confirmed-template';
  snapshot: DocumentMutation;
}

export interface EditAcknowledgedMessage {
  type: 'editAcknowledged';
  sessionId: string;
  documentId: string;
  editId: string;
  revision: number;
}

export interface EditRejectedMessage {
  type: 'editRejected';
  sessionId: string;
  documentId: string;
  editId: string;
  revision: number;
  code: DocumentMutationErrorCode;
  message: string;
  hostSnapshot?: DocumentMutation;
}

export interface SettingsChangedMessage {
  type: 'settingsChanged';
  settings: Partial<EditorSettings>;
}

export interface DocSettingsChangedMessage {
  type: 'docSettingsChanged';
  docSettings: Partial<DocumentSettings> | null;
}

export interface DocumentSettingSelectedMessage {
  type: 'documentSettingSelected';
  key: 'slideCssPath' | 'htmlCssPath';
  value: string | null;
}

export interface MetaUpdateMessage {
  type: 'metaUpdate';
  meta: SdocMeta;
}

export interface ImportContentMessage {
  type: 'importContent';
  content: TiptapNode;
}

export interface ImportHtmlToWebviewMessage {
  type: 'importHtml';
  html: string;
}

export interface ImageSavedMessage {
  type: 'imageSaved';
  imagePath: string;
  webviewUri: string;
  imageName: string;
}

export interface DrawioCreatedMessage {
  type: 'drawioCreated';
  drawioPath: string;
  webviewUri: string;
  fileName: string;
}

export interface ImageInsertedMessage {
  type: 'imageInserted';
  imagePath: string;
  webviewUri: string;
  fileName: string;
}

export interface ImageReplacedMessage {
  type: 'imageReplaced';
  pos: number;
  imagePath: string;
  webviewUri: string;
  fileName: string;
}

export interface DrawioFileUpdatedMessage {
  type: 'drawioFileUpdated';
  documentId: string;
  generation: number;
  relativePath: string;
  newWebviewUri: string;
}

export interface ImportMarkdownTextMessage {
  type: 'importMarkdownText';
  text: string;
}

export interface ShowJsonViewerMessage {
  type: 'showJsonViewer';
}

export interface RequestFlushMessage {
  type: 'requestFlush';
  sessionId: string;
  requestId: string;
}

export interface ExportStartedMessage {
  type: 'exportStarted';
  format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides';
}

export interface ExportDoneMessage {
  type: 'exportDone';
}

export interface SdocFileBrowseResultMessage {
  type: 'sdocFileBrowseResult';
  path: string;
  fileName: string;
  targets: Array<{ id: string; type: string; label: string }>;
}

export type ExtensionToWebviewMessage =
  | InitMessage
  | TemplateCatalogMessage
  | TemplateApplicationFinishedMessage
  | TemplateOperationFinishedMessage
  | ExternalChangeMessage
  | ReplaceDocumentMessage
  | EditAcknowledgedMessage
  | EditRejectedMessage
  | SettingsChangedMessage
  | DocSettingsChangedMessage
  | DocumentSettingSelectedMessage
  | MetaUpdateMessage
  | ImportContentMessage
  | ImportHtmlToWebviewMessage
  | ImageSavedMessage
  | DrawioCreatedMessage
  | ImageInsertedMessage
  | ImageReplacedMessage
  | DrawioFileUpdatedMessage
  | RequestFlushMessage
  | ExportStartedMessage
  | ExportDoneMessage
  | SdocFileBrowseResultMessage
  | ImportMarkdownTextMessage
  | ShowJsonViewerMessage;

// ─── Webview → Extension Messages ───────────────────────────────

export interface ReadyMessage {
  type: 'ready';
}

export interface RequestTemplateCatalogMessage {
  type: 'requestTemplateCatalog';
}

export interface ApplyTemplateMessage {
  type: 'applyTemplate';
  templateId: string;
  sessionId: string;
  documentId: string;
  baseRevision: number;
}

export interface PersonalTemplateMetadataInput {
  name: string;
  description?: string;
  category?: string;
}

interface PersonalTemplateRequestIdentity {
  requestId: string;
  sessionId: string;
  documentId: string;
  baseRevision: number;
}

export interface SavePersonalTemplateMessage extends PersonalTemplateRequestIdentity {
  type: 'savePersonalTemplate';
}

export interface UpdatePersonalTemplateMessage extends PersonalTemplateRequestIdentity {
  type: 'updatePersonalTemplate';
  templateId: string;
  revisionToken: string;
}

export interface DuplicatePersonalTemplateMessage extends PersonalTemplateRequestIdentity {
  type: 'duplicatePersonalTemplate';
  templateId: string;
  revisionToken: string;
}

export interface DeletePersonalTemplateMessage {
  type: 'deletePersonalTemplate';
  requestId: string;
  templateId: string;
  revisionToken: string;
}

export interface OpenPersonalTemplateFolderMessage {
  type: 'openPersonalTemplateFolder';
  requestId: string;
}

export interface EditMessage {
  type: 'edit';
  sessionId: string;
  documentId: string;
  editId: string;
  baseRevision: number;
  localGeneration: number;
  flushRequestId?: string;
  mutation: DocumentMutation;
}

export interface ViewJsonMessage {
  type: 'viewJson';
}

export interface SaveImageMessage {
  type: 'saveImage';
  imageName: string;
  imageData: string;
  extension: string;
}

export interface CreateDrawioMessage {
  type: 'createDrawio';
  fileName: string;
}

export interface ImportDrawioMessage {
  type: 'importDrawio';
}

export interface OpenDrawioMessage {
  type: 'openDrawio';
  drawioPath: string;
}

export interface InsertExistingImageMessage {
  type: 'insertExistingImage';
}

export interface ReplaceImageMessage {
  type: 'replaceImage';
  pos: number;
}

export interface ExportMessage {
  type: 'export';
  format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides';
}

export interface OpenDocumentMessage {
  type: 'openDocument';
  path: string;
  anchor?: string;
}

export interface BrowseSdocFilesMessage {
  type: 'browseSdocFiles';
}

export interface ImportMarkdownMessage {
  type: 'importMarkdown';
}

export interface ImportHtmlFromWebviewMessage {
  type: 'importHtml';
}

export interface FlushCompleteMessage {
  type: 'flushComplete';
  sessionId: string;
  requestId: string;
}

export interface FlushFailedMessage {
  type: 'flushFailed';
  sessionId: string;
  requestId: string;
  code: DocumentMutationErrorCode;
  message: string;
}

export interface SelectCssFileMessage {
  type: 'selectCssFile';
  target: 'slide' | 'html';
}

export interface ClearCssFileMessage {
  type: 'clearCssFile';
  target: 'slide' | 'html';
}

export type WebviewToExtensionMessage =
  | ReadyMessage
  | RequestTemplateCatalogMessage
  | ApplyTemplateMessage
  | SavePersonalTemplateMessage
  | UpdatePersonalTemplateMessage
  | DuplicatePersonalTemplateMessage
  | DeletePersonalTemplateMessage
  | OpenPersonalTemplateFolderMessage
  | EditMessage
  | ViewJsonMessage
  | SaveImageMessage
  | CreateDrawioMessage
  | ImportDrawioMessage
  | OpenDrawioMessage
  | InsertExistingImageMessage
  | ReplaceImageMessage
  | ExportMessage
  | OpenDocumentMessage
  | BrowseSdocFilesMessage
  | ImportMarkdownMessage
  | ImportHtmlFromWebviewMessage
  | FlushCompleteMessage
  | FlushFailedMessage
  | SelectCssFileMessage
  | ClearCssFileMessage;

/** Host-neutral names used by both the VS Code and Tauri adapters. */
export type HostToEditorMessage = ExtensionToWebviewMessage;
export type EditorToHostMessage = WebviewToExtensionMessage;
