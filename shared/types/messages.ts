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
import type { TemplateCatalogDiagnosticView } from '../template/catalogView';
import type {
  DocumentMutation,
  DocumentMutationErrorCode,
} from '../persistence/DocumentSyncCoordinator';
import type {
  EditorLocale,
  UiLanguagePreference,
} from '../editor/i18n/locale';
import type {
  FileOperationArtifactId,
  FileOperationError,
  FileOperationIntent,
  FileOperationPlanId,
  FileOperationPlanView,
  FileOperationRequestId,
  FileOperationResultAction,
  FileOperationState,
} from '../editor/fileOperations';
import type { ContractDiagnostic } from '../document/documentContract';
import type { KnownDiagramLanguage } from '../editor/diagram/languages';
import type {
  DiagramRenderFailureCode,
  ResolvedDiagramRendererConsent,
  DiagramRendererSettings,
} from '../diagramRenderer';

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
  headingStartNumber: number;
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

export type InvalidDocumentReason = 'invalid-json' | 'malformed' | 'unsupported-version' | 'too-large';

export type EditorDocumentState =
  | { status: 'ready'; snapshot: DocumentMutation }
  | {
      status: 'invalid';
      reason: InvalidDocumentReason;
      diagnostics: ContractDiagnostic[];
    };

export interface InitMessage {
  type: 'init';
  locale: EditorLocale;
  sessionId: string;
  documentId: string;
  revision: number;
  isDirty: boolean;
  performanceEnabled?: boolean;
  documentState: EditorDocumentState;
}

export interface ExternalInvalidDocumentMessage {
  type: 'externalInvalidDocument';
  sessionId: string;
  documentId: string;
  revision: number;
  reason: InvalidDocumentReason;
  diagnostics: ContractDiagnostic[];
  canRecoverFromLocal: boolean;
}

export interface InvalidDocumentRecoveryResultMessage {
  type: 'invalidDocumentRecoveryResult';
  requestId: string;
  sessionId: string;
  documentId: string;
  result: 'recovered' | 'rejected';
  revision: number;
  modified?: string;
  message?: string;
}

export interface TemplateCatalogMessage {
  type: 'templateCatalog';
  requestId: string;
  templates: ManagedTemplateDescriptor[];
  diagnostics: TemplateCatalogDiagnosticView[];
  personalRootScope: 'local' | 'remote';
}

export type TemplateErrorCode =
  | 'catalog-unavailable'
  | 'document-changed'
  | 'template-unavailable'
  | 'template-changed'
  | 'invalid-document'
  | 'operation-failed';

export interface TemplateOperationError {
  code: TemplateErrorCode;
  message: string;
}

export interface TemplateCatalogFailedMessage {
  type: 'templateCatalogFailed';
  requestId: string;
  error: TemplateOperationError;
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
  result: 'completed' | 'cancelled' | 'failed';
  templateId?: string;
  error?: TemplateOperationError;
}

export interface TemplateApplicationFinishedMessage {
  type: 'templateApplicationFinished';
  requestId: string;
  result: 'applied' | 'cancelled' | 'failed';
  error?: TemplateOperationError;
}

export interface TemplateCreationFinishedMessage {
  type: 'templateCreationFinished';
  requestId: string;
  result: 'created' | 'cancelled' | 'failed';
  error?: TemplateOperationError;
}

export interface ExternalChangeMessage {
  type: 'externalChange';
  sessionId: string;
  documentId: string;
  revision: number;
  snapshot: DocumentMutation;
}

export interface DocumentRevisionAdvancedMessage {
  type: 'documentRevisionAdvanced';
  sessionId: string;
  documentId: string;
  revision: number;
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
  modified: string;
}

export interface DocumentSaveStateMessage {
  type: 'documentSaveState';
  sessionId: string;
  documentId: string;
  saveGeneration: number;
  revision: number;
  phase: 'saving' | 'saved' | 'failed';
  modified?: string;
  message?: string;
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

export interface UiLanguageChangedMessage {
  type: 'uiLanguageChanged';
  preference: UiLanguagePreference;
  locale: EditorLocale;
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
  requestId: string;
  sessionId: string;
  documentId: string;
  content: TiptapNode;
  /** The common Files preflight already obtained the destructive confirmation. */
  confirmation?: 'preflight-confirmed';
}

export interface ImportHtmlToWebviewMessage {
  type: 'importHtml';
  requestId: string;
  sessionId: string;
  documentId: string;
  html: string;
  /** The common Files preflight already obtained the destructive confirmation. */
  confirmation?: 'preflight-confirmed';
}

export interface ShowFileOperationMessage {
  type: 'showFileOperation';
  tab: 'export' | 'import';
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
  requestId: string;
  sessionId: string;
  documentId: string;
  text: string;
}

export interface ShowJsonViewerMessage {
  type: 'showJsonViewer';
}

export interface RequestFlushMessage {
  type: 'requestFlush';
  sessionId: string;
  documentId: string;
  requestId: string;
}

/** Extension-host test seam; ignored unless the webview was initialized in test mode. */
export interface TestApplyLocalizedMutationMessage {
  type: 'testApplyLocalizedMutation';
  sessionId: string;
  documentId: string;
  blockIndex: number;
}

export interface FileOperationPreflightMessage {
  type: 'fileOperationPreflight';
  requestId: FileOperationRequestId;
  sessionId: string;
  documentId: string;
  plan: FileOperationPlanView;
}

export interface FileOperationStatusMessage {
  type: 'fileOperationStatus';
  sessionId: string;
  /** Omitted by the legacy operation status flow. */
  documentId?: string;
  state: FileOperationState;
}

export interface FileOperationResultActionStatusMessage {
  type: 'fileOperationResultActionStatus';
  requestId: FileOperationRequestId;
  actionRequestId: FileOperationRequestId;
  sessionId: string;
  documentId: string;
  action: FileOperationResultAction;
  status: 'completed' | 'failed';
  error?: FileOperationError;
}

export interface DiagramRenderReadyMessage {
  type: 'diagramRenderResult';
  requestId: string;
  result: {
    status: 'ready';
    dataUrl: string;
    width: number;
    height: number;
  };
}

export interface DiagramRenderFailedMessage {
  type: 'diagramRenderResult';
  requestId: string;
  result: {
    status: 'error';
    code: DiagramRenderFailureCode;
    message: string;
    retryable: boolean;
  };
}

export interface DiagramRendererSettingsMessage {
  type: 'diagramRendererSettings';
  settings: DiagramRendererSettings;
}

export interface DiagramRendererConsentResultMessage {
  type: 'diagramRendererConsentResult';
  requestId: string;
  result:
    | {
        status: 'resolved';
        settings: DiagramRendererSettings;
      }
    | {
        status: 'error';
        message: string;
      };
}

export interface SdocFileBrowseResultMessage {
  type: 'sdocFileBrowseResult';
  path: string;
  fileName: string;
  targets: Array<{ id: string; type: string; label: string }>;
}

export type ExtensionToWebviewMessage =
  | InitMessage
  | ExternalInvalidDocumentMessage
  | InvalidDocumentRecoveryResultMessage
  | TemplateCatalogMessage
  | TemplateCatalogFailedMessage
  | TemplateApplicationFinishedMessage
  | TemplateCreationFinishedMessage
  | TemplateOperationFinishedMessage
  | ExternalChangeMessage
  | DocumentRevisionAdvancedMessage
  | ReplaceDocumentMessage
  | EditAcknowledgedMessage
  | DocumentSaveStateMessage
  | EditRejectedMessage
  | SettingsChangedMessage
  | UiLanguageChangedMessage
  | DocSettingsChangedMessage
  | DocumentSettingSelectedMessage
  | MetaUpdateMessage
  | ImportContentMessage
  | ImportHtmlToWebviewMessage
  | ShowFileOperationMessage
  | ImageSavedMessage
  | DrawioCreatedMessage
  | ImageInsertedMessage
  | ImageReplacedMessage
  | DrawioFileUpdatedMessage
  | RequestFlushMessage
  | TestApplyLocalizedMutationMessage
  | FileOperationPreflightMessage
  | FileOperationStatusMessage
  | FileOperationResultActionStatusMessage
  | DiagramRenderReadyMessage
  | DiagramRenderFailedMessage
  | DiagramRendererSettingsMessage
  | DiagramRendererConsentResultMessage
  | SdocFileBrowseResultMessage
  | ImportMarkdownTextMessage
  | ShowJsonViewerMessage;

// ─── Webview → Extension Messages ───────────────────────────────

export interface ReadyMessage {
  type: 'ready';
}

export interface UiReadyMessage {
  type: 'uiReady';
  sessionId: string;
  documentId: string;
}

export interface EditorTextFocusChangedMessage {
  type: 'editorTextFocusChanged';
  sessionId: string;
  documentId: string;
  focused: boolean;
}

export interface WebviewPerformanceMeasurementMessage {
  type: 'webviewPerformanceMeasurement';
  sessionId: string;
  documentId: string;
  name: 'webview-checkpoint-to-ack-received';
  durationMs: number;
  operationCount: number;
}

export interface UpdateUiLanguageMessage {
  type: 'updateUiLanguage';
  preference: UiLanguagePreference;
}

export interface RequestTemplateCatalogMessage {
  type: 'requestTemplateCatalog';
  requestId: string;
}

export interface ApplyTemplateMessage {
  type: 'applyTemplate';
  requestId: string;
  templateId: string;
  sessionId: string;
  documentId: string;
  baseRevision: number;
}

export interface CreateDocumentFromTemplateMessage {
  type: 'createDocumentFromTemplate';
  requestId: string;
  templateId: string;
}

export interface OpenExistingDocumentMessage {
  type: 'openExistingDocument';
  requestId: string;
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
  metadata: PersonalTemplateMetadataInput;
}

export interface UpdatePersonalTemplateMessage extends PersonalTemplateRequestIdentity {
  type: 'updatePersonalTemplate';
  templateId: string;
  revisionToken: string;
  metadata: PersonalTemplateMetadataInput;
}

export interface DuplicatePersonalTemplateMessage extends PersonalTemplateRequestIdentity {
  type: 'duplicatePersonalTemplate';
  templateId: string;
  revisionToken: string;
  metadata: PersonalTemplateMetadataInput;
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
  requestId: string;
  sessionId: string;
  documentId: string;
  format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides';
}

interface FileOperationRequestIdentity {
  requestId: FileOperationRequestId;
  sessionId: string;
  documentId: string;
}

export interface FileOperationPrepareMessage extends FileOperationRequestIdentity {
  type: 'fileOperationPrepare';
  baseRevision: number;
  intent: FileOperationIntent;
}

export interface FileOperationExecuteMessage extends FileOperationRequestIdentity {
  type: 'fileOperationExecute';
  planId: FileOperationPlanId;
}

export interface FileOperationCancelMessage extends FileOperationRequestIdentity {
  type: 'fileOperationCancel';
  planId?: FileOperationPlanId;
}

export interface FileOperationRetryMessage extends FileOperationRequestIdentity {
  type: 'fileOperationRetry';
  previousRequestId: FileOperationRequestId;
}

interface FileOperationResultActionMessageBase extends FileOperationRequestIdentity {
  type: 'fileOperationResultAction';
  actionRequestId: FileOperationRequestId;
}

export type FileOperationResultActionMessage =
  | (FileOperationResultActionMessageBase & {
    action: Exclude<FileOperationResultAction, 'repeat'>;
    artifactId: FileOperationArtifactId;
  })
  | (FileOperationResultActionMessageBase & {
    action: 'repeat';
    artifactId?: never;
  });

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
  requestId: string;
  sessionId: string;
  documentId: string;
}

export interface ImportHtmlFromWebviewMessage {
  type: 'importHtml';
  requestId: string;
  sessionId: string;
  documentId: string;
}

export interface RenderDiagramMessage {
  type: 'renderDiagram';
  requestId: string;
  language: Exclude<KnownDiagramLanguage, 'mermaid'>;
  source: string;
}

export interface CancelDiagramRenderMessage {
  type: 'cancelDiagramRender';
  requestId: string;
}

export interface UpdateDiagramRendererSettingsMessage {
  type: 'updateDiagramRendererSettings';
  settings: DiagramRendererSettings;
}

export interface ResolveDiagramRendererConsentMessage {
  type: 'resolveDiagramRendererConsent';
  requestId: string;
  consent: ResolvedDiagramRendererConsent;
}

export interface TestDiagramRendererConnectionMessage {
  type: 'testDiagramRendererConnection';
  requestId: string;
  settings: DiagramRendererSettings;
}

export interface FileOperationAppliedMessage {
  type: 'fileOperationApplied';
  requestId: string;
  sessionId: string;
  documentId: string;
  applied: boolean;
}

export interface FlushCompleteMessage {
  type: 'flushComplete';
  sessionId: string;
  documentId: string;
  requestId: string;
}

export interface FlushFailedMessage {
  type: 'flushFailed';
  sessionId: string;
  documentId: string;
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

export interface RecoverInvalidDocumentMessage {
  type: 'recoverInvalidDocument';
  requestId: string;
  sessionId: string;
  documentId: string;
  baseRevision: number;
  mutation: DocumentMutation;
}

export interface ExternalChangeAdoptedMessage {
  type: 'externalChangeAdopted';
  sessionId: string;
  documentId: string;
  revision: number;
}

export type WebviewToExtensionMessage =
  | ReadyMessage
  | UiReadyMessage
  | EditorTextFocusChangedMessage
  | WebviewPerformanceMeasurementMessage
  | UpdateUiLanguageMessage
  | RequestTemplateCatalogMessage
  | ApplyTemplateMessage
  | CreateDocumentFromTemplateMessage
  | OpenExistingDocumentMessage
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
  | FileOperationPrepareMessage
  | FileOperationExecuteMessage
  | FileOperationCancelMessage
  | FileOperationRetryMessage
  | FileOperationResultActionMessage
  | OpenDocumentMessage
  | BrowseSdocFilesMessage
  | ImportMarkdownMessage
  | ImportHtmlFromWebviewMessage
  | RenderDiagramMessage
  | CancelDiagramRenderMessage
  | UpdateDiagramRendererSettingsMessage
  | ResolveDiagramRendererConsentMessage
  | TestDiagramRendererConnectionMessage
  | FileOperationAppliedMessage
  | FlushCompleteMessage
  | FlushFailedMessage
  | SelectCssFileMessage
  | ClearCssFileMessage
  | RecoverInvalidDocumentMessage
  | ExternalChangeAdoptedMessage;

/** Host-boundary names shared by the VS Code extension and its webview. */
export type HostToEditorMessage = ExtensionToWebviewMessage;
export type EditorToHostMessage = WebviewToExtensionMessage;
