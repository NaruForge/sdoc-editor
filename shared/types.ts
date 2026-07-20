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
  headingDecoration?: boolean;
  headingH1Color?: string;
  headingH2Color?: string;
  headingH3Color?: string;
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
  headingDecoration: boolean;
  headingH1Color: string;
  headingH2Color: string;
  headingH3Color: string;
  defaultImageAlignment: 'left' | 'center' | 'right';
  exportImagePath: 'relative' | 'absolute';
  pdfScale: number;
  selfContained: SelfContainedMode;
  slideBreakLevel: SlideBreakLevel;
  slideTransition: SlideTransition;
  showTitleSlide: boolean;
  outputDir: string;
}

export interface SdocMeta {
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
  settings?: Partial<DocumentSettings>;
}

export interface SdocEnvelope {
  sdoc: '1.0';
  meta: SdocMeta;
  doc: TiptapNode;
}

// ─── Export Settings ────────────────────────────────────────────

export interface ExportSettings {
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
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  equationCaptionPrefix?: string;
  captionSeparator?: string;
  captionNumbering?: 'sequential' | 'hierarchical';
  tableNumberStyle?: 'arabic' | 'roman';
  equationParens?: boolean;
  slideBreak?: SlideBreakLevel;
  slideBreakLevel?: SlideBreakLevel;
  showTitleSlide?: boolean;
  transition?: SlideTransition;
  slideTransition?: SlideTransition;
  outputDir?: string;
}
