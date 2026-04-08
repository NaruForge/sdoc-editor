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

export interface SdocMeta {
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
}

// ─── Export Settings ────────────────────────────────────────────

export interface ExportSettings {
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  captionNumbering?: 'simple' | 'hierarchical';
}

export interface HtmlExportSettings extends ExportSettings {
  exportImagePath?: 'relative' | 'absolute';
  selfContained?: 'none' | 'images-only' | 'full';
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
  captionNumbering?: 'simple' | 'hierarchical';
  slideBreak?: 'h1-only' | 'h1-h2-vertical';
  showTitleSlide?: boolean;
  transition?: 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';
}
