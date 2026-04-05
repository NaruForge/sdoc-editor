/**
 * MCP Tool handler implementations for .sdoc documents.
 * Pure logic — no VS Code or MCP SDK dependencies.
 */

import {
  unwrapSdoc,
  wrapSdoc,
  createEmptySdoc,
  assignAutoIds,
  syncCrossReferences,
  migrateAttributes,
  queryDocumentStructure,
  extractTitle,
  type SdocEnvelope,
  type SdocMeta,
  type QueryResult,
} from './sdocUtils';

import { convertJsonToHtml } from '../converter/jsonToHtml';
import { convertJsonToMarkdown } from '../converter/jsonToMarkdown';
import { convertJsonToAdoc } from '../converter/jsonToAdoc';
import { convertMarkdownToJson } from '../converter/markdownToJson';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateSdoc(input: string | object): ValidateResult {
  const errors: ValidationError[] = [];

  let parsed: any;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      return { valid: false, errors: [{ path: '/', message: `Invalid JSON: ${(e as Error).message}` }] };
    }
  } else {
    parsed = input;
  }

  // Envelope checks
  if (!parsed.sdoc) {
    errors.push({ path: '/sdoc', message: 'Missing required field "sdoc" (schema version).' });
  } else if (parsed.sdoc !== '1.0') {
    errors.push({ path: '/sdoc', message: `Unsupported schema version "${parsed.sdoc}". Expected "1.0".` });
  }

  if (!parsed.meta) {
    errors.push({ path: '/meta', message: 'Missing required field "meta".' });
  } else {
    if (!parsed.meta.title && parsed.meta.title !== '') {
      errors.push({ path: '/meta/title', message: 'Missing "meta.title".' });
    }
    if (!parsed.meta.author && parsed.meta.author !== '') {
      errors.push({ path: '/meta/author', message: 'Missing "meta.author".' });
    }
    if (parsed.meta.created && isNaN(Date.parse(parsed.meta.created))) {
      errors.push({ path: '/meta/created', message: 'Invalid ISO 8601 date in "meta.created".' });
    }
    if (parsed.meta.modified && isNaN(Date.parse(parsed.meta.modified))) {
      errors.push({ path: '/meta/modified', message: 'Invalid ISO 8601 date in "meta.modified".' });
    }
  }

  if (!parsed.doc) {
    errors.push({ path: '/doc', message: 'Missing required field "doc".' });
  } else {
    if (parsed.doc.type !== 'doc') {
      errors.push({ path: '/doc/type', message: `Expected doc.type to be "doc", got "${parsed.doc.type}".` });
    }
    if (parsed.doc.content && Array.isArray(parsed.doc.content)) {
      validateNodes(parsed.doc.content, '/doc/content', errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

const VALID_BLOCK_TYPES = new Set([
  'heading', 'paragraph', 'bulletList', 'orderedList', 'taskList',
  'codeBlock', 'table', 'image', 'mathBlock', 'hardBreak', 'horizontalRule',
]);
const VALID_INLINE_TYPES = new Set(['text', 'mathInline', 'hardBreak', 'image']);
const VALID_MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link']);

function validateNodes(nodes: any[], basePath: string, errors: ValidationError[]) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const path = `${basePath}[${i}]`;

    if (!node.type) {
      errors.push({ path, message: 'Node missing "type" field.' });
      continue;
    }

    if (!VALID_BLOCK_TYPES.has(node.type) && !VALID_INLINE_TYPES.has(node.type) &&
        !['listItem', 'taskItem', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type)) {
      errors.push({ path, message: `Unknown node type "${node.type}".` });
    }

    // Check heading level
    if (node.type === 'heading') {
      const level = node.attrs?.level;
      if (!level || level < 1 || level > 6) {
        errors.push({ path: `${path}/attrs/level`, message: `Heading level must be 1-6, got "${level}".` });
      }
    }

    // Check data-* attribute usage (should use clean names)
    if (node.attrs) {
      for (const key of Object.keys(node.attrs)) {
        if (key.startsWith('data-')) {
          errors.push({ path: `${path}/attrs/${key}`, message: `Use clean camelCase name instead of "${key}". (e.g., "caption" not "data-caption")` });
        }
      }
    }

    // Check marks
    if (node.marks && Array.isArray(node.marks)) {
      for (let j = 0; j < node.marks.length; j++) {
        const mark = node.marks[j];
        if (!VALID_MARK_TYPES.has(mark.type)) {
          errors.push({ path: `${path}/marks[${j}]`, message: `Unknown mark type "${mark.type}".` });
        }
      }
    }

    // Recurse into content
    if (node.content && Array.isArray(node.content)) {
      validateNodes(node.content, `${path}/content`, errors);
    }
  }
}

export interface CreateOptions {
  title?: string;
  author?: string;
  version?: string;
}

export function createSdoc(options: CreateOptions): string {
  const envelope = createEmptySdoc({
    title: options.title,
    author: options.author,
    version: options.version,
  });
  return JSON.stringify(envelope, null, 2);
}

export type ExportFormat = 'html' | 'markdown' | 'asciidoc';

export interface ExportOptions {
  format: ExportFormat;
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  captionNumbering?: 'simple' | 'hierarchical';
}

export function exportSdoc(input: string | object, options: ExportOptions): string {
  let parsed: any;
  if (typeof input === 'string') {
    parsed = JSON.parse(input);
  } else {
    parsed = input;
  }

  const { meta, doc } = unwrapSdoc(parsed);
  const settings = {
    imageCaptionPrefix: options.imageCaptionPrefix || 'Image',
    tableCaptionPrefix: options.tableCaptionPrefix || 'Table',
    captionNumbering: options.captionNumbering || 'simple',
  };

  switch (options.format) {
    case 'html':
      return convertJsonToHtml(doc, undefined, settings, meta);
    case 'markdown':
      return convertJsonToMarkdown(doc, settings, meta);
    case 'asciidoc':
      return convertJsonToAdoc(doc, settings, meta);
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }
}

export function importMarkdown(markdown: string, meta?: Partial<SdocMeta>): string {
  const doc = convertMarkdownToJson(markdown);
  const title = meta?.title || extractTitle(doc);
  const now = new Date().toISOString();
  const envelope = wrapSdoc(doc, {
    title,
    author: meta?.author || '',
    version: meta?.version || '0.1',
    created: meta?.created || now,
    modified: now,
  });
  return JSON.stringify(envelope, null, 2);
}

export function processAssignIds(input: string | object): string {
  let parsed: any;
  if (typeof input === 'string') {
    parsed = JSON.parse(input);
  } else {
    parsed = input;
  }

  const { meta, doc } = unwrapSdoc(parsed);
  const withIds = assignAutoIds(doc);
  const envelope = wrapSdoc(withIds, meta);
  return JSON.stringify(envelope, null, 2);
}

export function processSyncRefs(input: string | object): string {
  let parsed: any;
  if (typeof input === 'string') {
    parsed = JSON.parse(input);
  } else {
    parsed = input;
  }

  const { meta, doc } = unwrapSdoc(parsed);
  const synced = syncCrossReferences(doc);
  const envelope = wrapSdoc(synced, meta);
  return JSON.stringify(envelope, null, 2);
}

export function processMigrate(input: string | object): string {
  let parsed: any;
  if (typeof input === 'string') {
    parsed = JSON.parse(input);
  } else {
    parsed = input;
  }

  const { meta, doc } = unwrapSdoc(parsed);
  // migrateAttributes is already called in unwrapSdoc, so doc is already migrated
  const envelope = wrapSdoc(doc, meta);
  return JSON.stringify(envelope, null, 2);
}

export function queryDocument(input: string | object): QueryResult {
  let parsed: any;
  if (typeof input === 'string') {
    parsed = JSON.parse(input);
  } else {
    parsed = input;
  }

  const { doc } = unwrapSdoc(parsed);
  return queryDocumentStructure(doc);
}
