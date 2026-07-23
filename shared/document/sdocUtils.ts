/** Host-neutral `.sdoc` document processing. */

import type { CaptionStyleName } from '../settingsResolver';
import type { SdocEnvelope, SdocMeta, TiptapMark, TiptapNode } from '../types';
import { preserveMeta } from './documentContract';
import { mapDocument, walkDocument } from './walker';
import { migrateAttributes } from './migrations';
import { buildNumberingIndex } from './numbering';

export { migrateAttributes } from './migrations';

export type { SdocEnvelope, SdocMeta } from '../types';

const SDOC_VERSION: SdocEnvelope['sdoc'] = '1.0';
const emptyDocument = (): TiptapNode => ({ type: 'doc', content: [] });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTiptapNode = (value: unknown): value is TiptapNode =>
  isRecord(value) && typeof value.type === 'string';

const stringValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === 'number' ? value : fallback;

function readMeta(value: unknown): SdocMeta {
  return preserveMeta(value);
}

export function unwrapSdoc(parsed: unknown): { meta: SdocMeta; doc: TiptapNode } {
  if (isRecord(parsed) && parsed.sdoc && isTiptapNode(parsed.doc)) {
    return { meta: readMeta(parsed.meta), doc: migrateAttributes(parsed.doc) };
  }
  if (isTiptapNode(parsed) && parsed.type === 'doc') {
    return { meta: {}, doc: migrateAttributes(parsed) };
  }
  return { meta: {}, doc: emptyDocument() };
}

export function wrapSdoc(doc: TiptapNode, meta: SdocMeta): SdocEnvelope {
  const now = new Date().toISOString();
  const envelope: SdocEnvelope = {
    sdoc: SDOC_VERSION,
    meta: {
      ...meta,
      title: meta.title || '',
      author: meta.author || '',
      version: meta.version || '0.1',
      created: meta.created || now,
      modified: now,
    },
    doc,
  };
  if (meta.settings && Object.keys(meta.settings).length > 0) {
    envelope.meta.settings = meta.settings;
  }
  return envelope;
}

export function createEmptySdoc(meta: Partial<SdocMeta>): SdocEnvelope {
  const now = new Date().toISOString();
  const title = meta.title || '';
  const doc: TiptapNode = {
    type: 'doc',
    content: title
      ? [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
          { type: 'paragraph' },
        ]
      : [{ type: 'paragraph' }],
  };
  return wrapSdoc(doc, {
    title,
    author: meta.author || '',
    version: meta.version || '0.1',
    created: meta.created || now,
    modified: now,
    settings: meta.settings,
  });
}

/**
 * Clone document content before persistence without changing user-entered text.
 *
 * The legacy name is retained for callers, but whitespace is intentionally not
 * normalized: trailing spaces are meaningful editor state and removing them
 * during the debounced save cycle can move the caret or discard fresh input.
 */
export function cleanTextNodes(node: TiptapNode): TiptapNode {
  if (!node.content) return { ...node };
  return { ...node, content: node.content.map(cleanTextNodes) };
}

export function extractTitle(doc: TiptapNode): string {
  const heading = doc.content?.find((node) => node.type === 'heading');
  return heading ? getNodeText(heading) : '';
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s가-힣-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

function getNodeText(node: TiptapNode): string {
  return (node.content ?? [])
    .filter((child) => child.type === 'text')
    .map((child) => child.text || '')
    .join('');
}

const attrString = (node: TiptapNode, key: string): string => stringValue(node.attrs?.[key]);

export function assignAutoIds(doc: TiptapNode): TiptapNode {
  const reservedExistingIds = new Set<string>();
  for (const { node } of walkDocument(doc)) {
    const id = attrString(node, 'id');
    if (id) reservedExistingIds.add(id);
  }
  const assignedIds = new Set<string>();
  const seenExistingIds = new Set<string>();
  let imageCounter = 0;
  let tableCounter = 0;
  let equationCounter = 0;

  const uniqueGeneratedId = (base: string): string => {
    let id = base;
    let suffix = 2;
    while (reservedExistingIds.has(id) || assignedIds.has(id)) id = `${base}-${suffix++}`;
    assignedIds.add(id);
    return id;
  };

  const preserveExistingId = (existing: string): string => {
    if (!seenExistingIds.has(existing) && !assignedIds.has(existing)) {
      seenExistingIds.add(existing);
      assignedIds.add(existing);
      return existing;
    }

    seenExistingIds.add(existing);
    let suffix = 2;
    let candidate = `${existing}-${suffix}`;
    while (reservedExistingIds.has(candidate) || assignedIds.has(candidate)) {
      candidate = `${existing}-${++suffix}`;
    }
    assignedIds.add(candidate);
    return candidate;
  };

  return mapDocument(doc, (node): TiptapNode => {
    let generatedBase: string | undefined;
    if (node.type === 'heading') generatedBase = slugify(getNodeText(node));
    if (node.type === 'image') generatedBase = `figure-${++imageCounter}`;
    if (node.type === 'table') generatedBase = `table-${++tableCounter}`;
    if (node.type === 'mathBlock') generatedBase = `eq-${++equationCounter}`;
    if (!generatedBase) return node;

    const existing = attrString(node, 'id');
    const id = existing ? preserveExistingId(existing) : uniqueGeneratedId(generatedBase);
    return { ...node, attrs: { ...node.attrs, id } };
  });
}

export function syncCrossReferences(
  doc: TiptapNode,
  equationNumbering: 'sequential' | 'hierarchical' = 'sequential',
  captionStyle: CaptionStyleName = 'modern',
  crossRefIncludeCaption = false,
  captionNumbering: 'sequential' | 'hierarchical' = 'sequential',
  headingNumbering = true,
): TiptapNode {
  if (!doc.content) return doc;
  const numbering = buildNumberingIndex(doc, {
    headingNumbering, captionNumbering, equationNumbering, captionStyle, crossRefIncludeCaption,
  });

  return mapDocument(doc, (node): TiptapNode => {
    const link = node.marks?.find(isInternalLink);
    const href = stringValue(link?.attrs?.href);
    const label = href ? numbering.byId.get(href.slice(1))?.referenceLabel : undefined;
    return {
      ...node,
      ...(label && node.type === 'text' ? { text: label } : {}),
    };
  });
}

export interface DocumentNormalizationOptions {
  equationNumbering?: 'sequential' | 'hierarchical';
  captionStyle?: CaptionStyleName;
  crossRefIncludeCaption?: boolean;
  captionNumbering?: 'sequential' | 'hierarchical';
  headingNumbering?: boolean;
}

/** The single semantic persistence pipeline used by every host. */
export function normalizeDocument(
  doc: TiptapNode,
  options: DocumentNormalizationOptions = {},
): TiptapNode {
  const cleaned = cleanTextNodes(doc);
  const withIds = assignAutoIds(cleaned);
  return syncCrossReferences(
    withIds,
    options.equationNumbering,
    options.captionStyle,
    options.crossRefIncludeCaption,
    options.captionNumbering,
    options.headingNumbering,
  );
}

const isInternalLink = (mark: TiptapMark): boolean =>
  mark.type === 'link' && stringValue(mark.attrs?.href).startsWith('#');

export interface QueryResult {
  headings: Array<{ id: string; level: number; text: string; numbering: string }>;
  figures: Array<{ id: string; caption: string; number: number }>;
  tables: Array<{ id: string; caption: string; number: number }>;
  equations: Array<{ id: string; number: number }>;
  crossReferences: Array<{ href: string; text: string; targetExists: boolean }>;
}

export function queryDocumentStructure(doc: TiptapNode): QueryResult {
  const result: QueryResult = {
    headings: [],
    figures: [],
    tables: [],
    equations: [],
    crossReferences: [],
  };
  if (!doc.content) return result;

  const numbering = buildNumberingIndex(doc, {
    headingNumbering: true,
    captionNumbering: 'sequential',
    equationNumbering: 'sequential',
    captionStyle: 'modern',
    crossRefIncludeCaption: false,
  });
  const allIds = new Set<string>();

  for (const { node, path } of walkDocument(doc)) {
    const id = attrString(node, 'id');
    if (id) allIds.add(id);
    const entry = numbering.byPath.get(path.join('.'));
    if (node.type === 'heading') {
      const level = numberValue(node.attrs?.level, 1);
      result.headings.push({
        id,
        level,
        text: getNodeText(node),
        numbering: entry?.number ?? '',
      });
    }
    if (node.type === 'image') result.figures.push({ id, caption: attrString(node, 'caption'), number: Number(entry?.number) });
    if (node.type === 'table') result.tables.push({ id, caption: attrString(node, 'caption'), number: Number(entry?.number) });
    if (node.type === 'mathBlock') result.equations.push({ id, number: Number(entry?.number) });
  }

  for (const { node } of walkDocument(doc)) {
    const link = node.marks?.find(isInternalLink);
    if (link) {
      const href = stringValue(link.attrs?.href);
      result.crossReferences.push({
        href,
        text: node.text || '',
        targetExists: allIds.has(href.slice(1)),
      });
    }
  }
  return result;
}
