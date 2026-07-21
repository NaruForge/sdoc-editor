import { parseDocumentContract } from '../document/documentContract';
import type { SdocMeta, TiptapMark, TiptapNode } from '../types';
import { normalizeBookDocumentPath } from './parseBook';
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

interface TransformContext {
  sourcePath: string;
  includedPaths: Set<string>;
  idsByDocument: Map<string, Set<string>>;
  diagnostics: BookDiagnostic[];
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
  return { ...mark, attrs: { ...mark.attrs, href: targetId ? `#${targetId}` : '' } };
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

export async function composeBook(
  book: SdocBook,
  loader: BookDocumentLoader,
  initialDiagnostics: readonly BookDiagnostic[] = [],
): Promise<BookCompositionResult> {
  const diagnostics = [...initialDiagnostics];
  const documents: ResolvedBookDocument[] = [];

  for (const entry of book.documents) {
    const resolved: ResolvedBookDocument = {
      path: entry.path,
      label: entry.label || basenameWithoutSdoc(entry.path),
      status: 'invalid',
    };
    try {
      const parsed = parseLoadedDocument(await loader.load(entry.path));
      const contract = parseDocumentContract(parsed);
      if (!contract.ok) {
        throw new Error(contract.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; '));
      }
      resolved.meta = contract.envelope.meta;
      resolved.doc = contract.envelope.doc;
      resolved.status = 'ok';
    } catch (error) {
      const loadError = error instanceof BookDocumentLoadError ? error : null;
      const missing = loadError?.failure === 'not-found';
      resolved.status = missing ? 'missing' : 'invalid';
      diagnostics.push({
        severity: 'error',
        code: missing ? 'DOCUMENT_MISSING' : loadError ? 'DOCUMENT_READ_FAILED' : 'DOCUMENT_INVALID',
        message: `${missing ? 'Document not found' : 'Unable to load document'}: ${entry.path}${error instanceof Error ? ` (${error.message})` : ''}`,
        documentPath: entry.path,
      });
    }
    documents.push(resolved);
  }

  const idsByDocument = new Map<string, Set<string>>();
  const idOwners = new Map<string, string>();
  for (const document of documents) {
    if (!document.doc) continue;
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

  const includedPaths = new Set(book.documents.map((entry) => entry.path));
  const mergedContent: TiptapNode[] = [];
  const counterResetPaths: string[] = [];
  for (const document of documents) {
    if (!document.doc?.content) continue;
    if (book.counterPolicy === 'reset') counterResetPaths.push(String(mergedContent.length));
    const context: TransformContext = {
      sourcePath: document.path,
      includedPaths,
      idsByDocument,
      diagnostics,
    };
    mergedContent.push(...document.doc.content.map((node) => transformNode(node, context)));
  }

  const meta: SdocMeta = {};
  if (book.title !== undefined) meta.title = book.title;
  if (book.author !== undefined) meta.author = book.author;
  if (book.version !== undefined) meta.version = book.version;

  return {
    doc: { type: 'doc', content: mergedContent },
    meta,
    documents,
    diagnostics,
    counterResetPaths,
  };
}
