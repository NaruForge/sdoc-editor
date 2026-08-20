import type { DocumentSettings, SdocMeta, SelfContainedMode, TiptapNode } from '../types';

export interface SdocBookDocumentEntry {
  path: string;
  label?: string;
}

interface SdocBookBase {
  title?: string;
  author?: string;
  version?: string;
  counterPolicy?: 'continue' | 'reset';
  documents: SdocBookDocumentEntry[];
}

export type SdocBookPublishSettingsV1 = Required<Pick<DocumentSettings,
  | 'headingNumbering'
  | 'headingStartNumber'
  | 'headingDecoration'
  | 'headingH1Color'
  | 'headingH2Color'
  | 'headingH3Color'
  | 'headingH4Color'
  | 'headingH5Color'
  | 'headingH6Color'
  | 'captionStyle'
  | 'captionNumbering'
  | 'equationNumbering'
  | 'crossRefIncludeCaption'
>>;

export interface SdocBookPublishProfileV1 {
  profileVersion: '1';
  settings: SdocBookPublishSettingsV1;
  theme: {
    id: 'default-v1';
    cssPath?: string;
  };
  html: {
    selfContained: SelfContainedMode;
  };
  pdf: {
    scale: number;
  };
  diagrams: {
    failurePolicy: 'fail' | 'source-fallback';
  };
  outputDir?: string;
}

export interface SdocBookV1_0 extends SdocBookBase {
  sdocBook: '1.0';
  publish?: never;
}

export interface SdocBookV1_1 extends SdocBookBase {
  sdocBook: '1.1';
  publish: SdocBookPublishProfileV1;
}

export type SdocBook = SdocBookV1_0 | SdocBookV1_1;

export type BookDiagnosticSeverity = 'error' | 'warning';

export type BookDiagnosticCode =
  | 'BOOK_INVALID'
  | 'BOOK_MANIFEST_TOO_LARGE'
  | 'BOOK_VERSION_UNSUPPORTED'
  | 'BOOK_NO_DOCUMENTS'
  | 'BOOK_DOCUMENT_LIMIT_EXCEEDED'
  | 'BOOK_DIAGNOSTICS_TRUNCATED'
  | 'BOOK_AGGREGATE_TOO_LARGE'
  | 'BOOK_PROPERTY_UNSUPPORTED'
  | 'BOOK_PUBLISH_PROFILE_REQUIRED'
  | 'PUBLISH_PROFILE_INVALID'
  | 'PUBLISH_PATH_OUTSIDE_BOOK'
  | 'DOCUMENT_PATH_INVALID'
  | 'DOCUMENT_PATH_OUTSIDE_BOOK'
  | 'DOCUMENT_DUPLICATE'
  | 'DOCUMENT_MISSING'
  | 'DOCUMENT_READ_FAILED'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_INVALID'
  | 'ASSET_PATH_OUTSIDE_BOOK'
  | 'ID_DUPLICATE'
  | 'ENDNOTES_UNSUPPORTED'
  | 'REFERENCE_BROKEN';

export interface BookDiagnostic {
  severity: BookDiagnosticSeverity;
  code: BookDiagnosticCode;
  message: string;
  documentPath?: string;
  nodeId?: string;
}

export interface BookParseResult {
  book?: SdocBook;
  diagnostics: BookDiagnostic[];
}

export interface BookDocumentLoader {
  load(path: string, signal?: AbortSignal): Promise<BookLoadedDocument>;
}

export interface BookLoadedDocument {
  value: unknown;
  byteLength: number;
}

export type BookDocumentStatus = 'ok' | 'missing' | 'invalid';

export interface ResolvedBookDocument {
  path: string;
  label: string;
  status: BookDocumentStatus;
  meta?: SdocMeta;
  doc?: TiptapNode;
}

export interface BookCompositionResult {
  doc: TiptapNode;
  meta: SdocMeta;
  documents: ResolvedBookDocument[];
  diagnostics: BookDiagnostic[];
  counterResetPaths: string[];
}

export type BookDocumentLoadFailure = 'not-found' | 'read-failed' | 'too-large';

export class BookDocumentLoadError extends Error {
  constructor(
    readonly failure: BookDocumentLoadFailure,
    message: string,
  ) {
    super(message);
    this.name = 'BookDocumentLoadError';
  }
}
