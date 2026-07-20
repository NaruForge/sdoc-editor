/** Host-neutral `.sdoc` document processing. */

import { getCaptionPreset, toRoman, type CaptionStyleName } from '../settingsResolver';
import type { DocumentSettings, SdocEnvelope, SdocMeta, TiptapMark, TiptapNode } from '../types';

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
  if (!isRecord(value)) return {};
  const meta: SdocMeta = {};
  if (typeof value.title === 'string') meta.title = value.title;
  if (typeof value.author === 'string') meta.author = value.author;
  if (typeof value.version === 'string') meta.version = value.version;
  if (typeof value.created === 'string') meta.created = value.created;
  if (typeof value.modified === 'string') meta.modified = value.modified;
  if (isRecord(value.settings)) {
    meta.settings = value.settings as Partial<DocumentSettings>;
  }
  return meta;
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
 * Normalize text content before persistence without mutating the editor-owned tree.
 * Only the final text node of a block is trimmed so intentional spaces between
 * differently marked inline nodes are preserved.
 */
export function cleanTextNodes(node: TiptapNode): TiptapNode {
  if (!node.content) return node;

  const content = node.content.map(cleanTextNodes);
  for (let index = content.length - 1; index >= 0; index--) {
    const child = content[index];
    if (child?.type === 'text' && typeof child.text === 'string') {
      const text = child.text.replace(/\s+$/, '');
      if (text) {
        content[index] = { ...child, text };
      } else {
        content.splice(index, 1);
      }
      break;
    }
    if (child?.type && child.type !== 'text') break;
  }

  return { ...node, content };
}

export function migrateAttributes(node: TiptapNode): TiptapNode {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (attrs) {
    if ('data-caption' in attrs) {
      attrs.caption = attrs['data-caption'];
      delete attrs['data-caption'];
    }
    if ('data-align' in attrs) {
      attrs.align = attrs['data-align'];
      delete attrs['data-align'];
    }
    if ('data-width' in attrs) {
      attrs.width = attrs['data-width'];
      delete attrs['data-width'];
    }
  }
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(migrateAttributes) } : {}),
  };
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
  if (!doc.content) return doc;

  const reservedExistingIds = new Set(
    doc.content
      .map((node) => attrString(node, 'id'))
      .filter((id) => id.length > 0),
  );
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

  const content = doc.content.map((node): TiptapNode => {
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

  return { ...doc, content };
}

export function syncCrossReferences(
  doc: TiptapNode,
  equationNumbering: 'sequential' | 'hierarchical' = 'sequential',
  captionStyle: CaptionStyleName = 'modern',
  crossRefIncludeCaption = false,
): TiptapNode {
  if (!doc.content) return doc;

  const preset = getCaptionPreset(captionStyle);
  const labels = new Map<string, string>();
  let h1 = 0;
  let imageCount = 0;
  let tableCount = 0;
  let equationGlobal = 0;
  let equationInSection = 0;
  const headings = [0, 0, 0, 0, 0, 0];

  for (const node of doc.content) {
    if (node.type === 'heading') {
      const level = numberValue(node.attrs?.level, 1);
      const numbered = node.attrs?.numbered !== false;
      if (numbered) headings[level - 1]++;
      for (let index = level; index < headings.length; index++) headings[index] = 0;
      if (level === 1) {
        if (numbered) h1++;
        imageCount = 0;
        tableCount = 0;
        equationInSection = 0;
      }
      const id = attrString(node, 'id');
      if (id) {
        const text = getNodeText(node);
        labels.set(id, numbered ? `${headings.slice(0, level).join('.')}. ${text}` : text);
      }
    }
    if (node.type === 'image') {
      const number = `${preset.figurePrefix}${++imageCount}`;
      const caption = attrString(node, 'caption');
      const id = attrString(node, 'id');
      if (id) labels.set(id, crossRefIncludeCaption && caption ? `${number}${preset.separator}${caption}` : number);
    }
    if (node.type === 'table') {
      tableCount++;
      const tableNumber = preset.tableNumberStyle === 'roman' ? toRoman(tableCount) : `${tableCount}`;
      const number = `${preset.tablePrefix}${tableNumber}`;
      const caption = attrString(node, 'caption');
      const id = attrString(node, 'id');
      if (id) labels.set(id, crossRefIncludeCaption && caption ? `${number}${preset.separator}${caption}` : number);
    }
    if (node.type === 'mathBlock') {
      equationGlobal++;
      equationInSection++;
      const value = equationNumbering === 'hierarchical' ? `${h1}.${equationInSection}` : `${equationGlobal}`;
      const label = preset.equationParens
        ? `${preset.equationPrefix}(${value})`
        : `${preset.equationPrefix}${value}`;
      const id = attrString(node, 'id');
      if (id) labels.set(id, label);
    }
  }

  const updateReferences = (node: TiptapNode): TiptapNode => {
    const link = node.marks?.find(isInternalLink);
    const href = stringValue(link?.attrs?.href);
    const label = href ? labels.get(href.slice(1)) : undefined;
    return {
      ...node,
      ...(label && node.type === 'text' ? { text: label } : {}),
      ...(node.content ? { content: node.content.map(updateReferences) } : {}),
    };
  };

  return updateReferences(doc);
}

export interface DocumentNormalizationOptions {
  equationNumbering?: 'sequential' | 'hierarchical';
  captionStyle?: CaptionStyleName;
  crossRefIncludeCaption?: boolean;
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

  const headingNumbers = [0, 0, 0, 0, 0, 0];
  const allIds = new Set<string>();
  let imageCount = 0;
  let tableCount = 0;
  let equationCount = 0;

  for (const node of doc.content) {
    const id = attrString(node, 'id');
    if (id) allIds.add(id);
    if (node.type === 'heading') {
      const level = numberValue(node.attrs?.level, 1);
      const numbered = node.attrs?.numbered !== false;
      if (numbered) headingNumbers[level - 1]++;
      for (let index = level; index < headingNumbers.length; index++) headingNumbers[index] = 0;
      if (level === 1) {
        imageCount = 0;
        tableCount = 0;
      }
      result.headings.push({
        id,
        level,
        text: getNodeText(node),
        numbering: numbered ? headingNumbers.slice(0, level).join('.') : '',
      });
    }
    if (node.type === 'image') result.figures.push({ id, caption: attrString(node, 'caption'), number: ++imageCount });
    if (node.type === 'table') result.tables.push({ id, caption: attrString(node, 'caption'), number: ++tableCount });
    if (node.type === 'mathBlock') result.equations.push({ id, number: ++equationCount });
  }

  const collectReferences = (node: TiptapNode): void => {
    const link = node.marks?.find(isInternalLink);
    if (link) {
      const href = stringValue(link.attrs?.href);
      result.crossReferences.push({
        href,
        text: node.text || '',
        targetExists: allIds.has(href.slice(1)),
      });
    }
    node.content?.forEach(collectReferences);
  };
  collectReferences(doc);
  return result;
}
