import type { DocumentSettings, SdocEnvelope, TiptapNode } from '../../types';
import { resolveSettings } from '../../settingsResolver';
import {
  assertPersistedDocument,
  parseDocumentContract,
  validateDocumentSettings,
} from '../documentContract';
import { normalizeDocumentTitle, unicodeCodePointLength } from '../title';
import { normalizeDocument } from '../sdocUtils';
import { buildNumberingIndex } from '../numbering';
import { walkDocument } from '../walker';
import { parsePortableAssetPath } from '../../security/portableAssets';
import { MAX_DOCUMENT_BYTES } from '../../resourceLimits';
import { computeRevision, decodeUtf8, encodeUtf8 } from './sha256';
import type {
  ApplyOperationResult, ApplyOptions, BlockDestination, InspectDocumentResult, InspectOptions,
  NodeTarget, OperationDiagnostic, OperationFailure, SemanticDiffEvent, SdocOperation,
  SdocOperationRequest, Sha256Digest, ValidateDocumentResult,
} from './types';

export { computeRevision } from './sha256';
export type * from './types';

const MAX_OPERATIONS = 100;
const MAX_DEPTH = 128;
const MAX_NODES = 100_000;
const MAX_TARGET_DETAIL_BYTES = 256 * 1024;
const REFERENCEABLE = new Set(['heading', 'image', 'table', 'mathBlock']);
const RENAMABLE_ID_TYPES = new Set(['heading', 'table']);
const NON_BLOCK = new Set([
  'doc', 'text', 'mathInline', 'tableRow', 'listItem',
]);
const PORTABLE_SETTING_KEYS = new Set<keyof DocumentSettings>([
  'headingNumbering',
  'headingStartNumber',
  'headingDecoration',
  'headingH1Color',
  'headingH2Color',
  'headingH3Color',
  'headingH4Color',
  'headingH5Color',
  'headingH6Color',
  'captionStyle',
  'captionNumbering',
  'equationNumbering',
  'crossRefIncludeCaption',
  'pdfScale',
  'selfContained',
  'slideBreakLevel',
  'slideTransition',
  'showTitleSlide',
]);
const ATTR_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  heading: new Set(['textAlign', 'numbered']),
  paragraph: new Set(['textAlign']),
  orderedList: new Set(['start', 'type']),
  taskItem: new Set(['checked']),
  codeBlock: new Set(['language']),
  table: new Set(['caption', 'align', 'width']),
  tableCell: new Set(['colspan', 'rowspan', 'colwidth', 'align']),
  tableHeader: new Set(['colspan', 'rowspan', 'colwidth', 'align']),
  image: new Set(['src', 'alt', 'title', 'caption', 'align', 'width', 'height']),
  mathBlock: new Set(['latex']),
  diagram: new Set(['language', 'code']),
  callout: new Set(['variant']),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean => Object.keys(value).every((key) => allowed.has(key));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const textOf = (node: TiptapNode): string =>
  node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(textOf).join('');
const summary = (node: TiptapNode, limit = 120): string => {
  const raw = textOf(node) || String(node.attrs?.caption ?? node.attrs?.latex ?? node.attrs?.src ?? '');
  const compact = raw.replace(/\s+/g, ' ').trim();
  return `${node.type}${compact ? `: ${compact}` : ''}`.slice(0, limit);
};
const ATTRIBUTE_DIFF_VALUE_LIMIT = 80;
const boundedAttributeValue = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  const rendered = serialized === undefined ? String(value) : serialized;
  return rendered.length <= ATTRIBUTE_DIFF_VALUE_LIMIT
    ? rendered
    : `${rendered.slice(0, ATTRIBUTE_DIFF_VALUE_LIMIT - 1)}…`;
};
const attributeDiffSummary = (
  attrs: Record<string, unknown> | undefined,
  keys: readonly string[],
): string => keys.map((key) => {
  const value = attrs && Object.prototype.hasOwnProperty.call(attrs, key)
    ? boundedAttributeValue(attrs[key])
    : '<unset>';
  return `${key}=${value}`;
}).join(', ');
const internalReferenceTexts = (doc: TiptapNode): Map<string, string> => {
  const result = new Map<string, string>();
  for (const { node, path } of walkDocument(doc)) {
    const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
    if (typeof href === 'string' && href.startsWith('#')) {
      result.set(pathKey(path), node.text ?? '');
    }
  }
  return result;
};
const numberingById = (
  doc: TiptapNode,
  settings: Required<DocumentSettings>,
): Map<string, string> => new Map(
  Array.from(buildNumberingIndex(doc, settings).byId, ([id, entry]) => [id, entry.number]),
);
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};
const nodeDigest = (node: TiptapNode): Sha256Digest =>
  computeRevision(JSON.stringify(stableValue(node)));
const pathKey = (path: readonly number[]): string => path.join('.');
const documentId = (envelope: SdocEnvelope): string | undefined => {
  const value = envelope.meta.documentId ?? envelope.meta.id;
  return typeof value === 'string' ? value : undefined;
};
const readText = (bytes: Uint8Array | string): string => {
  if (typeof bytes === 'string') return bytes.charCodeAt(0) === 0xfeff ? bytes.slice(1) : bytes;
  return decodeUtf8(bytes);
};
const failure = (
  category: OperationFailure['category'], code: string, message: string, path?: string,
): OperationFailure => ({
  ok: false, category, diagnostics: [{ code, message, ...(path ? { path } : {}) }],
});
const isFailure = (value: unknown): value is OperationFailure =>
  isRecord(value) && value.ok === false && typeof value.category === 'string';

interface Loaded {
  text: string;
  revision: Sha256Digest;
  envelope: SdocEnvelope;
  legacy: boolean;
}

function load(bytes: Uint8Array | string): Loaded | OperationFailure {
  const size = typeof bytes === 'string' ? encodeUtf8(bytes).byteLength : bytes.byteLength;
  if (size > MAX_DOCUMENT_BYTES) return failure('document', 'DOCUMENT_TOO_LARGE', 'document exceeds 32 MiB');
  let text: string;
  let parsed: unknown;
  try {
    text = readText(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch {
    return failure('document', 'MALFORMED_JSON', 'document is not valid UTF-8 JSON');
  }
  const preflight = preflightUnknownTree(parsed);
  if (preflight) return preflight;
  let contract: ReturnType<typeof parseDocumentContract>;
  try {
    contract = parseDocumentContract(parsed);
  } catch {
    return failure('document', 'DOCUMENT_VALIDATION_FAILED',
      'document could not be validated within structural limits');
  }
  if (!contract.ok) {
    return {
      ok: false,
      category: 'document',
      diagnostics: contract.diagnostics.map((item) => ({
        code: contract.kind === 'unsupported-version' ? 'UNSUPPORTED_VERSION' : 'DOCUMENT_SCHEMA_INVALID',
        message: item.message,
        path: item.path,
      })),
    };
  }
  const limits = checkLimits(contract.envelope.doc);
  if (limits) return limits;
  return { text, revision: computeRevision(bytes), envelope: contract.envelope, legacy: contract.legacy };
}

function preflightUnknownTree(parsed: unknown): OperationFailure | undefined {
  const root = isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'doc')
    ? parsed.doc : parsed;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || !isRecord(current.value)) continue;
    count += 1;
    if (current.depth > MAX_DEPTH) {
      return failure('document', 'TREE_TOO_DEEP', 'tree depth exceeds 128');
    }
    if (count > MAX_NODES) {
      return failure('document', 'TOO_MANY_NODES', 'document exceeds 100,000 nodes');
    }
    if (!Array.isArray(current.value.content)) continue;
    for (let index = current.value.content.length - 1; index >= 0; index -= 1) {
      stack.push({ value: current.value.content[index], depth: current.depth + 1 });
    }
  }
  return undefined;
}

function checkLimits(doc: TiptapNode): OperationFailure | undefined {
  let count = 0;
  for (const { path } of walkDocument(doc)) {
    count += 1;
    if (path.length > MAX_DEPTH) return failure('document', 'TREE_TOO_DEEP', 'tree depth exceeds 128');
    if (count > MAX_NODES) return failure('document', 'TOO_MANY_NODES', 'document exceeds 100,000 nodes');
  }
  return undefined;
}

interface Baseline {
  duplicates: string[];
  violations: Map<string, number>;
  warnings: OperationDiagnostic[];
  missingIds: boolean;
}

function analyze(doc: TiptapNode): Baseline {
  const ids = new Set<string>();
  const duplicates: string[] = [];
  let missingIds = false;
  for (const { node } of walkDocument(doc)) {
    const id = typeof node.attrs?.id === 'string' && node.attrs.id ? node.attrs.id : undefined;
    if (id) {
      if (ids.has(id)) duplicates.push(id);
      ids.add(id);
    } else if (REFERENCEABLE.has(node.type)) missingIds = true;
  }
  const violations = new Map<string, number>();
  const addViolation = (kind: string, value: string): void => {
    const key = `${kind}:${value.normalize('NFC')}`;
    violations.set(key, (violations.get(key) ?? 0) + 1);
  };
  for (const { node } of walkDocument(doc)) {
    if (node.type === 'image') {
      const src = node.attrs?.src;
      if (typeof src === 'string' && !parsePortableAssetPath(src)) {
        addViolation('asset', src);
      }
    }
    for (const mark of node.marks ?? []) {
      const href = mark.type === 'link' ? mark.attrs?.href : undefined;
      if (typeof href !== 'string') continue;
      const normalizedHref = href.trim().normalize('NFC');
      if (normalizedHref.startsWith('#')) {
        if (!ids.has(normalizedHref.slice(1))) addViolation('dangling', normalizedHref);
      } else if (/[\u0000-\u001f\u007f-\u009f]/.test(href)
        || /^(?:javascript|data|file):/i.test(normalizedHref)
        || /^[a-zA-Z]:[\\/]/.test(normalizedHref)
        || normalizedHref.startsWith('/') || normalizedHref.startsWith('\\\\')) {
        addViolation('link', normalizedHref);
      }
    }
  }
  const warnings = Array.from(violations).slice(0, 100).map(([entry, count]): OperationDiagnostic => ({
    code: entry.startsWith('asset:') ? 'NONPORTABLE_ASSET'
      : entry.startsWith('dangling:') ? 'DANGLING_REFERENCE' : 'UNSAFE_LINK',
    message: `${entry.slice(entry.indexOf(':') + 1)} (${count})`,
    severity: 'warning',
  }));
  return { ids, duplicates, violations, warnings, missingIds } as Baseline & { ids: Set<string> };
}

const nodeAt = (root: TiptapNode, path: readonly number[]): TiptapNode | undefined => {
  let current: TiptapNode | undefined = root;
  for (const index of path) current = current?.content?.[index];
  return current;
};
const provisionalId = (revision: Sha256Digest, path: readonly number[], node: TiptapNode): string =>
  `provisional:${computeRevision(`${revision}:${pathKey(path)}:${node.type}`).slice(7, 23)}`;

const operationTargetFor = (
  revision: Sha256Digest,
  path: readonly number[],
  node: TiptapNode,
): NodeTarget => {
  const id = typeof node.attrs?.id === 'string' && node.attrs.id
    ? node.attrs.id
    : REFERENCEABLE.has(node.type) ? provisionalId(revision, path, node) : undefined;
  return id
    ? { kind: 'id', id, expectedType: node.type }
    : { kind: 'snapshot', path: [...path], nodeType: node.type, digest: nodeDigest(node) };
};

interface TargetIndex {
  byId: Map<string, TiptapNode>;
  paths: Map<TiptapNode, number[]>;
}

function indexTargets(root: TiptapNode, revision: Sha256Digest): TargetIndex {
  const byId = new Map<string, TiptapNode>();
  const paths = new Map<TiptapNode, number[]>();
  for (const { node, path } of walkDocument(root)) {
    paths.set(node, [...path]);
    const id = node.attrs?.id;
    if (typeof id === 'string' && id) byId.set(id, node);
    else if (REFERENCEABLE.has(node.type)) byId.set(provisionalId(revision, path, node), node);
  }
  return { byId, paths };
}

function resolveTarget(
  root: TiptapNode, target: NodeTarget, index: TargetIndex,
): TiptapNode | OperationFailure {
  if (target.kind === 'id') {
    const node = index.byId.get(target.id);
    if (!node) return failure('conflict', 'TARGET_NOT_FOUND', `target id ${target.id} was not found`);
    if (target.expectedType && node.type !== target.expectedType) {
      return failure('conflict', 'TARGET_TYPE_MISMATCH', `expected ${target.expectedType}, found ${node.type}`);
    }
    return node;
  }
  const node = nodeAt(root, target.path);
  if (!node) return failure('conflict', 'TARGET_NOT_FOUND', `target path ${pathKey(target.path)} was not found`);
  if (node.type !== target.nodeType) {
    return failure('conflict', 'TARGET_TYPE_MISMATCH', `expected ${target.nodeType}, found ${node.type}`);
  }
  if (nodeDigest(node) !== target.digest) {
    return failure('conflict', 'TARGET_DIGEST_MISMATCH', 'snapshot target no longer matches its digest');
  }
  return node;
}

function narrowTarget(value: unknown): NodeTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'id' && typeof value.id === 'string'
    && hasOnlyKeys(value, new Set(['kind', 'id', 'expectedType']))
    && (value.expectedType === undefined || typeof value.expectedType === 'string')) {
    return { kind: 'id', id: value.id, ...(value.expectedType ? { expectedType: value.expectedType } : {}) };
  }
  if (value.kind === 'snapshot' && Array.isArray(value.path)
    && hasOnlyKeys(value, new Set(['kind', 'path', 'nodeType', 'digest']))
    && value.path.every((item) => Number.isInteger(item) && Number(item) >= 0)
    && typeof value.nodeType === 'string'
    && typeof value.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(value.digest)) {
    return {
      kind: 'snapshot', path: value.path as number[], nodeType: value.nodeType,
      digest: value.digest as Sha256Digest,
    };
  }
  return undefined;
}

function narrowDestination(value: unknown): BlockDestination | undefined {
  if (!isRecord(value)
    || !hasOnlyKeys(value, new Set(['position', 'target']))
    || (value.position !== 'before' && value.position !== 'after' && value.position !== 'section-end')) {
    return undefined;
  }
  const target = narrowTarget(value.target);
  return target ? { position: value.position, target } : undefined;
}

function isNode(value: unknown): value is TiptapNode {
  return isRecord(value) && typeof value.type === 'string' && value.type.length > 0
    && (value.content === undefined
      || (Array.isArray(value.content) && value.content.every(isNode)))
    && (value.attrs === undefined || isRecord(value.attrs))
    && (value.text === undefined || typeof value.text === 'string')
    && (value.marks === undefined || (Array.isArray(value.marks) && value.marks.every((mark) =>
      isRecord(mark)
      && typeof mark.type === 'string'
      && mark.type.length > 0
      && (mark.attrs === undefined || isRecord(mark.attrs)))));
}

function checkOperationTreeLimits(operations: readonly unknown[]): OperationFailure | undefined {
  const stack: Array<{ value: unknown; depth: number }> = [];
  for (const operation of operations) {
    if (!isRecord(operation)) continue;
    if ('block' in operation) stack.push({ value: operation.block, depth: 0 });
    if (Array.isArray(operation.blocks)) {
      for (const block of operation.blocks) stack.push({ value: block, depth: 0 });
    }
  }
  const seen = new WeakSet<object>();
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!isRecord(current.value)) continue;
    if (seen.has(current.value)) {
      return failure('argument', 'INVALID_OPERATION_TREE', 'operation node trees must not contain cycles or aliases');
    }
    seen.add(current.value);
    count += 1;
    if (current.depth > MAX_DEPTH) {
      return failure('argument', 'OPERATION_TREE_TOO_DEEP', 'operation tree depth exceeds 128');
    }
    if (count > MAX_NODES) {
      return failure('argument', 'TOO_MANY_OPERATION_NODES', 'operation batch exceeds 100,000 nodes');
    }
    if (Array.isArray(current.value.content)) {
      for (const child of current.value.content) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return undefined;
}

function narrowOperation(value: unknown): SdocOperation | undefined {
  if (!isRecord(value) || typeof value.op !== 'string') return undefined;
  const allowedKeys: Record<string, ReadonlySet<string>> = {
    renameHeading: new Set(['op', 'target', 'title', 'discardFormatting']),
    setDocumentTitle: new Set(['op', 'title', 'headingTarget', 'discardFormatting']),
    updateDocumentMetadata: new Set(['op', 'patch']),
    updateDocumentSettings: new Set(['op', 'patch']),
    insertBlock: new Set(['op', 'destination', 'block']),
    insertSection: new Set(['op', 'target', 'title', 'id', 'blocks', 'position']),
    replaceBlock: new Set(['op', 'target', 'block']),
    updateBlockAttrs: new Set(['op', 'target', 'attrs']),
    moveBlock: new Set(['op', 'target', 'destination']),
    deleteBlock: new Set(['op', 'target']),
    moveSection: new Set(['op', 'target', 'destination']),
    deleteSection: new Set(['op', 'target']),
    setHeadingLevel: new Set(['op', 'target', 'level']),
    renameBlockId: new Set(['op', 'target', 'newId']),
  };
  const allowed = allowedKeys[value.op];
  if (!allowed || !hasOnlyKeys(value, allowed)) return undefined;
  const target = narrowTarget(value.target);
  if (value.op === 'renameHeading' && target && typeof value.title === 'string'
    && (value.discardFormatting === undefined || typeof value.discardFormatting === 'boolean')) {
    return { op: value.op, target, title: value.title, discardFormatting: value.discardFormatting === true };
  }
  if (value.op === 'setDocumentTitle' && typeof value.title === 'string'
    && (value.headingTarget === undefined || narrowTarget(value.headingTarget))
    && (value.discardFormatting === undefined || typeof value.discardFormatting === 'boolean')) {
    const normalized = normalizeDocumentTitle(value.title);
    if (!normalized.ok) return undefined;
    const headingTarget = value.headingTarget === undefined
      ? undefined : narrowTarget(value.headingTarget);
    return {
      op: value.op,
      title: normalized.title,
      ...(headingTarget ? { headingTarget } : {}),
      ...(value.discardFormatting === true ? { discardFormatting: true } : {}),
    };
  }
  if (value.op === 'updateDocumentMetadata' && isRecord(value.patch)
    && hasOnlyKeys(value.patch, new Set(['author', 'version']))
    && Object.keys(value.patch).length > 0
    && Object.values(value.patch).every((entry) =>
      entry === null || (typeof entry === 'string' && unicodeCodePointLength(entry) <= 200))) {
    return {
      op: value.op,
      patch: {
        ...(Object.prototype.hasOwnProperty.call(value.patch, 'author')
          ? { author: value.patch.author as string | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(value.patch, 'version')
          ? { version: value.patch.version as string | null } : {}),
      },
    };
  }
  if (value.op === 'updateDocumentSettings' && isRecord(value.patch)
    && Object.keys(value.patch).length > 0
    && Object.keys(value.patch).every((key) => PORTABLE_SETTING_KEYS.has(key as keyof DocumentSettings))
    && Object.entries(value.patch).every(([key, entry]) =>
      entry === null || validateDocumentSettings({ [key]: entry }))) {
    return { op: value.op, patch: clone(value.patch) };
  }
  if (value.op === 'insertBlock') {
    const destination = narrowDestination(value.destination);
    if (destination && isNode(value.block)) return { op: value.op, destination, block: value.block };
  }
  if (value.op === 'insertSection' && target && typeof value.title === 'string'
    && (value.id === undefined || typeof value.id === 'string')
    && (value.blocks === undefined || (Array.isArray(value.blocks) && value.blocks.every(isNode)))
    && (value.position === undefined || value.position === 'child' || value.position === 'before' || value.position === 'after')) {
    return {
      op: value.op, target, title: value.title,
      ...(typeof value.id === 'string' ? { id: value.id } : {}),
      ...(Array.isArray(value.blocks) ? { blocks: value.blocks } : {}),
      ...(typeof value.position === 'string' ? { position: value.position } : {}),
    };
  }
  if (value.op === 'replaceBlock' && target && isNode(value.block)) {
    return { op: value.op, target, block: value.block };
  }
  if (value.op === 'updateBlockAttrs' && target && isRecord(value.attrs)) {
    return { op: value.op, target, attrs: value.attrs };
  }
  if (value.op === 'moveBlock' && target) {
    const destination = narrowDestination(value.destination);
    if (destination) return { op: value.op, target, destination };
  }
  if (value.op === 'deleteBlock' && target) return { op: value.op, target };
  if (value.op === 'moveSection' && target) {
    const destination = narrowDestination(value.destination);
    if (destination) return { op: value.op, target, destination };
  }
  if (value.op === 'deleteSection' && target) return { op: value.op, target };
  if (value.op === 'setHeadingLevel' && target
    && typeof value.level === 'number' && Number.isFinite(value.level)) {
    return { op: value.op, target, level: value.level };
  }
  if (value.op === 'renameBlockId' && target && typeof value.newId === 'string') {
    return { op: value.op, target, newId: value.newId };
  }
  return undefined;
}

function narrowRequest(value: unknown): SdocOperationRequest | OperationFailure {
  if (!isRecord(value) || value.contract !== 'sdoc.operations/1' || !isRecord(value.expected)
    || !hasOnlyKeys(value, new Set(['contract', 'expected', 'operations']))
    || !hasOnlyKeys(value.expected, new Set(['revision', 'documentId']))
    || typeof value.expected.revision !== 'string'
    || !/^sha256:[0-9a-f]{64}$/.test(value.expected.revision)
    || (value.expected.documentId !== undefined && typeof value.expected.documentId !== 'string')
    || !Array.isArray(value.operations)) {
    return failure('argument', 'INVALID_OPERATION_REQUEST', 'request does not match sdoc.operations/1');
  }
  if (value.operations.length > MAX_OPERATIONS) {
    return failure('argument', 'TOO_MANY_OPERATIONS', 'operation batch exceeds 100');
  }
  const operationLimits = checkOperationTreeLimits(value.operations);
  if (operationLimits) return operationLimits;
  const operations = value.operations.map(narrowOperation);
  const badIndex = operations.findIndex((item) => item === undefined);
  if (badIndex >= 0) {
    const result = failure('argument', 'INVALID_OPERATION', `operation ${badIndex} is invalid`);
    result.diagnostics[0].operationIndex = badIndex;
    return result;
  }
  return {
    contract: 'sdoc.operations/1',
    expected: {
      revision: value.expected.revision as Sha256Digest,
      ...(typeof value.expected.documentId === 'string'
        ? { documentId: value.expected.documentId } : {}),
    },
    operations: operations as SdocOperation[],
  };
}

function findCurrent(root: TiptapNode, sought: TiptapNode):
{ parent: TiptapNode; index: number; path: number[] } | undefined {
  for (const { node, path } of walkDocument(root)) {
    const index = node.content?.indexOf(sought) ?? -1;
    if (index >= 0) return { parent: node, index, path: [...path, index] };
  }
  return undefined;
}

function sectionRange(root: TiptapNode, heading: TiptapNode):
{ parent: TiptapNode; start: number; end: number } | OperationFailure {
  if (heading.type !== 'heading') return failure('argument', 'SECTION_TARGET_REQUIRED', 'section target must be a heading');
  const location = findCurrent(root, heading);
  if (!location) return failure('conflict', 'TARGET_REMOVED', 'target was removed by an earlier operation');
  const level = Number(heading.attrs?.level);
  let end = location.index + 1;
  const siblings = location.parent.content ?? [];
  while (end < siblings.length) {
    const sibling = siblings[end];
    if (sibling.type === 'heading' && Number(sibling.attrs?.level) <= level) break;
    end += 1;
  }
  return { parent: location.parent, start: location.index, end };
}

function destinationIndex(
  root: TiptapNode, destination: BlockDestination, target: TiptapNode,
): { parent: TiptapNode; index: number } | OperationFailure {
  if (destination.position === 'section-end') {
    const range = sectionRange(root, target);
    return 'ok' in range ? range : { parent: range.parent, index: range.end };
  }
  const location = findCurrent(root, target);
  if (!location) return failure('conflict', 'TARGET_REMOVED', 'destination was removed by an earlier operation');
  return {
    parent: location.parent,
    index: location.index + (destination.position === 'after' ? 1 : 0),
  };
}

function operationEvent(op: SdocOperation, before?: string, after?: string): SemanticDiffEvent {
  const kinds: Record<SdocOperation['op'], SemanticDiffEvent['kind']> = {
    renameHeading: 'heading-renamed', insertBlock: 'block-inserted',
    setDocumentTitle: 'document-title-updated',
    updateDocumentMetadata: 'document-metadata-updated',
    updateDocumentSettings: 'document-settings-updated',
    insertSection: 'section-inserted', replaceBlock: 'block-replaced',
    updateBlockAttrs: 'block-attrs-updated', moveBlock: 'block-moved',
    deleteBlock: 'block-deleted', moveSection: 'section-moved', deleteSection: 'section-deleted',
    setHeadingLevel: 'section-level-changed',
    renameBlockId: 'block-id-renamed',
  };
  return { kind: kinds[op.op], ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

function applyOne(
  envelope: SdocEnvelope, op: SdocOperation, targets: Map<NodeTarget, TiptapNode>,
): SemanticDiffEvent | OperationFailure {
  const root = envelope.doc;
  const target = 'target' in op ? targets.get(op.target) : undefined;
  if ('target' in op && !target) return failure('conflict', 'TARGET_REMOVED', 'target is unavailable');
  if (target && !findCurrent(root, target)) {
    return failure('conflict', 'TARGET_REMOVED', 'target was removed by an earlier operation');
  }
  if (op.op === 'renameHeading') {
    if (target?.type !== 'heading') return failure('argument', 'HEADING_TARGET_REQUIRED', 'renameHeading requires a heading');
    const complex = (target.content ?? []).some((node) =>
      node.type !== 'text' || (node.marks?.length ?? 0) > 0);
    if (complex && !op.discardFormatting) {
      return failure('conflict', 'FORMATTED_HEADING', 'heading contains marks or non-text inline content');
    }
    const before = summary(target);
    target.content = op.title ? [{ type: 'text', text: op.title }] : [];
    return operationEvent(op, before, summary(target));
  }
  if (op.op === 'setDocumentTitle') {
    const heading = op.headingTarget ? targets.get(op.headingTarget) : undefined;
    if (op.headingTarget && !heading) {
      return failure('conflict', 'TARGET_REMOVED', 'title heading is unavailable');
    }
    if (heading && !findCurrent(root, heading)) {
      return failure('conflict', 'TARGET_REMOVED', 'title heading was removed by an earlier operation');
    }
    if (heading && (heading.type !== 'heading' || Number(heading.attrs?.level) !== 1)) {
      return failure('argument', 'TITLE_H1_TARGET_REQUIRED',
        'setDocumentTitle headingTarget must be an H1 heading');
    }
    if (heading) {
      const complex = (heading.content ?? []).some((node) =>
        node.type !== 'text' || (node.marks?.length ?? 0) > 0);
      if (complex && !op.discardFormatting) {
        return failure('conflict', 'FORMATTED_HEADING',
          'title heading contains marks or non-text inline content');
      }
      heading.content = [{ type: 'text', text: op.title }];
    }
    const before = typeof envelope.meta.title === 'string' ? envelope.meta.title : undefined;
    envelope.meta.title = op.title;
    return operationEvent(op, before, op.title);
  }
  if (op.op === 'updateDocumentMetadata') {
    const keys = Object.keys(op.patch).sort();
    const before = attributeDiffSummary(envelope.meta, keys);
    for (const key of keys as Array<'author' | 'version'>) {
      const value = op.patch[key];
      if (value === null) delete envelope.meta[key];
      else if (value !== undefined) envelope.meta[key] = value;
    }
    return operationEvent(op, before, attributeDiffSummary(envelope.meta, keys));
  }
  if (op.op === 'updateDocumentSettings') {
    const keys = Object.keys(op.patch).sort();
    const settings: Partial<DocumentSettings> = { ...envelope.meta.settings };
    const before = attributeDiffSummary(settings, keys);
    for (const key of keys as Array<keyof typeof op.patch>) {
      const value = op.patch[key];
      if (value === null) delete settings[key];
      else if (value !== undefined) {
        (settings as Record<string, unknown>)[key] = clone(value);
      }
    }
    if (Object.keys(settings).length === 0) delete envelope.meta.settings;
    else envelope.meta.settings = settings;
    return operationEvent(op, before, attributeDiffSummary(envelope.meta.settings, keys));
  }
  if (op.op === 'insertBlock') {
    const destinationTarget = targets.get(op.destination.target);
    if (!destinationTarget) return failure('conflict', 'TARGET_REMOVED', 'destination is unavailable');
    const destination = destinationIndex(root, op.destination, destinationTarget);
    if ('ok' in destination) return destination;
    const block = clone(op.block);
    if (block.type === 'heading') {
      return failure('argument', 'SECTION_OPERATION_REQUIRED', 'headings must be inserted as sections');
    }
    destination.parent.content ??= [];
    destination.parent.content.splice(destination.index, 0, block);
    return operationEvent(op, undefined, summary(block));
  }
  if (op.op === 'insertSection') {
    if (!target) return failure('conflict', 'TARGET_REMOVED', 'parent section is unavailable');
    const range = sectionRange(root, target);
    if ('ok' in range) return range;
    const level = Number(target.attrs?.level);
    const position = op.position ?? 'child';
    const newLevel = position === 'child' ? level + 1 : level;
    if (position === 'child' && level >= 6) {
      return failure('argument', 'H6_CHILD_SECTION', 'cannot insert a child section below H6');
    }
    if (newLevel < 1 || newLevel > 6) {
      return failure('argument', 'INVALID_HEADING_LEVEL', `resulting heading level ${newLevel} is out of range 1-6`);
    }
    const heading: TiptapNode = {
      type: 'heading', attrs: { level: newLevel, ...(op.id ? { id: op.id } : {}) },
      content: op.title ? [{ type: 'text', text: op.title }] : [],
    };
    if ((op.blocks ?? []).some((block) => block.type === 'heading')) {
      return failure('argument', 'SECTION_OPERATION_REQUIRED',
        'insertSection blocks cannot contain sibling headings');
    }
    range.parent.content ??= [];
    if (position === 'before') {
      range.parent.content.splice(range.start, 0, heading, ...(op.blocks ?? []).map(clone));
    } else {
      // 'child' appends at section end (inside), 'after' appends at section end (outside)
      range.parent.content.splice(range.end, 0, heading, ...(op.blocks ?? []).map(clone));
    }
    return operationEvent(op, undefined, summary(heading));
  }
  if (op.op === 'replaceBlock') {
    if (!target) return failure('conflict', 'TARGET_REMOVED', 'target is unavailable');
    if (target.type === 'heading') return failure('argument', 'SECTION_OPERATION_REQUIRED', 'heading replacement requires a section operation');
    if (op.block.type !== target.type) return failure('argument', 'NODE_TYPE_CHANGE', 'replaceBlock must preserve node type');
    const oldId = target.attrs?.id;
    const newId = op.block.attrs?.id;
    if (oldId !== undefined && newId !== undefined && oldId !== newId) {
      return failure('argument', 'ID_CHANGE_FORBIDDEN', 'replaceBlock must preserve the existing id');
    }
    const location = findCurrent(root, target);
    if (!location) return failure('conflict', 'TARGET_REMOVED', 'target was removed');
    const replacement = clone(op.block);
    if (oldId !== undefined) replacement.attrs = { ...replacement.attrs, id: oldId };
    location.parent.content?.splice(location.index, 1, replacement);
    for (const [key, value] of targets) {
      if (value === target) targets.set(key, replacement);
    }
    return operationEvent(op, summary(target), summary(replacement));
  }
  if (op.op === 'updateBlockAttrs') {
    if (!target) return failure('conflict', 'TARGET_REMOVED', 'target is unavailable');
    if (target.type === 'heading' && Object.prototype.hasOwnProperty.call(op.attrs, 'level')) {
      return failure('argument', 'SECTION_OPERATION_REQUIRED', 'heading level cannot be changed as a block attribute');
    }
    const allowed = ATTR_ALLOWLIST[target.type] ?? new Set<string>();
    const invalid = Object.keys(op.attrs).find((key) => !allowed.has(key));
    if (invalid) return failure('argument', 'ATTRIBUTE_NOT_ALLOWED', `${invalid} is not mutable on ${target.type}`);
    const beforeAttrs = target.attrs;
    const changedKeys = Object.keys(op.attrs)
      .filter((key) => JSON.stringify(beforeAttrs?.[key]) !== JSON.stringify(op.attrs[key]))
      .sort();
    target.attrs = { ...target.attrs, ...clone(op.attrs) };
    return operationEvent(
      op,
      attributeDiffSummary(beforeAttrs, changedKeys),
      attributeDiffSummary(target.attrs, changedKeys),
    );
  }
  if (op.op === 'deleteBlock' || op.op === 'moveBlock') {
    if (!target) return failure('conflict', 'TARGET_REMOVED', 'target is unavailable');
    if (target.type === 'heading') return failure('argument', 'SECTION_OPERATION_REQUIRED', 'headings require section operations');
    const location = findCurrent(root, target);
    if (!location) return failure('conflict', 'TARGET_REMOVED', 'target was removed');
    const before = summary(target);
    location.parent.content?.splice(location.index, 1);
    if (op.op === 'moveBlock') {
      const destinationTarget = targets.get(op.destination.target);
      if (!destinationTarget) return failure('conflict', 'TARGET_REMOVED', 'destination is unavailable');
      const destination = destinationIndex(root, op.destination, destinationTarget);
      if ('ok' in destination) return destination;
      destination.parent.content ??= [];
      destination.parent.content.splice(destination.index, 0, target);
    }
    return operationEvent(op, before);
  }
  if (op.op === 'deleteSection' || op.op === 'moveSection') {
    if (!target) return failure('conflict', 'TARGET_REMOVED', 'target is unavailable');
    const range = sectionRange(root, target);
    if ('ok' in range) return range;
    const moved = range.parent.content?.splice(range.start, range.end - range.start) ?? [];
    if (op.op === 'moveSection') {
      const destinationTarget = targets.get(op.destination.target);
      if (!destinationTarget || moved.includes(destinationTarget)) {
        return failure('conflict', 'INVALID_SECTION_DESTINATION', 'section cannot move into itself');
      }
      const destination = destinationIndex(root, op.destination, destinationTarget);
      if ('ok' in destination) return destination;
      destination.parent.content ??= [];
      destination.parent.content.splice(destination.index, 0, ...moved);
    }
    return operationEvent(op, summary(target));
  }
  if (op.op === 'setHeadingLevel') {
    if (!target) return failure('conflict', 'TARGET_REMOVED', 'target is unavailable');
    if (target.type !== 'heading') {
      return failure('argument', 'HEADING_TARGET_REQUIRED',
        'setHeadingLevel requires a heading target');
    }
    if (!Number.isSafeInteger(op.level) || op.level < 1 || op.level > 6) {
      return failure('argument', 'INVALID_HEADING_LEVEL', 'heading level must be an integer from 1 to 6');
    }
    const range = sectionRange(root, target);
    if ('ok' in range) return range;
    const oldLevel = Number(target.attrs?.level);
    const delta = op.level - oldLevel;
    const sectionNodes = (range.parent.content ?? []).slice(range.start, range.end);
    const headings = sectionNodes.filter((node) => node.type === 'heading');
    const invalid = headings.find((heading) => {
      const nextLevel = Number(heading.attrs?.level) + delta;
      return nextLevel < 1 || nextLevel > 6;
    });
    if (invalid) {
      return failure('argument', 'SECTION_LEVEL_OUT_OF_RANGE',
        'level change would move a descendant heading outside the valid range 1-6');
    }
    for (const heading of headings) {
      heading.attrs = { ...heading.attrs, level: Number(heading.attrs?.level) + delta };
    }
    return {
      kind: 'section-level-changed',
      before: `H${oldLevel}`,
      after: `H${op.level}`,
      ...(headings.length > 1 ? { indirectChanges: headings.length - 1 } : {}),
    };
  }
  if (op.op === 'renameBlockId') {
    if (!target) return failure('conflict', 'TARGET_REMOVED', 'target is unavailable');
    if (!RENAMABLE_ID_TYPES.has(target.type)) {
      return failure('argument', 'ID_RENAME_NOT_SUPPORTED',
        `renameBlockId is only supported on heading and table nodes, found ${target.type}`);
    }
    const oldId = typeof target.attrs?.id === 'string' && target.attrs.id ? target.attrs.id : undefined;
    if (!oldId) {
      return failure('argument', 'ID_RENAME_REQUIRES_EXISTING_ID',
        'renameBlockId requires a target with an existing persistent id');
    }
    const newId = op.newId;
    if (!newId || unicodeCodePointLength(newId) > 128) {
      return failure('argument', 'INVALID_NEW_ID', 'newId must be a non-empty string of at most 128 characters');
    }
    if (/^provisional:/.test(newId)) {
      return failure('argument', 'INVALID_NEW_ID', 'newId must not use the reserved provisional: prefix');
    }
    if (oldId === newId) return operationEvent(op, oldId, newId);
    for (const { node } of walkDocument(root)) {
      if (node !== target && typeof node.attrs?.id === 'string' && node.attrs.id === newId) {
        return failure('document', 'DUPLICATE_ID', `duplicate id: ${newId}`);
      }
    }
    for (const { node } of walkDocument(root)) {
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link' && typeof mark.attrs?.href === 'string'
          && mark.attrs.href === `#${oldId}`) {
          mark.attrs.href = `#${newId}`;
        }
      }
    }
    target.attrs = { ...target.attrs, id: newId };
    return operationEvent(op, oldId, newId);
  }
  return failure('argument', 'UNSUPPORTED_OPERATION', 'operation is unsupported');
}

export function inspectDocumentBytes(
  bytes: Uint8Array | string, options: InspectOptions = {},
): InspectDocumentResult {
  if (options.target !== undefined && options.targetPath !== undefined) {
    return failure('argument', 'INVALID_INSPECT_OPTIONS',
      'target and targetPath are mutually exclusive');
  }
  if (options.targetPath !== undefined
    && (!Array.isArray(options.targetPath)
      || !options.targetPath.every((item) => Number.isInteger(item) && item >= 0))) {
    return failure('argument', 'INVALID_TARGET_PATH',
      'targetPath must contain only non-negative integer indexes');
  }
  const loaded = load(bytes);
  if (isFailure(loaded)) return loaded;
  const state = analyze(loaded.envelope.doc);
  if (state.duplicates.length) {
    return failure('document', 'DUPLICATE_ID', `duplicate id: ${state.duplicates[0]}`);
  }
  const maxBlocks = Math.min(Math.max(options.maxBlocks ?? 1_000, 1), 10_000);
  const maxSummary = Math.min(Math.max(options.maxSummaryLength ?? 120, 20), 500);
  const outline: Extract<InspectDocumentResult, { ok: true }>['outline'] = [];
  const references: Extract<InspectDocumentResult, { ok: true }>['references'] = [];
  const referenceables: Extract<InspectDocumentResult, { ok: true }>['referenceables'] = [];
  const blocks: Extract<InspectDocumentResult, { ok: true }>['blocks'] = [];
  let blockCount = 0;
  const ids = new Set<string>();
  for (const { node } of walkDocument(loaded.envelope.doc)) {
    const id = node.attrs?.id;
    if (typeof id === 'string' && id) ids.add(id);
  }
  for (const { node, path } of walkDocument(loaded.envelope.doc)) {
    const id = typeof node.attrs?.id === 'string' && node.attrs.id ? node.attrs.id : undefined;
    const provisional = !id && REFERENCEABLE.has(node.type)
      ? provisionalId(loaded.revision, path, node) : undefined;
    if (node.type === 'heading' && outline.length < maxBlocks) outline.push({
      ...(id ? { id } : {}), ...(provisional ? { provisionalId: provisional } : {}),
      level: Number(node.attrs?.level), text: textOf(node).slice(0, maxSummary), path: [...path],
    });
    if (REFERENCEABLE.has(node.type) && referenceables.length < maxBlocks) referenceables.push({
      type: node.type, ...(id ? { id } : {}),
      ...(provisional ? { provisionalId: provisional } : {}), path: [...path],
    });
    for (const mark of node.marks ?? []) {
      const href = mark.type === 'link' ? mark.attrs?.href : undefined;
      if (typeof href === 'string' && href.startsWith('#') && references.length < maxBlocks) {
        references.push({ href, targetExists: ids.has(href.slice(1)), path: [...path] });
      }
    }
    if (!NON_BLOCK.has(node.type)) {
      blockCount += 1;
      if (blocks.length < maxBlocks) {
        blocks.push({
          type: node.type,
          path: [...path],
          summary: summary(node, maxSummary),
          operationTarget: operationTargetFor(loaded.revision, path, node),
          ...(id ? { id } : {}),
          ...(provisional ? { provisionalId: provisional } : {}),
          ...(!id ? { digest: nodeDigest(node) } : {}),
        });
      }
    }
  }
  let selected: Extract<InspectDocumentResult, { ok: true }>['target'];
  if (options.target || options.targetPath) {
    const index = indexTargets(loaded.envelope.doc, loaded.revision);
    const node = options.target
      ? resolveTarget(loaded.envelope.doc, options.target, index)
      : nodeAt(loaded.envelope.doc, options.targetPath ?? [])
        ?? failure('conflict', 'TARGET_NOT_FOUND',
          `target path ${pathKey(options.targetPath ?? [])} was not found`);
    if ('ok' in node) return node;
    if (options.targetPath !== undefined && NON_BLOCK.has(node.type)) {
      return failure('argument', 'TARGET_NOT_BLOCK',
        `target path ${pathKey(index.paths.get(node) ?? options.targetPath ?? [])} does not select a block`);
    }
    if (encodeUtf8(JSON.stringify(node)).byteLength > MAX_TARGET_DETAIL_BYTES) {
      return failure('argument', 'TARGET_DETAIL_TOO_LARGE', 'target detail exceeds 256 KiB');
    }
    const path = index.paths.get(node) ?? [];
    selected = {
      path,
      node: clone(node),
      digest: nodeDigest(node),
      operationTarget: operationTargetFor(loaded.revision, path, node),
    };
  }
  const metadata = {
    ...(typeof loaded.envelope.meta.title === 'string'
      ? { title: loaded.envelope.meta.title } : {}),
    ...(typeof loaded.envelope.meta.author === 'string'
      ? { author: loaded.envelope.meta.author } : {}),
    ...(typeof loaded.envelope.meta.version === 'string'
      ? { version: loaded.envelope.meta.version } : {}),
    ...(typeof loaded.envelope.meta.created === 'string'
      ? { created: loaded.envelope.meta.created } : {}),
    ...(typeof loaded.envelope.meta.modified === 'string'
      ? { modified: loaded.envelope.meta.modified } : {}),
    ...(loaded.envelope.meta.settings
      ? { settings: clone(loaded.envelope.meta.settings) } : {}),
  };
  return {
    ok: true, revision: loaded.revision, legacy: loaded.legacy,
    needsIdNormalization: state.missingIds, documentId: documentId(loaded.envelope),
    metadata,
    outline,
    references,
    referenceables,
    blocks,
    blockCount,
    blocksTruncated: blocks.length < blockCount,
    ...(selected ? { target: selected } : {}),
    warnings: state.warnings,
  };
}

export function validateDocumentBytes(bytes: Uint8Array | string): ValidateDocumentResult {
  const loaded = load(bytes);
  if (isFailure(loaded)) return loaded;
  const state = analyze(loaded.envelope.doc);
  if (state.duplicates.length) {
    return failure('document', 'DUPLICATE_ID', `duplicate id: ${state.duplicates[0]}`);
  }
  return {
    ok: true, revision: loaded.revision, legacy: loaded.legacy,
    needsIdNormalization: state.missingIds, warnings: state.warnings,
  };
}

export function applyOperationRequest(
  bytes: Uint8Array | string, requestUnknown: unknown, options: ApplyOptions = {},
): ApplyOperationResult {
  const request = narrowRequest(requestUnknown);
  if (isFailure(request)) return request;
  const loaded = load(bytes);
  if (isFailure(loaded)) return loaded;
  if (request.expected.revision !== loaded.revision) {
    return failure('conflict', 'STALE_REVISION', 'expected revision does not match document bytes');
  }
  if (request.expected.documentId !== undefined
    && options.currentDocumentId === undefined) {
    return failure('argument', 'DOCUMENT_ID_UNVERIFIABLE',
      'expected document id requires currentDocumentId from the caller');
  }
  if (request.expected.documentId !== undefined
    && request.expected.documentId !== options.currentDocumentId) {
    return failure('conflict', 'DOCUMENT_ID_MISMATCH', 'expected document id does not match');
  }
  if (loaded.legacy && !options.upgradeLegacy) {
    return failure('document', 'LEGACY_UPGRADE_REQUIRED', 'legacy writes require upgradeLegacy');
  }
  const baseline = analyze(loaded.envelope.doc);
  const originalSettings = resolveSettings(loaded.envelope.meta.settings, options.externalSettings);
  const originalNumbering = numberingById(loaded.envelope.doc, originalSettings);
  if (baseline.duplicates.length) {
    return failure('document', 'DUPLICATE_ID', `duplicate id: ${baseline.duplicates[0]}`);
  }
  const envelope = clone(loaded.envelope);
  const clockValue = options.clock?.() ?? new Date().toISOString();
  const clockIso = clockValue instanceof Date ? clockValue.toISOString() : clockValue;
  if (loaded.legacy) {
    envelope.meta.created = clockIso;
    envelope.meta.modified = clockIso;
  }
  const semanticBefore = clone(envelope);
  delete semanticBefore.meta.modified;
  const index = indexTargets(envelope.doc, loaded.revision);
  const targets = new Map<NodeTarget, TiptapNode>();
  for (const op of request.operations) {
    const requestedTargets: NodeTarget[] = [];
    if ('target' in op) requestedTargets.push(op.target);
    if (op.op === 'setDocumentTitle' && op.headingTarget) {
      requestedTargets.push(op.headingTarget);
    }
    if ('destination' in op) requestedTargets.push(op.destination.target);
    for (const target of requestedTargets) {
      const resolved = resolveTarget(envelope.doc, target, index);
      if ('ok' in resolved) return resolved;
      targets.set(target, resolved);
    }
  }
  const diff: SemanticDiffEvent[] = [];
  for (const [operationIndex, op] of request.operations.entries()) {
    const event = applyOne(envelope, op, targets);
    if ('ok' in event) {
      event.diagnostics.forEach((item) => { item.operationIndex = operationIndex; });
      return event;
    }
    diff.push(event);
  }
  const outputLimits = checkLimits(envelope.doc);
  if (outputLimits) {
    return {
      ...outputLimits,
      category: 'argument',
      diagnostics: outputLimits.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        code: diagnostic.code === 'TREE_TOO_DEEP'
          ? 'OPERATION_TREE_TOO_DEEP'
          : 'TOO_MANY_OPERATION_NODES',
      })),
    };
  }
  const rawState = analyze(envelope.doc);
  if (rawState.duplicates.length) {
    return failure('document', 'DUPLICATE_ID', `duplicate id: ${rawState.duplicates[0]}`);
  }
  const settings = resolveSettings(envelope.meta.settings, options.externalSettings);
  const referenceTextsBefore = internalReferenceTexts(envelope.doc);
  const normalized = normalizeDocument(envelope.doc, {
    captionStyle: settings.captionStyle,
    captionNumbering: settings.captionNumbering,
    equationNumbering: settings.equationNumbering,
    crossRefIncludeCaption: settings.crossRefIncludeCaption,
    headingNumbering: settings.headingNumbering,
    headingStartNumber: settings.headingStartNumber,
  });
  const beforeIds = new Set<string>();
  for (const { node } of walkDocument(envelope.doc)) {
    const id = node.attrs?.id;
    if (typeof id === 'string' && id) beforeIds.add(id);
  }
  for (const { node } of walkDocument(normalized)) {
    const id = node.attrs?.id;
    if (typeof id === 'string' && id && !beforeIds.has(id)) {
      diff.push({ kind: 'id-assigned', after: `${node.type}#${id}` });
    }
  }
  envelope.doc = normalized;
  const referenceTextsAfter = internalReferenceTexts(envelope.doc);
  for (const [path, afterText] of referenceTextsAfter) {
    const beforeText = referenceTextsBefore.get(path);
    if (beforeText !== undefined && beforeText !== afterText) {
      diff.push({ kind: 'reference-label-updated', before: beforeText.slice(0, 120), after: afterText.slice(0, 120) });
    }
  }
  const finalNumbering = numberingById(envelope.doc, settings);
  const numberChanges = Array.from(finalNumbering).filter(
    ([id, number]) => originalNumbering.has(id) && originalNumbering.get(id) !== number,
  );
  if (numberChanges.length) {
    const [id, number] = numberChanges[0];
    diff.push({
      kind: 'numbering-updated',
      before: `${id}=${originalNumbering.get(id)}`,
      after: `${id}=${number}`,
      indirectChanges: numberChanges.length,
    });
  }
  const after = analyze(envelope.doc);
  const introduced = Array.from(after.violations).filter(
    ([item, count]) => count > (baseline.violations.get(item) ?? 0),
  );
  if (introduced.length) {
    const entry = introduced[0][0];
    return failure('document', entry.startsWith('asset:') ? 'NEW_NONPORTABLE_ASSET'
      : entry.startsWith('dangling:') ? 'NEW_DANGLING_REFERENCE' : 'NEW_UNSAFE_LINK',
    'operation introduces or increases an integrity violation');
  }
  if (after.duplicates.length) {
    return failure('document', 'DUPLICATE_ID', `duplicate id: ${after.duplicates[0]}`);
  }
  const semanticAfter = clone(envelope);
  delete semanticAfter.meta.modified;
  const changed = loaded.legacy
    || JSON.stringify(semanticBefore) !== JSON.stringify(semanticAfter);
  if (changed) {
    envelope.meta.modified = clockIso;
    diff.push({ kind: 'metadata-updated', after: `modified=${envelope.meta.modified}` });
  }
  try {
    assertPersistedDocument(envelope);
  } catch (error) {
    return failure('document', 'OUTPUT_SCHEMA_INVALID',
      error instanceof Error ? error.message : 'output violates sdoc.schema.json');
  }
  const outputText = changed ? JSON.stringify(envelope, null, 2) : loaded.text;
  const boundedDiff = changed ? diff.slice(0, 500) : [];
  if (changed && diff.length > boundedDiff.length && boundedDiff.length) {
    const last = boundedDiff[boundedDiff.length - 1];
    last.indirectChanges = (last.indirectChanges ?? 0) + diff.length - boundedDiff.length;
  }
  return {
    ok: true, revision: loaded.revision,
    outputRevision: changed ? computeRevision(outputText) : loaded.revision,
    changed, legacy: loaded.legacy, envelope, outputText, diff: boundedDiff,
    normalizationPolicy: {
      captionStyle: settings.captionStyle,
      captionNumbering: settings.captionNumbering,
      equationNumbering: settings.equationNumbering,
      crossRefIncludeCaption: settings.crossRefIncludeCaption,
      headingNumbering: settings.headingNumbering,
      headingStartNumber: settings.headingStartNumber,
    },
    warnings: baseline.warnings,
  };
}
