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
  content: TiptapNode;
}

export interface UpdateMessage {
  type: 'update';
  content: TiptapNode;
}

export interface SettingsChangedMessage {
  type: 'settingsChanged';
  settings: Partial<EditorSettings>;
}

export interface DocSettingsChangedMessage {
  type: 'docSettingsChanged';
  docSettings: Partial<DocumentSettings> | null;
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
  | UpdateMessage
  | SettingsChangedMessage
  | DocSettingsChangedMessage
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

export interface EditMessage {
  type: 'edit';
  content: TiptapNode;
  meta?: Partial<SdocMeta>;
  saveRequested?: boolean;
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

export interface UpdateMetaMessage {
  type: 'updateMeta';
  meta: Partial<SdocMeta>;
}

export interface UpdateDocSettingsMessage {
  type: 'updateDocSettings';
  settings: Partial<DocumentSettings> | null;
}

export interface FlushCompleteMessage {
  type: 'flushComplete';
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
  | UpdateMetaMessage
  | UpdateDocSettingsMessage
  | FlushCompleteMessage
  | SelectCssFileMessage
  | ClearCssFileMessage;

/** Host-neutral names used by both the VS Code and Tauri adapters. */
export type HostToEditorMessage = ExtensionToWebviewMessage;
export type EditorToHostMessage = WebviewToExtensionMessage;
