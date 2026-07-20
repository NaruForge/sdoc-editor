import type {
  BookDiagnostic,
  BookParseResult,
  SdocBook,
  SdocBookDocumentEntry,
} from './types';

const BOOK_PROPERTIES = new Set(['sdocBook', 'title', 'author', 'version', 'documents']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function normalizeInput(input: unknown): { value?: unknown; diagnostic?: BookDiagnostic } {
  if (typeof input !== 'string') return { value: input };
  if (!input.trim()) return { value: { sdocBook: '1.0', documents: [] } };
  try {
    return { value: JSON.parse(input) as unknown };
  } catch (error) {
    return {
      diagnostic: {
        severity: 'error',
        code: 'BOOK_INVALID',
        message: `Invalid .sdocbook JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

/** Convert a document path to the stable, project-relative form used by the book core. */
export function normalizeBookDocumentPath(input: string): string | null {
  const path = input.trim().replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.startsWith('//')) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? `./${segments.join('/')}` : null;
}

export function parseBook(input: unknown): BookParseResult {
  const normalizedInput = normalizeInput(input);
  if (normalizedInput.diagnostic) {
    return { diagnostics: [normalizedInput.diagnostic] };
  }

  const value = normalizedInput.value;
  if (!isRecord(value)) {
    return {
      diagnostics: [{ severity: 'error', code: 'BOOK_INVALID', message: '.sdocbook root must be an object.' }],
    };
  }

  const diagnostics: BookDiagnostic[] = [];
  if (value.sdocBook !== '1.0') {
    diagnostics.push({
      severity: 'error',
      code: 'BOOK_VERSION_UNSUPPORTED',
      message: `Unsupported .sdocbook version: ${String(value.sdocBook ?? '(missing)')}`,
    });
  }

  for (const property of Object.keys(value)) {
    if (!BOOK_PROPERTIES.has(property)) {
      diagnostics.push({
        severity: 'warning',
        code: 'BOOK_PROPERTY_UNSUPPORTED',
        message: `Unsupported .sdocbook property: ${property}`,
      });
    }
  }

  for (const property of ['title', 'author', 'version'] as const) {
    if (value[property] !== undefined && typeof value[property] !== 'string') {
      diagnostics.push({
        severity: 'error',
        code: 'BOOK_INVALID',
        message: `${property} must be a string.`,
      });
    }
  }

  const documents: SdocBookDocumentEntry[] = [];
  const seenPaths = new Set<string>();
  if (!Array.isArray(value.documents)) {
    diagnostics.push({ severity: 'error', code: 'BOOK_INVALID', message: 'documents must be an array.' });
  } else {
    value.documents.forEach((item, index) => {
      if (!isRecord(item) || typeof item.path !== 'string' || !item.path.trim()) {
        diagnostics.push({
          severity: 'error',
          code: 'DOCUMENT_PATH_INVALID',
          message: `Document ${index + 1} must have a non-empty path.`,
        });
        return;
      }

      const normalizedPath = normalizeBookDocumentPath(item.path);
      if (!normalizedPath) {
        diagnostics.push({
          severity: 'error',
          code: 'DOCUMENT_PATH_OUTSIDE_BOOK',
          message: `Document path must stay inside the book folder: ${item.path}`,
          documentPath: item.path,
        });
        return;
      }
      if (!normalizedPath.toLowerCase().endsWith('.sdoc')) {
        diagnostics.push({
          severity: 'error',
          code: 'DOCUMENT_PATH_INVALID',
          message: `Book documents must use the .sdoc extension: ${normalizedPath}`,
          documentPath: normalizedPath,
        });
      }
      if (seenPaths.has(normalizedPath)) {
        diagnostics.push({
          severity: 'error',
          code: 'DOCUMENT_DUPLICATE',
          message: `Document is listed more than once: ${normalizedPath}`,
          documentPath: normalizedPath,
        });
      }
      seenPaths.add(normalizedPath);

      for (const property of Object.keys(item)) {
        if (property !== 'path' && property !== 'label') {
          diagnostics.push({
            severity: 'warning',
            code: 'BOOK_PROPERTY_UNSUPPORTED',
            message: `Unsupported document property in ${normalizedPath}: ${property}`,
            documentPath: normalizedPath,
          });
        }
      }
      if (item.label !== undefined && typeof item.label !== 'string') {
        diagnostics.push({
          severity: 'error',
          code: 'BOOK_INVALID',
          message: `Document label must be a string: ${normalizedPath}`,
          documentPath: normalizedPath,
        });
      }

      const entry: SdocBookDocumentEntry = { path: normalizedPath };
      if (typeof item.label === 'string' && item.label.trim()) entry.label = item.label.trim();
      documents.push(entry);
    });
  }

  if (documents.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'BOOK_NO_DOCUMENTS',
      message: 'Add at least one .sdoc document to the book.',
    });
  }

  const book: SdocBook = {
    sdocBook: '1.0',
    documents,
  };
  if (typeof value.title === 'string') book.title = value.title;
  if (typeof value.author === 'string') book.author = value.author;
  if (typeof value.version === 'string') book.version = value.version;

  return { book, diagnostics };
}
