import { BOOK_MANIFEST_MAX_BYTES, BOOK_MAX_DOCUMENTS, measureBookUtf8Bytes } from './limits';
import { normalizeBookDocumentPath, parseBook } from './parseBook';
import type { BookMutationErrorCode } from './messages';
import type { SdocBook, SdocBookDocumentEntry } from './types';

export class BookMutationError extends Error {
  constructor(
    readonly code: BookMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BookMutationError';
  }
}

export function assertBookEditApplied(applied: boolean): void {
  if (!applied) {
    throw new BookMutationError('apply-failed', 'VS Code refused to apply the .sdocbook edit.');
  }
}

export function serializeBookManifestForMutation(book: SdocBook): string {
  const serialized = `${JSON.stringify(book, null, 2)}\n`;
  const byteLength = measureBookUtf8Bytes(serialized);
  if (byteLength > BOOK_MANIFEST_MAX_BYTES) {
    throw new BookMutationError(
      'limit-exceeded',
      `.sdocbook manifest would exceed the ${BOOK_MANIFEST_MAX_BYTES.toLocaleString('en-US')} byte limit (${byteLength.toLocaleString('en-US')} bytes).`,
    );
  }
  return serialized;
}

export type BookManifestMutation =
  | { type: 'addDocuments'; paths: readonly string[] }
  | { type: 'removeDocument'; index: number }
  | { type: 'moveDocument'; from: number; to: number }
  | { type: 'updateMeta'; key: 'title' | 'author' | 'version'; value: string };

const portablePathKey = (value: string): string =>
  value.normalize('NFC').toLocaleLowerCase('en-US');

export function prepareBookMutationSnapshot(
  text: string,
  revision: number,
  baseRevision: number,
): SdocBook {
  if (revision !== baseRevision) {
    throw new BookMutationError(
      'stale-revision',
      `The book changed after this action started (expected revision ${baseRevision}, current revision ${revision}).`,
    );
  }

  const parsed = parseBook(text);
  const blockingDiagnostic = parsed.diagnostics.find((diagnostic) =>
    diagnostic.code !== 'BOOK_NO_DOCUMENTS'
    && (diagnostic.severity === 'error' || diagnostic.code === 'BOOK_PROPERTY_UNSUPPORTED'));
  if (!parsed.book || blockingDiagnostic) {
    throw new BookMutationError(
      blockingDiagnostic?.code === 'BOOK_DOCUMENT_LIMIT_EXCEEDED' ? 'limit-exceeded' : 'invalid-manifest',
      `Fix the .sdocbook manifest before editing it in the visual editor.${blockingDiagnostic ? ` ${blockingDiagnostic.message}` : ''}`,
    );
  }
  return parsed.book;
}

export function applyBookManifestMutation(
  book: SdocBook,
  mutation: BookManifestMutation,
): SdocBook {
  const documents: SdocBookDocumentEntry[] = book.documents.map((entry) => ({ ...entry }));
  const next: SdocBook = { ...book, documents };

  switch (mutation.type) {
    case 'addDocuments': {
      const existing = new Set(documents.map((entry) => portablePathKey(entry.path)));
      const additions: SdocBookDocumentEntry[] = [];
      for (const candidate of mutation.paths) {
        const normalized = normalizeBookDocumentPath(candidate);
        if (!normalized || !normalized.toLowerCase().endsWith('.sdoc')) {
          throw new BookMutationError('invalid-request', `Invalid book document path: ${candidate}`);
        }
        const key = portablePathKey(normalized);
        if (existing.has(key)) continue;
        existing.add(key);
        additions.push({ path: normalized });
      }
      if (documents.length + additions.length > BOOK_MAX_DOCUMENTS) {
        throw new BookMutationError(
          'limit-exceeded',
          `A book may contain at most ${BOOK_MAX_DOCUMENTS.toLocaleString('en-US')} documents.`,
        );
      }
      documents.push(...additions);
      return next;
    }
    case 'removeDocument':
      if (mutation.index >= documents.length) {
        throw new BookMutationError('invalid-request', 'The document is no longer in the book manifest.');
      }
      documents.splice(mutation.index, 1);
      return next;
    case 'moveDocument': {
      const { from, to } = mutation;
      if (from >= documents.length || to >= documents.length) {
        throw new BookMutationError('invalid-request', 'The document order changed before this action completed.');
      }
      const [entry] = documents.splice(from, 1);
      documents.splice(to, 0, entry);
      return next;
    }
    case 'updateMeta':
      next[mutation.key] = mutation.value;
      return next;
  }
}
