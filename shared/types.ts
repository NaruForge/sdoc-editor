/**
 * Shared type definitions for Structured Doc Editor.
 * Single source of truth — all modules should import from here.
 */

// ─── Document Tree ──────────────────────────────────────────────

export interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ─── Document Metadata ──────────────────────────────────────────

export type CaptionStyleName = 'ieee' | 'iso' | 'modern' | 'korean';
export type SelfContainedMode = 'none' | 'images-only' | 'full';
export type SlideBreakLevel = 'h1-only' | 'h1-h2-vertical';
export type SlideTransition = 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';

/** Per-document settings that override VS Code workspace defaults. */
export interface DocumentSettings {
  headingNumbering?: boolean;
  headingStartNumber?: number;
  headingDecoration?: boolean;
  headingH1Color?: string;
  headingH2Color?: string;
  headingH3Color?: string;
  headingH4Color?: string;
  headingH5Color?: string;
  headingH6Color?: string;
  captionStyle?: CaptionStyleName;
  captionNumbering?: 'sequential' | 'hierarchical';
  equationNumbering?: 'sequential' | 'hierarchical';
  crossRefIncludeCaption?: boolean;
  slideCssPath?: string;
  htmlCssPath?: string;
  pdfScale?: number;
  selfContained?: SelfContainedMode;
  slideBreakLevel?: SlideBreakLevel;
  slideTransition?: SlideTransition;
  showTitleSlide?: boolean;
  outputDir?: string;
}

export type DocumentSettingKey = keyof DocumentSettings;
export type DocumentSettingSource =
  | 'document'
  | 'book-profile'
  | 'host'
  | 'built-in'
  | 'temporary-view';
export type DocumentSettingScope = 'document' | 'book' | 'host' | 'product' | 'session';
export type DocumentSettingPortability = 'portable' | 'host-local' | 'session-only';
export type DocumentSettingApplicationTarget =
  | 'editor-view'
  | 'html'
  | 'pdf'
  | 'markdown'
  | 'asciidoc'
  | 'slides';

export type TemporaryViewPreference = 'follow-document' | 'show' | 'hide';

export interface TemporaryDocumentViewPreferences {
  headingNumbering?: TemporaryViewPreference;
  headingDecoration?: TemporaryViewPreference;
}

export interface ResolvedDocumentSettingEntry<K extends DocumentSettingKey = DocumentSettingKey> {
  value: Required<DocumentSettings>[K];
  source: DocumentSettingSource;
  scope: DocumentSettingScope;
  portability: DocumentSettingPortability;
  appliesTo: readonly DocumentSettingApplicationTarget[];
}

export type ResolvedDocumentSettingEntries = {
  readonly [K in DocumentSettingKey]-?: Readonly<ResolvedDocumentSettingEntry<K>>;
};

export type DocumentSettingsDiagnosticCode = 'CHAPTER_SETTING_OVERRIDDEN';

export interface DocumentSettingsDiagnostic {
  severity: 'warning';
  code: DocumentSettingsDiagnosticCode;
  key: DocumentSettingKey;
  message: string;
  documentPath?: string;
}

export interface ResolvedDocumentSettingsSnapshot {
  version: '1';
  context: 'standalone' | 'book' | 'editor';
  values: Readonly<Required<DocumentSettings>>;
  entries: ResolvedDocumentSettingEntries;
  diagnostics: readonly Readonly<DocumentSettingsDiagnostic>[];
  fingerprint: `sha256:${string}`;
}

export interface DocumentSettingsSnapshotChange<K extends DocumentSettingKey = DocumentSettingKey> {
  key: K;
  before: Readonly<ResolvedDocumentSettingEntry<K>>;
  after: Readonly<ResolvedDocumentSettingEntry<K>>;
}

/** Fully resolved settings consumed by the host-neutral editor UI. */
export interface ResolvedEditorSettings {
  captionStyle: CaptionStyleName;
  imageCaptionPrefix: string;
  tableCaptionPrefix: string;
  equationCaptionPrefix: string;
  captionSeparator: string;
  tableNumberStyle: 'arabic' | 'roman';
  equationParens: boolean;
  captionNumbering: 'sequential' | 'hierarchical';
  equationNumbering: 'sequential' | 'hierarchical';
  crossRefIncludeCaption: boolean;
  headingNumbering: boolean;
  headingStartNumber: number;
  headingDecoration: boolean;
  headingH1Color: string;
  headingH2Color: string;
  headingH3Color: string;
  headingH4Color: string;
  headingH5Color: string;
  headingH6Color: string;
  defaultImageAlignment: 'left' | 'center' | 'right';
  exportImagePath: 'relative' | 'absolute';
  pdfScale: number;
  selfContained: SelfContainedMode;
  slideBreakLevel: SlideBreakLevel;
  slideTransition: SlideTransition;
  showTitleSlide: boolean;
  outputDir: string;
}

export interface SdocTemplateMetadata {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  titleNodeId?: string;
}

export interface SdocMeta {
  [key: string]: unknown;
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
  settings?: Partial<DocumentSettings>;
  template?: SdocTemplateMetadata;
}

export interface SdocEnvelope {
  sdoc: '1.0';
  meta: SdocMeta;
  doc: TiptapNode;
}

// ─── Export Settings ────────────────────────────────────────────

export interface ExportSettings {
  captionStyle?: CaptionStyleName;
  headingNumbering?: boolean;
  headingStartNumber?: number;
  /** HTML/PDF presentation only; ignored by text and slide converters. */
  headingDecoration?: boolean;
  /** HTML/PDF heading-number colors; ignored by text and slide converters. */
  headingH1Color?: string;
  headingH2Color?: string;
  headingH3Color?: string;
  headingH4Color?: string;
  headingH5Color?: string;
  headingH6Color?: string;
  counterResetPaths?: string[];
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  equationCaptionPrefix?: string;
  captionSeparator?: string;
  captionNumbering?: 'sequential' | 'hierarchical';
  equationNumbering?: 'sequential' | 'hierarchical';
  tableNumberStyle?: 'arabic' | 'roman';
  equationParens?: boolean;
  pdfScale?: number;
  selfContained?: SelfContainedMode;
  outputDir?: string;
}

export interface HtmlExportSettings extends ExportSettings {
  exportImagePath?: 'relative' | 'absolute';
  embeddedAssets?: EmbeddedAssets;
  documentDir?: string;
}

export interface EmbeddedAssets {
  katexCss?: string;
  katexJs?: string;
  autoRenderJs?: string;
  mermaidJs?: string;
}

// ─── HTML Theme ─────────────────────────────────────────────────

export interface HtmlTheme {
  companyLogo?: string;
  companyName?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  customStyles?: string;
  embeddedFonts?: { weight: number; dataUri: string }[];
  fontWeights?: { body: number; bold: number; h1: number; h2: number; h3: number };
}

// ─── Slide Settings ─────────────────────────────────────────────

export interface SlideTheme {
  companyLogo?: string;
  companyName?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  customStyles?: string;
  embeddedFonts?: { weight: number; dataUri: string }[];
  fontWeights?: { body: number; bold: number; h1: number; h2: number; h3: number };
}

export interface SlideSettings {
  captionStyle?: CaptionStyleName;
  headingNumbering?: boolean;
  headingStartNumber?: number;
  counterResetPaths?: string[];
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  equationCaptionPrefix?: string;
  captionSeparator?: string;
  captionNumbering?: 'sequential' | 'hierarchical';
  equationNumbering?: 'sequential' | 'hierarchical';
  tableNumberStyle?: 'arabic' | 'roman';
  equationParens?: boolean;
  slideBreak?: SlideBreakLevel;
  slideBreakLevel?: SlideBreakLevel;
  showTitleSlide?: boolean;
  transition?: SlideTransition;
  slideTransition?: SlideTransition;
  outputDir?: string;
}
