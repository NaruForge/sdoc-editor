/**
 * Discriminated union types for Extension ↔ Webview message protocol.
 * Single source of truth — both sides should reference these types.
 */

import type { TiptapNode, SdocMeta, DocumentSettings } from '../types';

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
  imageDefaultAlignment: 'left' | 'center' | 'right';
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
  settings: EditorSettings;
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

export interface RequestFlushMessage {
  type: 'requestFlush';
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
  | SdocFileBrowseResultMessage;

// ─── Webview → Extension Messages ───────────────────────────────

export interface ReadyMessage {
  type: 'ready';
}

export interface EditMessage {
  type: 'edit';
  content: TiptapNode;
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
  | FlushCompleteMessage;

// ─── SdocBook Messages (Webview → Extension) ───────────────────

export interface BookOpenDocumentMessage {
  type: 'openDocument';
  path: string;
}

export interface BookAddDocumentMessage {
  type: 'addDocument';
}

export interface BookRemoveDocumentMessage {
  type: 'removeDocument';
  index: number;
}

export interface BookMoveDocumentMessage {
  type: 'moveDocument';
  from: number;
  to: number;
}

export interface BookUpdateMetaMessage {
  type: 'updateMeta';
  title?: string;
  author?: string;
  version?: string;
}

export interface BookExportProjectMessage {
  type: 'exportProject';
  format: 'html' | 'pdf';
}

export type BookWebviewToExtensionMessage =
  | BookOpenDocumentMessage
  | BookAddDocumentMessage
  | BookRemoveDocumentMessage
  | BookMoveDocumentMessage
  | BookUpdateMetaMessage
  | BookExportProjectMessage;
