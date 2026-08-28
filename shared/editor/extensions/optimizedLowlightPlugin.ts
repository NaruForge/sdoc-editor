import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
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

export interface OptimizedLowlightState {
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

const buildLowlightDecorations = (
  doc: ProseMirrorNode,
  options: OptimizedLowlightPluginOptions,
): DecorationSet => {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== options.name) return;
    const configuredLanguage = node.attrs.language;
    const language = typeof configuredLanguage === 'string' && configuredLanguage.length > 0
      ? configuredLanguage
      : options.defaultLanguage;
    const result = language && canHighlightLanguage(options.lowlight, language)
      ? options.lowlight.highlight(language, node.textContent)
      : options.lowlight.highlightAuto(node.textContent);
    let from = pos + 1;
    for (const span of flattenHighlightTree(highlightChildren(result))) {
      const to = from + span.text.length;
      if (span.classes.length > 0) {
        decorations.push(Decoration.inline(from, to, { class: span.classes.join(' ') }));
      }
      from = to;
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
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
        return {
          decorations: buildLowlightDecorations(state.doc, options),
          documentScanCount: 1,
        };
      },
      apply(transaction, previous): OptimizedLowlightState {
        if (!transaction.docChanged) return previous;
        if (isPlainParagraphTextTransaction(transaction)) {
          return {
            decorations: measureEditorPerformanceProbe(
              'lowlight-decoration-map',
              () => previous.decorations.find().length,
              () => previous.decorations.map(transaction.mapping, transaction.doc),
            ),
            documentScanCount: previous.documentScanCount,
          };
        }
        return measureEditorPerformanceProbe('lowlight-rebuild', transaction.doc.nodeSize, () => ({
          decorations: buildLowlightDecorations(transaction.doc, options),
          documentScanCount: previous.documentScanCount + 1,
        }));
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
