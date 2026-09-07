import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep, AddNodeMarkStep, AttrStep, DocAttrStep, RemoveMarkStep, RemoveNodeMarkStep,
  ReplaceAroundStep, ReplaceStep,
} from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import highlight from 'highlight.js/lib/core';
import { isPlainParagraphTextTransaction } from '../structureIndex';
import { measureEditorPerformanceProbe } from '../performanceInstrumentation';

// Highlight-tree compatibility follows @tiptap/extension-code-block-lowlight
// 3.30.2 (MIT, Copyright 2025 Tiptap GmbH); see THIRD_PARTY_NOTICES.md.

interface HighlightTreeNode {
  value?: unknown;
  properties?: { className?: unknown };
  children?: unknown;
}

export interface LowlightLike {
  highlight(language: string, value: string): unknown;
  highlightAuto(value: string): unknown;
  listLanguages(): string[];
  registered?(language: string): boolean;
}

interface CodeBlockRecord {
  readonly node: ProseMirrorNode;
  readonly pos: number;
}

export interface OptimizedLowlightState {
  readonly codeBlocks: readonly CodeBlockRecord[];
  decorations: DecorationSet;
  documentScanCount: number;
}

interface OptimizedLowlightPluginOptions {
  name: string;
  lowlight: LowlightLike;
  defaultLanguage?: string | null;
}

interface HighlightTextSpan {
  text: string;
  classes: readonly string[];
}

const assertLowlightApi = (lowlight: LowlightLike): void => {
  const candidate = lowlight as Partial<LowlightLike>;
  if (typeof candidate.highlight !== 'function'
    || typeof candidate.highlightAuto !== 'function'
    || typeof candidate.listLanguages !== 'function') {
    throw new Error('You should provide an instance of lowlight to use the code-block-lowlight extension');
  }
};

const asHighlightTreeNode = (value: unknown): HighlightTreeNode | undefined =>
  typeof value === 'object' && value !== null ? value as HighlightTreeNode : undefined;

const asHighlightTreeNodes = (value: unknown): readonly HighlightTreeNode[] =>
  Array.isArray(value)
    ? value.map(asHighlightTreeNode).filter((node): node is HighlightTreeNode => node !== undefined)
    : [];

const highlightChildren = (result: unknown): readonly HighlightTreeNode[] => {
  const root = asHighlightTreeNode(result);
  return asHighlightTreeNodes(root?.children ?? root?.value);
};

const classNames = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? value.split(/\s+/u).filter(Boolean) : [];
};

const flattenHighlightTree = (
  nodes: readonly HighlightTreeNode[],
  inheritedClasses: readonly string[] = [],
): HighlightTextSpan[] => nodes.flatMap((node) => {
  const classes = [...inheritedClasses, ...classNames(node.properties?.className)];
  const children = asHighlightTreeNodes(node.children);
  if (children.length > 0) return flattenHighlightTree(children, classes);
  return typeof node.value === 'string' ? [{ text: node.value, classes }] : [];
});

const canHighlightLanguage = (lowlight: LowlightLike, language: string): boolean =>
  lowlight.listLanguages().includes(language)
  || Boolean(highlight.getLanguage(language))
  || Boolean(lowlight.registered?.(language));

const highlightBlock = (
  { node, pos }: CodeBlockRecord,
  options: OptimizedLowlightPluginOptions,
): Decoration[] => {
  const configuredLanguage = node.attrs.language;
  const language = typeof configuredLanguage === 'string' && configuredLanguage.length > 0
    ? configuredLanguage
    : options.defaultLanguage;
  const result = measureEditorPerformanceProbe('lowlight-highlight', 1, () =>
    language && canHighlightLanguage(options.lowlight, language)
      ? options.lowlight.highlight(language, node.textContent)
      : options.lowlight.highlightAuto(node.textContent));
  const decorations: Decoration[] = [];
  let from = pos + 1;
  for (const span of flattenHighlightTree(highlightChildren(result))) {
    const to = from + span.text.length;
    if (span.classes.length > 0 && to > from) {
      decorations.push(Decoration.inline(from, to, { class: span.classes.join(' ') }));
    }
    from = to;
  }
  return decorations;
};

const collectCodeBlocks = (doc: ProseMirrorNode, name: string): CodeBlockRecord[] => {
  const blocks: CodeBlockRecord[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== name) return;
    blocks.push({ node, pos });
    return false;
  });
  return blocks;
};

const rebuild = (
  doc: ProseMirrorNode,
  options: OptimizedLowlightPluginOptions,
  documentScanCount: number,
): OptimizedLowlightState => {
  const codeBlocks = collectCodeBlocks(doc, options.name);
  return {
    codeBlocks,
    decorations: DecorationSet.create(doc, codeBlocks.flatMap((block) => highlightBlock(block, options))),
    documentScanCount,
  };
};

// Custom steps can change a document without reporting truthful map ranges.
// Require canonical implementations before trusting either incremental path.
const supportedSteps = new Set<unknown>([
  ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep,
  AddNodeMarkStep, RemoveNodeMarkStep, AttrStep, DocAttrStep,
]);

const updateIncrementally = (
  transaction: Transaction,
  previous: OptimizedLowlightState,
  options: OptimizedLowlightPluginOptions,
): OptimizedLowlightState => {
  const candidates = new Map<number, CodeBlockRecord>();
  for (const block of previous.codeBlocks) {
    let from = block.pos + 1;
    let to = block.pos + block.node.nodeSize - 1;
    let touched = false;
    // Inspect each map in its own coordinate space. Final text equality alone
    // cannot preserve decorations across a delete/reinsert or same-text replace.
    for (const map of transaction.mapping.maps) {
      map.forEach((start, end) => {
        if (start === end ? start >= from && start <= to : start < to && end > from) {
          touched = true;
        }
      });
      if (touched) break;
      from = map.map(from, 1);
      to = map.map(to, -1);
    }
    if (!touched) candidates.set(from - 1, block);
  }
  const codeBlocks = collectCodeBlocks(transaction.doc, options.name);
  const reused = new Set<CodeBlockRecord>();
  const added: Decoration[] = [];
  for (const block of codeBlocks) {
    const old = candidates.get(block.pos);
    if (old && (old.node === block.node || (
      old.node.attrs.language === block.node.attrs.language
      && old.node.textContent === block.node.textContent
    ))) {
      reused.add(old);
    } else {
      added.push(...highlightBlock(block, options));
    }
  }
  // Remove in the old document's coordinates, before mapping. A block converted
  // to a paragraph otherwise retains orphaned syntax spans in its surviving text.
  const removed = previous.codeBlocks.flatMap((block) => reused.has(block) ? []
    : previous.decorations.find(block.pos + 1, block.pos + block.node.nodeSize - 1));
  return {
    codeBlocks,
    decorations: previous.decorations.remove(removed)
      .map(transaction.mapping, transaction.doc).add(transaction.doc, added),
    documentScanCount: previous.documentScanCount + 1,
  };
};

export const createOptimizedLowlightPlugin = (
  options: OptimizedLowlightPluginOptions,
): Plugin<OptimizedLowlightState> => {
  assertLowlightApi(options.lowlight);
  const key = new PluginKey<OptimizedLowlightState>('optimizedLowlight');
  const plugin = new Plugin<OptimizedLowlightState>({
    key,
    state: {
      init(_, state): OptimizedLowlightState {
        return rebuild(state.doc, options, 1);
      },
      apply(transaction, previous): OptimizedLowlightState {
        if (!transaction.docChanged) return previous;
        if (!transaction.steps.every((step) => supportedSteps.has(step.constructor))) {
          return measureEditorPerformanceProbe('lowlight-rebuild', transaction.doc.nodeSize,
            () => rebuild(transaction.doc, options, previous.documentScanCount + 1));
        }
        if (isPlainParagraphTextTransaction(transaction)) {
          return {
            codeBlocks: previous.codeBlocks.map(({ node, pos }) => ({
              node, pos: transaction.mapping.map(pos, 1),
            })),
            decorations: measureEditorPerformanceProbe(
              'lowlight-decoration-map',
              () => previous.decorations.find().length,
              () => previous.decorations.map(transaction.mapping, transaction.doc),
            ),
            documentScanCount: previous.documentScanCount,
          };
        }
        return measureEditorPerformanceProbe('lowlight-incremental-update', previous.codeBlocks.length,
          () => updateIncrementally(transaction, previous, options));
      },
    },
    props: {
      decorations(state) {
        return key.getState(state)?.decorations ?? null;
      },
    },
  });
  return plugin;
};
