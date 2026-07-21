import type { TiptapNode } from '../types';

export interface DocumentNodeVisit {
  node: TiptapNode;
  path: readonly number[];
  parent?: TiptapNode;
}

/** Pre-order, document-order traversal of every node, including nested containers. */
export function* walkDocument(
  node: TiptapNode,
  path: readonly number[] = [],
  parent?: TiptapNode,
): Generator<DocumentNodeVisit> {
  yield { node, path, parent };
  for (const [index, child] of (node.content ?? []).entries()) {
    yield* walkDocument(child, [...path, index], node);
  }
}

/** Immutable pre-order transform that preserves document order. */
export function mapDocument(
  node: TiptapNode,
  mapper: (node: TiptapNode, path: readonly number[]) => TiptapNode,
  path: readonly number[] = [],
): TiptapNode {
  const mapped = mapper(node, path);
  return mapped.content
    ? { ...mapped, content: mapped.content.map((child, index) => mapDocument(child, mapper, [...path, index])) }
    : mapped;
}
