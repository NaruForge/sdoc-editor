import type { TiptapNode } from '../types';
import { unicodeCodePointLength } from './title';

export const MAX_AUTHORED_PERSISTENT_ID_LENGTH = 128;
export const PROVISIONAL_ID_PREFIX = 'provisional:';

export const REFERENCEABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'heading', 'image', 'table', 'mathBlock',
]);

export const OPTIONAL_IDENTITY_NODE_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'codeBlock',
  'blockquote',
  'callout',
  'diagram',
]);

export const IDENTITY_BEARING_NODE_TYPES: ReadonlySet<string> = new Set([
  ...REFERENCEABLE_NODE_TYPES,
  ...OPTIONAL_IDENTITY_NODE_TYPES,
]);

// v1.0 historically persisted horizontalRule.attrs.id. It reserves its value
// for duplicate detection, but is neither an operation identity nor an anchor.
export const ID_COLLISION_NODE_TYPES: ReadonlySet<string> = new Set([
  ...IDENTITY_BEARING_NODE_TYPES,
  'horizontalRule',
]);

export function persistedIdFor(node: TiptapNode): string | undefined {
  const id = node.attrs?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function isAuthorablePersistentId(value: string): boolean {
  return value.length > 0
    && unicodeCodePointLength(value) <= MAX_AUTHORED_PERSISTENT_ID_LENGTH
    && !value.startsWith(PROVISIONAL_ID_PREFIX);
}

export function truncatePersistentId(value: string, maximum = MAX_AUTHORED_PERSISTENT_ID_LENGTH): string {
  return Array.from(value).slice(0, maximum).join('');
}
