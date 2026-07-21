import type { SdocMeta, TiptapNode } from '../types';

export interface SdocBookDocumentEntry {
  path: string;
  label?: string;
}

export interface SdocBook {
  sdocBook: '1.0';
  title?: string;
  author?: string;
  version?: string;
  counterPolicy?: 'continue' | 'reset';
  documents: SdocBookDocumentEntry[];
}

export type BookDiagnosticSeverity = 'error' | 'warning';

export type BookDiagnosticCode =
  | 'BOOK_INVALID'
  | 'BOOK_VERSION_UNSUPPORTED'
  | 'BOOK_NO_DOCUMENTS'
  | 'BOOK_PROPERTY_UNSUPPORTED'
  | 'DOCUMENT_PATH_INVALID'
  | 'DOCUMENT_PATH_OUTSIDE_BOOK'
  | 'DOCUMENT_DUPLICATE'
  | 'DOCUMENT_MISSING'
  | 'DOCUMENT_READ_FAILED'
  | 'DOCUMENT_INVALID'
  | 'ASSET_PATH_OUTSIDE_BOOK'
  | 'ID_DUPLICATE'
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
  load(path: string): Promise<unknown>;
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

export type BookDocumentLoadFailure = 'not-found' | 'read-failed';

export class BookDocumentLoadError extends Error {
  constructor(
    readonly failure: BookDocumentLoadFailure,
    message: string,
  ) {
    super(message);
    this.name = 'BookDocumentLoadError';
  }
}
