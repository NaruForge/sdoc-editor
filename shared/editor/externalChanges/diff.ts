import type { TiptapNode } from '../../types';
import type {
  ExternalBlockChangeKind,
  ExternalBlockDiff,
  ExternalBlockSnapshot,
  ExternalDocumentDiff,
  ExternalDocumentDiffSummary,
} from './types';

interface IndexedBlock {
  readonly node: TiptapNode;
  readonly index: number;
  readonly typeOrdinal: number;
  readonly id?: string;
  readonly serialized: string;
}

interface MatchedBlock {
  readonly mine: IndexedBlock;
  readonly external: IndexedBlock;
  readonly strategy: ExternalBlockSnapshot['identityStrategy'];
}

const normalizedJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizedJsonValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entryValue]) => [key, normalizedJsonValue(entryValue)]),
    );
  }
  return value;
};

const serializeNode = (node: TiptapNode): string => JSON.stringify(normalizedJsonValue(node));

const persistentId = (node: TiptapNode): string | undefined => {
  const value = node.attrs?.id;
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const collectText = (node: TiptapNode): string => {
  const parts: string[] = [];
  const visit = (current: TiptapNode): void => {
    if (typeof current.text === 'string') parts.push(current.text);
    current.content?.forEach(visit);
  };
  visit(node);
  return parts.join('');
};

const attrPreview = (node: TiptapNode): string => {
  const candidates = ['caption', 'latex', 'code', 'src', 'language'];
  return candidates
    .flatMap((name) => {
      const value = node.attrs?.[name];
      return typeof value === 'string' && value.length > 0 ? [`${name}: ${value}`] : [];
    })
    .join(' · ');
};

const blockPreview = (block: IndexedBlock): string => {
  const text = collectText(block.node).trim();
  if (text.length > 0) return text;
  const attrs = attrPreview(block.node);
  if (attrs.length > 0) return attrs;
  return block.node.type;
};

const blockLabel = (block: IndexedBlock): string => {
  const headingLevel = block.node.type === 'heading' ? block.node.attrs?.level : undefined;
  const typeLabel = typeof headingLevel === 'number' ? `Heading ${headingLevel}` : block.node.type;
  return block.id ? `${typeLabel} · ${block.id}` : `${typeLabel} · block ${block.index + 1}`;
};

const indexBlocks = (document: TiptapNode): IndexedBlock[] => {
  const ordinals = new Map<string, number>();
  return (document.content ?? []).map((node, index) => {
    const typeOrdinal = ordinals.get(node.type) ?? 0;
    ordinals.set(node.type, typeOrdinal + 1);
    return {
      node,
      index,
      typeOrdinal,
      id: persistentId(node),
      serialized: serializeNode(node),
    };
  });
};

const snapshot = (
  block: IndexedBlock,
  strategy: ExternalBlockSnapshot['identityStrategy'],
  key: string,
): ExternalBlockSnapshot =>
  Object.freeze({
    key,
    identityStrategy: strategy,
    index: block.index,
    path: Object.freeze([block.index]),
    type: block.node.type,
    ...(block.id ? { id: block.id } : {}),
    label: blockLabel(block),
    preview: blockPreview(block),
    serialized: block.serialized,
  });

const makePairKey = (pair: MatchedBlock, fallbackSequence: number): string =>
  pair.strategy === 'persistent-id'
    ? `id:${pair.mine.id}`
    : `fallback:${pair.mine.node.type}:${pair.mine.typeOrdinal}:${fallbackSequence}`;

const takeFirst = (
  candidates: readonly IndexedBlock[],
  predicate: (block: IndexedBlock) => boolean,
  claimed: Set<number>,
): IndexedBlock | undefined => {
  const match = candidates.find((block) => !claimed.has(block.index) && predicate(block));
  if (match) claimed.add(match.index);
  return match;
};

const matchBlocks = (
  mine: readonly IndexedBlock[],
  external: readonly IndexedBlock[],
): {
  readonly pairs: readonly MatchedBlock[];
  readonly unmatchedMine: readonly IndexedBlock[];
  readonly unmatchedExternal: readonly IndexedBlock[];
} => {
  const claimedMine = new Set<number>();
  const claimedExternal = new Set<number>();
  const pairs: MatchedBlock[] = [];

  // IDs are the durable identity when they occur on both sides.
  mine.forEach((mineBlock) => {
    if (!mineBlock.id) return;
    const externalBlock = takeFirst(external, (candidate) => candidate.id === mineBlock.id, claimedExternal);
    if (!externalBlock) return;
    claimedMine.add(mineBlock.index);
    pairs.push({ mine: mineBlock, external: externalBlock, strategy: 'persistent-id' });
  });

  // Preserve exact id-less/unpaired blocks before type-order fallback. This
  // prevents an insertion from making every following block look changed.
  mine.forEach((mineBlock) => {
    if (claimedMine.has(mineBlock.index) || mineBlock.id) return;
    const externalBlock = takeFirst(
      external,
      (candidate) =>
        !candidate.id && candidate.node.type === mineBlock.node.type && candidate.serialized === mineBlock.serialized,
      claimedExternal,
    );
    if (!externalBlock) return;
    claimedMine.add(mineBlock.index);
    pairs.push({ mine: mineBlock, external: externalBlock, strategy: 'fallback' });
  });

  // Remaining nodes are aligned by top-level type and occurrence order. Their
  // paths are retained in snapshots so movement remains explicit.
  mine.forEach((mineBlock) => {
    if (claimedMine.has(mineBlock.index) || mineBlock.id) return;
    const externalBlock = takeFirst(
      external,
      (candidate) => !candidate.id && candidate.node.type === mineBlock.node.type,
      claimedExternal,
    );
    if (!externalBlock) return;
    claimedMine.add(mineBlock.index);
    pairs.push({ mine: mineBlock, external: externalBlock, strategy: 'fallback' });
  });

  return {
    pairs,
    unmatchedMine: mine.filter((block) => !claimedMine.has(block.index)),
    unmatchedExternal: external.filter((block) => !claimedExternal.has(block.index)),
  };
};

const changeKinds = (pair: MatchedBlock, movedPairs: ReadonlySet<MatchedBlock>): ExternalBlockChangeKind[] => {
  const kinds: ExternalBlockChangeKind[] = [];
  if (pair.mine.serialized !== pair.external.serialized) kinds.push('changed');
  if (movedPairs.has(pair)) kinds.push('moved');
  return kinds;
};

const findMovedPairs = (pairs: readonly MatchedBlock[]): ReadonlySet<MatchedBlock> => {
  const mineOrder = [...pairs].sort((left, right) => left.mine.index - right.mine.index);
  const externalOrder = [...pairs].sort((left, right) => left.external.index - right.external.index);
  const externalRanks = new Map(externalOrder.map((pair, rank) => [pair, rank] as const));
  return new Set(mineOrder.filter((pair, rank) => externalRanks.get(pair) !== rank));
};

const countSummary = (blocks: readonly ExternalBlockDiff[]): ExternalDocumentDiffSummary =>
  Object.freeze({
    added: blocks.filter((block) => block.kinds.includes('added')).length,
    removed: blocks.filter((block) => block.kinds.includes('removed')).length,
    changed: blocks.filter((block) => block.kinds.includes('changed')).length,
    moved: blocks.filter((block) => block.kinds.includes('moved')).length,
  });

/**
 * Compares top-level Tiptap blocks without host APIs or editor state.
 *
 * Persistent `attrs.id` values win. Blocks that cannot be paired by ID use an
 * exact-content pass followed by stable type/occurrence ordering.
 */
export const buildExternalDocumentDiff = (
  mineDocument: TiptapNode,
  externalDocument: TiptapNode,
): ExternalDocumentDiff => {
  const mine = indexBlocks(mineDocument);
  const external = indexBlocks(externalDocument);
  const { pairs, unmatchedMine, unmatchedExternal } = matchBlocks(mine, external);
  const movedPairs = findMovedPairs(pairs);
  let fallbackSequence = 0;

  const pairedDiffs = pairs.flatMap((pair): ExternalBlockDiff[] => {
    const kinds = changeKinds(pair, movedPairs);
    if (kinds.length === 0) return [];
    const key = makePairKey(pair, fallbackSequence++);
    return [
      Object.freeze({
        key,
        kinds: Object.freeze(kinds),
        mine: snapshot(pair.mine, pair.strategy, key),
        external: snapshot(pair.external, pair.strategy, key),
      }),
    ];
  });

  const removed = unmatchedMine.map((block): ExternalBlockDiff => {
    const key = block.id ? `removed:id:${block.id}` : `removed:fallback:${block.node.type}:${block.typeOrdinal}`;
    return Object.freeze({
      key,
      kinds: Object.freeze(['removed'] as ExternalBlockChangeKind[]),
      mine: snapshot(block, block.id ? 'persistent-id' : 'fallback', key),
    });
  });

  const added = unmatchedExternal.map((block): ExternalBlockDiff => {
    const key = block.id ? `added:id:${block.id}` : `added:fallback:${block.node.type}:${block.typeOrdinal}`;
    return Object.freeze({
      key,
      kinds: Object.freeze(['added'] as ExternalBlockChangeKind[]),
      external: snapshot(block, block.id ? 'persistent-id' : 'fallback', key),
    });
  });

  const blocks = Object.freeze(
    [...pairedDiffs, ...removed, ...added].sort((left, right) => {
      const leftIndex = Math.min(
        left.mine?.index ?? Number.MAX_SAFE_INTEGER,
        left.external?.index ?? Number.MAX_SAFE_INTEGER,
      );
      const rightIndex = Math.min(
        right.mine?.index ?? Number.MAX_SAFE_INTEGER,
        right.external?.index ?? Number.MAX_SAFE_INTEGER,
      );
      const leftAdded = left.kinds.includes('added') ? 1 : 0;
      const rightAdded = right.kinds.includes('added') ? 1 : 0;
      return leftIndex - rightIndex || leftAdded - rightAdded || left.key.localeCompare(right.key, 'en');
    }),
  );
  const summary = countSummary(blocks);

  return Object.freeze({
    hasChanges: blocks.length > 0,
    blocks,
    summary,
  });
};
