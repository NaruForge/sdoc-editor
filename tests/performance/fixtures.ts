import { MAX_DOCUMENT_BYTES } from '../../shared/resourceLimits';
import type { SdocEnvelope, TiptapNode } from '../../shared/types';

export const PERFORMANCE_FIXTURE_SEED = 0x2160_2026;
export const PERFORMANCE_DOCUMENT_NODE_LIMIT = 100_000;

export type AcceptedPerformanceCorpusName =
  | 'text-5k'
  | 'text-10k'
  | 'text-25k'
  | 'structure-10k'
  | 'rich-2k'
  | 'rich-mixed-5k'
  | 'rich-balanced-5k';

export interface AcceptedPerformanceCorpus {
  name: AcceptedPerformanceCorpusName;
  axis: 'text' | 'structure' | 'rich';
  seed: number;
  topLevelBlocks: number;
  nodeCount: number;
  byteLength: number;
  envelope: SdocEnvelope;
  text: string;
}

export type RejectedPerformanceCorpus =
  | { name: 'malformed-schema'; value: unknown; expectedKind: 'malformed' }
  | { name: 'too-many-nodes'; value: unknown; expectedKind: 'malformed' }
  | { name: 'too-large-bytes'; text: string; expectedKind: 'too-large' };

const corpusDefinitions: ReadonlyArray<{
  name: AcceptedPerformanceCorpusName;
  axis: AcceptedPerformanceCorpus['axis'];
  topLevelBlocks: number;
  seedOffset: number;
}> = [
  { name: 'text-5k', axis: 'text', topLevelBlocks: 5_000, seedOffset: 5 },
  { name: 'text-10k', axis: 'text', topLevelBlocks: 10_000, seedOffset: 10 },
  { name: 'text-25k', axis: 'text', topLevelBlocks: 25_000, seedOffset: 25 },
  { name: 'structure-10k', axis: 'structure', topLevelBlocks: 10_000, seedOffset: 110 },
  { name: 'rich-2k', axis: 'rich', topLevelBlocks: 2_000, seedOffset: 202 },
  { name: 'rich-mixed-5k', axis: 'rich', topLevelBlocks: 5_000, seedOffset: 216 },
  { name: 'rich-balanced-5k', axis: 'rich', topLevelBlocks: 5_000, seedOffset: 217 },
];

const words = [
  'editor', 'document', 'section', 'paragraph', 'revision', 'snapshot',
  'validation', 'structure', 'rendering', 'performance', 'reference', 'content',
] as const;

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
};

const seededText = (next: () => number, index: number, wordCount = 8): string => {
  const selected: string[] = [];
  for (let wordIndex = 0; wordIndex < wordCount; wordIndex += 1) {
    selected.push(words[next() % words.length]);
  }
  return `${index.toString(36)} ${selected.join(' ')}`;
};

const paragraph = (text: string): TiptapNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const listBlock = (next: () => number, index: number): TiptapNode => ({
  type: 'bulletList',
  content: [
    { type: 'listItem', content: [paragraph(seededText(next, index, 5))] },
    { type: 'listItem', content: [paragraph(seededText(next, index + 1, 5))] },
  ],
});

const createTextBlocks = (count: number, next: () => number): TiptapNode[] =>
  Array.from({ length: count }, (_, index) => paragraph(seededText(next, index)));

const createStructureBlocks = (count: number, next: () => number): TiptapNode[] =>
  Array.from({ length: count }, (_, index) => {
    if (index === 0) return paragraph(seededText(next, index));
    if (index % 71 === 0) return listBlock(next, index);
    if (index % 53 === 0) {
      return { type: 'blockquote', content: [paragraph(seededText(next, index, 6))] };
    }
    if (index % 37 === 0) {
      return {
        type: 'codeBlock',
        attrs: { language: 'typescript', id: `code-${index}` },
        content: [{ type: 'text', text: `const value${index} = ${next() % 10_000};` }],
      };
    }
    if (index % 10 === 0) {
      return {
        type: 'heading',
        attrs: { level: index % 6 + 1, id: `heading-${index}` },
        content: [{ type: 'text', text: seededText(next, index, 4) }],
      };
    }
    return paragraph(seededText(next, index));
  });

const table = (next: () => number, index: number): TiptapNode => ({
  type: 'table',
  attrs: { id: `table-${index}`, caption: `Table ${index}`, align: 'center', width: '100%' },
  content: Array.from({ length: 2 }, (_, row) => ({
    type: 'tableRow',
    content: Array.from({ length: 2 }, (_, column) => ({
      type: row === 0 ? 'tableHeader' : 'tableCell',
      content: [paragraph(seededText(next, index + row + column, 3))],
    })),
  })),
});

const createRichBlock = (next: () => number, index: number): TiptapNode => {
  switch (index % 10) {
      case 0:
        return {
          type: 'heading',
          attrs: { level: index % 6 + 1, id: `rich-heading-${index}` },
          content: [{ type: 'text', text: seededText(next, index, 4) }],
        };
      case 1:
        return {
          type: 'paragraph',
          content: [
            { type: 'text', text: seededText(next, index, 3) },
            { type: 'mathInline', attrs: { latex: `x_${index} + y_${next() % 97}` } },
          ],
        };
      case 2:
        return {
          type: 'image',
          attrs: {
            id: `image-${index}`,
            src: './performance-image.svg',
            alt: `Performance fixture ${index}`,
            caption: seededText(next, index, 4),
            align: 'center',
          },
        };
      case 3:
        return {
          type: 'mathBlock',
          attrs: { id: `equation-${index}`, latex: `E_${index} = m c^2` },
        };
      case 4:
        return {
          type: 'codeBlock',
          attrs: { language: 'typescript', id: `rich-code-${index}` },
          content: [{ type: 'text', text: `export const sample${index} = ${next() % 10_000};` }],
        };
      case 5:
        return {
          type: 'diagram',
          attrs: {
            id: `diagram-${index}`,
            language: 'mermaid',
            code: `flowchart LR\n  n${index}[Start] --> n${index + 1}[End]`,
          },
        };
      case 6:
        return table(next, index);
      case 7:
        return {
          type: 'callout',
          attrs: { id: `callout-${index}`, variant: 'info' },
          content: [paragraph(seededText(next, index, 7))],
        };
      case 8:
        return {
          type: 'paragraph',
          content: [
            { type: 'text', text: seededText(next, index, 4) },
            {
              type: 'endnote',
              attrs: { id: `endnote-${index}`, body: `Generated note ${index}` },
            },
          ],
        };
      default:
        return {
          type: 'blockquote',
          attrs: { id: `quote-${index}` },
          content: [paragraph(seededText(next, index, 6))],
        };
  }
};

const createRichBlocks = (count: number, next: () => number): TiptapNode[] =>
  Array.from({ length: count }, (_, index) => createRichBlock(next, index));

const createMixedRichBlock = (next: () => number, index: number): TiptapNode => {
  const slot = index % 100;
  if (slot < 60) return paragraph(seededText(next, index));
  if (slot < 66) {
    return {
      type: 'paragraph',
      content: [
        { type: 'text', text: seededText(next, index, 3) },
        { type: 'mathInline', attrs: { latex: `x_${index} + y_${next() % 97}` } },
      ],
    };
  }
  if (slot < 70) {
    return {
      type: 'paragraph',
      content: [
        { type: 'text', text: seededText(next, index, 4) },
        { type: 'endnote', attrs: { id: `mixed-endnote-${index}`, body: `Generated note ${index}` } },
      ],
    };
  }
  if (slot < 80) {
    return {
      type: 'heading',
      attrs: { level: index % 6 + 1, id: `mixed-heading-${index}` },
      content: [{ type: 'text', text: seededText(next, index, 4) }],
    };
  }
  if (slot < 85) {
    const language = index === 80
      ? 'null'
      : index === 81
        ? 'custom:언어'
        : index === 82
          ? ''
          : 'typescript';
    return {
      type: 'codeBlock',
      attrs: { language, id: `mixed-code-${index}` },
      content: [{ type: 'text', text: `export const mixed${index} = ${next() % 10_000};` }],
    };
  }
  if (slot < 89) {
    return {
      type: 'mathBlock',
      attrs: { id: `mixed-equation-${index}`, latex: `E_${index} = m c^2` },
    };
  }
  if (slot < 92) {
    return {
      type: 'image',
      attrs: {
        id: `mixed-image-${index}`,
        src: './performance-image.svg',
        alt: `Performance fixture ${index}`,
        caption: seededText(next, index, 4),
        align: 'center',
      },
    };
  }
  if (slot < 94) return table(next, index);
  if (slot < 96) {
    return {
      type: 'diagram',
      attrs: {
        id: `mixed-diagram-${index}`,
        language: 'mermaid',
        code: `flowchart LR\n  n${index}[Start] --> n${index + 1}[End]`,
      },
    };
  }
  if (slot < 99) {
    return {
      type: 'callout',
      attrs: { id: `mixed-callout-${index}`, variant: 'info' },
      content: [paragraph(seededText(next, index, 7))],
    };
  }
  return {
    type: 'blockquote',
    attrs: { id: `mixed-quote-${index}` },
    content: [paragraph(seededText(next, index, 6))],
  };
};

const createMixedRichBlocks = (count: number, next: () => number): TiptapNode[] =>
  Array.from({ length: count }, (_, index) => createMixedRichBlock(next, index));

export const countTiptapNodes = (root: TiptapNode): number => {
  let count = 0;
  const stack: TiptapNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    count += 1;
    if (current.content) stack.push(...current.content);
  }
  return count;
};

export function createAcceptedPerformanceCorpus(
  name: AcceptedPerformanceCorpusName,
): AcceptedPerformanceCorpus {
  const definition = corpusDefinitions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`unknown performance corpus: ${name}`);
  const seed = (PERFORMANCE_FIXTURE_SEED + definition.seedOffset) >>> 0;
  const next = createRandom(seed);
  const content = definition.axis === 'text'
    ? createTextBlocks(definition.topLevelBlocks, next)
    : definition.axis === 'structure'
      ? createStructureBlocks(definition.topLevelBlocks, next)
      : definition.name === 'rich-mixed-5k'
        ? createMixedRichBlocks(definition.topLevelBlocks, next)
        : createRichBlocks(definition.topLevelBlocks, next);
  const envelope: SdocEnvelope = {
    sdoc: '1.0',
    meta: {
      title: `Performance ${name}`,
      author: 'deterministic-fixture',
      version: '1.0',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
    },
    doc: { type: 'doc', content },
  };
  const text = JSON.stringify(envelope);
  return {
    name,
    axis: definition.axis,
    seed,
    topLevelBlocks: definition.topLevelBlocks,
    nodeCount: countTiptapNodes(envelope.doc),
    byteLength: new TextEncoder().encode(text).byteLength,
    envelope,
    text,
  };
}

export const acceptedPerformanceCorpusNames = (): readonly AcceptedPerformanceCorpusName[] =>
  corpusDefinitions.map(({ name }) => name);

/** Rejection inputs stay opt-in so normal baselines never mix valid work with guardrail cost. */
export function createRejectedPerformanceCorpus(
  name: RejectedPerformanceCorpus['name'],
): RejectedPerformanceCorpus {
  if (name === 'malformed-schema') {
    return {
      name,
      value: { sdoc: '1.0', meta: {}, doc: { type: 'doc', content: [{ type: 'unknown' }] } },
      expectedKind: 'malformed',
    };
  }
  if (name === 'too-many-nodes') {
    return {
      name,
      value: {
        sdoc: '1.0',
        meta: {},
        doc: {
          type: 'doc',
          content: Array.from(
            { length: PERFORMANCE_DOCUMENT_NODE_LIMIT },
            (): TiptapNode => ({ type: 'paragraph' }),
          ),
        },
      },
      expectedKind: 'malformed',
    };
  }
  const envelopePrefix = '{"sdoc":"1.0","meta":{},"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"';
  const envelopeSuffix = '"}]}]}}';
  return {
    name,
    text: `${envelopePrefix}${'x'.repeat(MAX_DOCUMENT_BYTES)}${envelopeSuffix}`,
    expectedKind: 'too-large',
  };
}
