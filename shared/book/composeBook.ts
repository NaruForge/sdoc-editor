import { parseDocumentContract } from '../document/documentContract';
import type { SdocMeta, TiptapMark, TiptapNode } from '../types';
import { normalizeBookDocumentPath } from './parseBook';
import {
  BOOK_AGGREGATE_MAX_BYTES,
  BOOK_CHAPTER_MAX_BYTES,
  BOOK_LOAD_CONCURRENCY,
  BOOK_MAX_DOCUMENTS,
} from './limits';
import {
  BookDocumentLoadError,
  type BookCompositionResult,
  type BookDiagnostic,
  type BookDocumentLoader,
  type ResolvedBookDocument,
  type SdocBook,
} from './types';

const basenameWithoutSdoc = (path: string): string => {
  const name = path.split('/').pop() ?? path;
  return name.toLowerCase().endsWith('.sdoc') ? name.slice(0, -5) : name;
};

const documentDirectory = (path: string): string[] => {
  const segments = path.replace(/^\.\//, '').split('/');
  segments.pop();
  return segments;
};

function resolveFromDocument(documentPath: string, target: string): string | null {
  const normalizedTarget = target.replace(/\\/g, '/');
  if (normalizedTarget.startsWith('/') || /^[A-Za-z]:\//.test(normalizedTarget)) return null;
  const segments = documentDirectory(documentPath);
  for (const segment of normalizedTarget.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return normalizeBookDocumentPath(segments.join('/'));
}

function rebaseAssetPath(documentPath: string, source: string): string | null {
  if (source.startsWith('data:') || source.startsWith('http')) return source;
  const resolved = resolveFromDocument(documentPath, source);
  return resolved?.replace(/^\.\//, '') ?? null;
}

function collectIds(node: TiptapNode, ids: string[]): void {
  const id = node.attrs?.id;
  if (typeof id === 'string' && id) ids.push(id);
  node.content?.forEach((child) => collectIds(child, ids));
}

function containsEndnote(node: TiptapNode): boolean {
  if (node.type === 'endnote') return true;
  return node.content?.some(containsEndnote) ?? false;
}

interface TransformContext {
  sourcePath: string;
  includedPaths: Set<string>;
  idsByDocument: Map<string, Set<string>>;
  diagnostics: BookDiagnostic[];
  chapterAnchors: Map<string, string>;
}

function transformMark(mark: TiptapMark, context: TransformContext): TiptapMark {
  if (mark.type !== 'link' || typeof mark.attrs?.href !== 'string') return mark;
  const href = mark.attrs.href;
  if (href.startsWith('#')) {
    const id = href.slice(1);
    if (id && !context.idsByDocument.get(context.sourcePath)?.has(id)) {
      context.diagnostics.push({
        severity: 'warning',
        code: 'REFERENCE_BROKEN',
        message: `Reference target was not found: ${href}`,
        documentPath: context.sourcePath,
        nodeId: id,
      });
    }
    return mark;
  }

  const hashIndex = href.indexOf('#');
  const targetPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const targetId = hashIndex >= 0 ? href.slice(hashIndex + 1) : '';
  if (!targetPart.toLowerCase().endsWith('.sdoc')) return mark;

  const relativeTarget = resolveFromDocument(context.sourcePath, targetPart);
  const bookRootTarget = normalizeBookDocumentPath(targetPart);
  const targetPath = relativeTarget && context.includedPaths.has(relativeTarget)
    ? relativeTarget
    : bookRootTarget && context.includedPaths.has(bookRootTarget)
      ? bookRootTarget
      : null;
  if (!targetPath) {
    context.diagnostics.push({
      severity: 'warning',
      code: 'REFERENCE_BROKEN',
      message: `Linked document is not included in this book: ${targetPart}`,
      documentPath: context.sourcePath,
      nodeId: targetId || undefined,
    });
    return mark;
  }
  if (targetId && !context.idsByDocument.get(targetPath)?.has(targetId)) {
    context.diagnostics.push({
      severity: 'warning',
      code: 'REFERENCE_BROKEN',
      message: `Reference target was not found in ${targetPath}: #${targetId}`,
      documentPath: context.sourcePath,
      nodeId: targetId,
    });
  }
  const anchor = targetId || context.chapterAnchors.get(targetPath);
  return { ...mark, attrs: { ...mark.attrs, href: anchor ? `#${anchor}` : href } };
}

function transformNode(node: TiptapNode, context: TransformContext): TiptapNode {
  let attrs = node.attrs ? { ...node.attrs } : undefined;
  if (node.type === 'image' && typeof attrs?.src === 'string') {
    const rebased = rebaseAssetPath(context.sourcePath, attrs.src);
    if (rebased === null) {
      context.diagnostics.push({
        severity: 'error',
        code: 'ASSET_PATH_OUTSIDE_BOOK',
        message: `Asset path escapes the book root: ${attrs.src}`,
        documentPath: context.sourcePath,
        nodeId: typeof attrs.id === 'string' ? attrs.id : undefined,
      });
      const { src: _unsafeSource, ...safeAttrs } = attrs;
      attrs = safeAttrs;
    } else {
      attrs = { ...attrs, src: rebased };
    }
  }
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.marks ? { marks: node.marks.map((mark) => transformMark(mark, context)) } : {}),
    ...(node.content ? { content: node.content.map((child) => transformNode(child, context)) } : {}),
  };
}

function parseLoadedDocument(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as unknown;
}

const resolvedDocumentShell = (entry: SdocBook['documents'][number]): ResolvedBookDocument => ({
  path: entry.path,
  label: entry.label || basenameWithoutSdoc(entry.path),
  status: 'invalid',
});

const createBookMeta = (book: SdocBook): SdocMeta => {
  const meta: SdocMeta = {};
  if (book.title !== undefined) meta.title = book.title;
  if (book.author !== undefined) meta.author = book.author;
  if (book.version !== undefined) meta.version = book.version;
  return meta;
};

export async function composeBook(
  book: SdocBook,
  loader: BookDocumentLoader,
  initialDiagnostics: readonly BookDiagnostic[] = [],
  signal?: AbortSignal,
): Promise<BookCompositionResult> {
  const diagnostics = [...initialDiagnostics];
  if (book.documents.length > BOOK_MAX_DOCUMENTS) {
    if (!diagnostics.some((diagnostic) => diagnostic.code === 'BOOK_DOCUMENT_LIMIT_EXCEEDED')) {
      diagnostics.push({
        severity: 'error',
        code: 'BOOK_DOCUMENT_LIMIT_EXCEEDED',
        message: `.sdocbook contains ${book.documents.length.toLocaleString('en-US')} documents; the limit is ${BOOK_MAX_DOCUMENTS.toLocaleString('en-US')}.`,
      });
    }
    return {
      doc: { type: 'doc', content: [] },
      meta: createBookMeta(book),
      documents: book.documents.map(resolvedDocumentShell),
      diagnostics,
      counterResetPaths: [],
    };
  }

  const loadDocument = async (
    entry: SdocBook['documents'][number],
    loadSignal: AbortSignal,
  ): Promise<{
    resolved: ResolvedBookDocument;
    diagnostics: BookDiagnostic[];
    byteLength: number;
  }> => {
    const documentDiagnostics: BookDiagnostic[] = [];
    const resolved = resolvedDocumentShell(entry);
    let byteLength = 0;
    try {
      loadSignal.throwIfAborted();
      const loadedDocument = await loader.load(entry.path, loadSignal);
      loadSignal.throwIfAborted();
      if (!Number.isSafeInteger(loadedDocument.byteLength) || loadedDocument.byteLength < 0) {
        throw new BookDocumentLoadError('read-failed', 'Loader returned an invalid byte length.');
      }
      if (loadedDocument.byteLength > BOOK_CHAPTER_MAX_BYTES) {
        throw new BookDocumentLoadError(
          'too-large',
          `${loadedDocument.byteLength.toLocaleString('en-US')} bytes exceeds the ${BOOK_CHAPTER_MAX_BYTES.toLocaleString('en-US')} byte chapter limit`,
        );
      }
      byteLength = loadedDocument.byteLength;
      const parsed = parseLoadedDocument(loadedDocument.value);
      loadSignal.throwIfAborted();
      const contract = parseDocumentContract(parsed);
      if (!contract.ok) {
        throw new Error(contract.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; '));
      }
      resolved.meta = contract.envelope.meta;
      resolved.doc = contract.envelope.doc;
      resolved.status = 'ok';
    } catch (error) {
      if (loadSignal.aborted) throw error;
      const loadError = error instanceof BookDocumentLoadError ? error : null;
      const missing = loadError?.failure === 'not-found';
      const tooLarge = loadError?.failure === 'too-large';
      resolved.status = missing ? 'missing' : 'invalid';
      documentDiagnostics.push({
        severity: 'error',
        code: missing ? 'DOCUMENT_MISSING' : tooLarge ? 'DOCUMENT_TOO_LARGE' : loadError ? 'DOCUMENT_READ_FAILED' : 'DOCUMENT_INVALID',
        message: `${missing ? 'Document not found' : tooLarge ? 'Document is too large' : 'Unable to load document'}: ${entry.path}${error instanceof Error ? ` (${error.message})` : ''}`,
        documentPath: entry.path,
      });
    }
    return { resolved, diagnostics: documentDiagnostics, byteLength };
  };

  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const scheduled = new Map<number, Promise<
    | { ok: true; value: Awaited<ReturnType<typeof loadDocument>> }
    | { ok: false; error: unknown }
  >>();
  const loaded: Array<Awaited<ReturnType<typeof loadDocument>> | undefined> = [];
  let nextIndex = 0;
  let aggregateBytes = 0;
  let aggregateExceededAt: number | undefined;
  const scheduleAvailable = (): void => {
    while (!controller.signal.aborted
      && scheduled.size < BOOK_LOAD_CONCURRENCY
      && nextIndex < book.documents.length) {
      const index = nextIndex++;
      scheduled.set(index, loadDocument(book.documents[index], controller.signal).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ));
    }
  };

  try {
    controller.signal.throwIfAborted();
    scheduleAvailable();
    for (let index = 0; index < book.documents.length; index += 1) {
      const pending = scheduled.get(index);
      if (!pending) break;
      const outcome = await pending;
      if (controller.signal.aborted) {
        await Promise.all(scheduled.values());
        throw signal?.aborted ? signal.reason : controller.signal.reason;
      }
      scheduled.delete(index);
      if (!outcome.ok) {
        controller.abort(outcome.error);
        await Promise.all(scheduled.values());
        throw signal?.aborted ? signal.reason : outcome.error;
      }
      loaded[index] = outcome.value;
      if (aggregateBytes + outcome.value.byteLength > BOOK_AGGREGATE_MAX_BYTES) {
        aggregateExceededAt = index;
        controller.abort(new Error('Book aggregate byte limit exceeded.'));
        await Promise.all(scheduled.values());
        break;
      }
      aggregateBytes += outcome.value.byteLength;
      scheduleAvailable();
    }
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
  }

  const documents = book.documents.map((entry, index) => {
    if (index === aggregateExceededAt) return resolvedDocumentShell(entry);
    return loaded[index]?.resolved ?? resolvedDocumentShell(entry);
  });
  loaded.forEach((item, index) => {
    if (item && index !== aggregateExceededAt) diagnostics.push(...item.diagnostics);
  });
  if (aggregateExceededAt !== undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'BOOK_AGGREGATE_TOO_LARGE',
      message: `Book chapters exceed the ${BOOK_AGGREGATE_MAX_BYTES.toLocaleString('en-US')} byte aggregate limit at ${book.documents[aggregateExceededAt].path}.`,
      documentPath: book.documents[aggregateExceededAt].path,
    });
  }

  const idsByDocument = new Map<string, Set<string>>();
  const idOwners = new Map<string, string>();
  for (const document of documents) {
    signal?.throwIfAborted();
    if (!document.doc) continue;
    if (containsEndnote(document.doc)) {
      diagnostics.push({
        severity: 'error',
        code: 'ENDNOTES_UNSUPPORTED',
        message: 'Endnotes are not supported in .sdocbook composition until chapter-end versus book-end placement is defined.',
        documentPath: document.path,
      });
    }
    const collectedIds: string[] = [];
    collectIds(document.doc, collectedIds);
    const ids = new Set<string>();
    for (const id of collectedIds) {
      if (ids.has(id)) {
        diagnostics.push({
          severity: 'error',
          code: 'ID_DUPLICATE',
          message: `ID "${id}" is used more than once in ${document.path}.`,
          documentPath: document.path,
          nodeId: id,
        });
      }
      ids.add(id);
    }
    idsByDocument.set(document.path, ids);
    for (const id of ids) {
      const owner = idOwners.get(id);
      if (owner && owner !== document.path) {
        diagnostics.push({
          severity: 'error',
          code: 'ID_DUPLICATE',
          message: `ID "${id}" is used by both ${owner} and ${document.path}.`,
          documentPath: document.path,
          nodeId: id,
        });
      } else {
        idOwners.set(id, document.path);
      }
    }
  }

  const includedPaths = new Set(documents.filter((document) => document.doc).map((document) => document.path));
  const usedAnchorIds = new Set(idOwners.keys());
  const chapterAnchors = new Map<string, string>();
  for (const entry of book.documents.filter((candidate) => includedPaths.has(candidate.path))) {
    signal?.throwIfAborted();
    const stem = entry.path.replace(/^\.\//, '').replace(/\.sdoc$/i, '')
      .normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'document';
    const base = `chapter-${stem}`;
    let anchor = base;
    let suffix = 2;
    while (usedAnchorIds.has(anchor)) anchor = `${base}-${suffix++}`;
    usedAnchorIds.add(anchor);
    chapterAnchors.set(entry.path, anchor);
  }
  const mergedContent: TiptapNode[] = [];
  const counterResetPaths: string[] = [];
  for (const document of documents) {
    signal?.throwIfAborted();
    if (!document.doc?.content) continue;
    if (book.counterPolicy === 'reset') counterResetPaths.push(String(mergedContent.length));
    const context: TransformContext = {
      sourcePath: document.path,
      includedPaths,
      idsByDocument,
      diagnostics,
      chapterAnchors,
    };
    mergedContent.push(
      { type: 'horizontalRule', attrs: { id: chapterAnchors.get(document.path) } },
      ...document.doc.content.map((node) => transformNode(node, context)),
    );
  }

  return {
    doc: { type: 'doc', content: mergedContent },
    meta: createBookMeta(book),
    documents,
    diagnostics,
    counterResetPaths,
  };
}
