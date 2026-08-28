import { StarterKit } from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { CustomTable } from './CustomTable';
import { CustomImage } from './CustomImage';
import { CustomCodeBlock } from './CodeBlockView';
import { MathInline } from './MathInline';
import { MathBlock } from './MathBlock';
import { Endnote } from './Endnote';
import { DiagramBlock } from './DiagramBlock';
import { CrossReference } from './CrossReference';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Callout } from './Callout';
import { CursorHistory } from './CursorHistory';
import { assignAutoIds } from '../../document/sdocUtils';
import {
  ID_COLLISION_NODE_TYPES,
  isAuthorablePersistentId,
  isHistoricalHorizontalRuleId,
  OPTIONAL_IDENTITY_NODE_TYPES,
  REQUIRED_IDENTITY_NODE_TYPES,
  REFERENCEABLE_NODE_TYPES,
} from '../../document/nodeIdentity';
import { getCaptionPreset } from '../../settingsResolver';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionOptions,
  type EditorExtensionRuntime,
} from '../extensionRuntime';
import {
  buildDocumentStructureIndex,
  DocumentStructureIndexExtension,
  documentStructureIndexKey,
  getDocumentStructureIndexState,
  isPlainParagraphTextTransaction,
  resolveStructurePosition,
  subscribeToDocumentStructureIndex,
  type DocumentStructureIndex,
  type DocumentStructureIndexState,
} from '../structureIndex';
import {
  measureEditorPerformanceProbe,
  recordEditorPerformanceProbe,
} from '../performanceInstrumentation';

/* ===== Section Fold (Collapse) ===== */
export interface SectionFoldState {
  collapsed: ReadonlySet<string>;
  decorations: DecorationSet;
  anonymousHeadingPositions: ReadonlySet<number>;
  rebuildCount: number;
}

const sectionFoldKey = new PluginKey<SectionFoldState>('sectionFold');

const foldTargetForHeading = (node: ProseMirrorNode, pos: number): string => {
  const id = node.attrs.id;
  return typeof id === 'string' && id.length > 0 ? `id:${id}` : `pos:${pos}`;
};

const mapCollapsedFoldTargets = (
  collapsed: ReadonlySet<string>,
  transaction: Transaction,
): Set<string> => {
  if (!transaction.docChanged) return new Set(collapsed);
  const mapped = new Set<string>();
  for (const target of collapsed) {
    if (!target.startsWith('pos:')) {
      mapped.add(target);
      continue;
    }
    const pos = Number(target.slice(4));
    if (!Number.isInteger(pos)) continue;
    const result = transaction.mapping.mapResult(pos, 1);
    if (result.deleted) continue;
    const node = transaction.doc.nodeAt(result.pos);
    if (node?.type.name === 'heading') mapped.add(`pos:${result.pos}`);
  }
  return mapped;
};

const normalizeCollapsedFoldTargets = (
  doc: ProseMirrorNode,
  candidates: ReadonlySet<string>,
): Pick<SectionFoldState, 'collapsed' | 'anonymousHeadingPositions'> => {
  const normalized = new Set<string>();
  const anonymousHeadingPositions = new Set<number>();
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    const stableTarget = foldTargetForHeading(node, offset);
    if (stableTarget.startsWith('pos:')) anonymousHeadingPositions.add(offset);
    if (candidates.has(stableTarget) || candidates.has(`pos:${offset}`)) {
      normalized.add(stableTarget);
    }
  });
  return { collapsed: normalized, anonymousHeadingPositions };
};

const anonymousHeadingPositionChanged = (
  positions: ReadonlySet<number>,
  transaction: Transaction,
): boolean => {
  for (const pos of positions) {
    const mapped = transaction.mapping.mapResult(pos, 1);
    if (mapped.deleted || mapped.pos !== pos) return true;
    if (transaction.doc.nodeAt(mapped.pos)?.type.name !== 'heading') return true;
  }
  return false;
};

const updateSectionFoldControl = (
  control: HTMLElement,
  isCollapsed: boolean,
  runtime: EditorExtensionRuntime,
): void => {
  control.className = 'fold-toggle';
  control.textContent = isCollapsed ? '▸' : '▾';
  control.setAttribute('contenteditable', 'false');
  control.setAttribute('role', 'button');
  control.setAttribute('tabindex', '0');
  control.setAttribute('aria-expanded', String(!isCollapsed));
  control.setAttribute(
    'aria-label',
    runtime.translate(isCollapsed ? 'toc.expand' : 'toc.collapse'),
  );
};

const sectionFoldControlTranslationSignature = (
  runtime: EditorExtensionRuntime,
): readonly [expand: string, collapse: string] => [
  runtime.translate('toc.expand'),
  runtime.translate('toc.collapse'),
];

export const buildSectionFoldDecorations = (
  doc: ProseMirrorNode,
  collapsed: ReadonlySet<string>,
  runtime: EditorExtensionRuntime,
  controls?: Map<string, HTMLElement>,
): DecorationSet => {
  const decorations: Decoration[] = [];

  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading' || (node.attrs.level as number) > 6) return;
    const foldTarget = foldTargetForHeading(node, offset);
    const isCollapsed = collapsed.has(foldTarget);
    decorations.push(Decoration.widget(
      offset + 1,
      () => {
        const cachedControl = controls?.get(foldTarget);
        if (cachedControl) {
          updateSectionFoldControl(cachedControl, isCollapsed, runtime);
          return cachedControl;
        }
        const span = document.createElement('span');
        updateSectionFoldControl(span, isCollapsed, runtime);
        controls?.set(foldTarget, span);
        return span;
      },
      {
        side: -1,
        key: `fold-${foldTarget}`,
        destroy: (node) => {
          if (controls?.get(foldTarget) === node) controls.delete(foldTarget);
        },
      },
    ));

    if (!isCollapsed) return;
    const headingLevel = node.attrs.level as number;
    let nextOffset = offset + node.nodeSize;
    while (nextOffset < doc.content.size) {
      const nextNode = doc.nodeAt(nextOffset);
      if (!nextNode) break;
      if (nextNode.type.name === 'heading' && (nextNode.attrs.level as number) <= headingLevel) break;
      decorations.push(
        Decoration.node(nextOffset, nextOffset + nextNode.nodeSize, {
          class: 'section-collapsed',
        }),
      );
      nextOffset += nextNode.nodeSize;
    }
  });

  return DecorationSet.create(doc, decorations);
};

const rebuildSectionFoldState = (
  doc: ProseMirrorNode,
  candidates: ReadonlySet<string>,
  runtime: EditorExtensionRuntime,
  rebuildCount: number,
  controls?: Map<string, HTMLElement>,
): SectionFoldState => measureEditorPerformanceProbe(
  'section-fold-rebuild',
  doc.childCount,
  () => {
  const { collapsed, anonymousHeadingPositions } = normalizeCollapsedFoldTargets(doc, candidates);
    return {
    collapsed,
    decorations: buildSectionFoldDecorations(doc, collapsed, runtime, controls),
    anonymousHeadingPositions,
    rebuildCount,
    };
  },
);

export const createSectionFoldPlugin = (runtime: EditorExtensionRuntime): Plugin<SectionFoldState> => {
  const controls = new Map<string, HTMLElement>();
  const syncControls = (state: EditorState): void => {
    const collapsed = sectionFoldKey.getState(state)?.collapsed ?? new Set<string>();
    for (const [foldTarget, control] of controls) {
      updateSectionFoldControl(control, collapsed.has(foldTarget), runtime);
    }
  };
  const toggleFromControl = (view: EditorView, target: HTMLElement): boolean => {
    if (!target.classList.contains('fold-toggle')) return false;
    const heading = target.parentElement;
    if (!heading || !/^H[1-6]$/i.test(heading.tagName)) return false;

    const pos = view.posAtDOM(heading, 0);
    const resolved = view.state.doc.resolve(pos);
    const headingPos = resolved.before(resolved.depth);
    view.dispatch(view.state.tr.setMeta(sectionFoldKey, headingPos));
    target.focus({ preventScroll: true });
    return true;
  };

  return new Plugin({
    key: sectionFoldKey,
    view(view) {
      let syncedRebuildCount = sectionFoldKey.getState(view.state)?.rebuildCount ?? -1;
      let syncedTranslationSignature = sectionFoldControlTranslationSignature(runtime);
      syncControls(view.state);
      return {
        update(updatedView) {
          const rebuildCount = sectionFoldKey.getState(updatedView.state)?.rebuildCount ?? -1;
          const translationSignature = sectionFoldControlTranslationSignature(runtime);
          if (rebuildCount === syncedRebuildCount
            && translationSignature[0] === syncedTranslationSignature[0]
            && translationSignature[1] === syncedTranslationSignature[1]) return;
          syncedRebuildCount = rebuildCount;
          syncedTranslationSignature = translationSignature;
          syncControls(updatedView.state);
        },
        destroy() {
          controls.clear();
        },
      };
    },
    state: {
      init(_, state): SectionFoldState {
        return rebuildSectionFoldState(state.doc, new Set(), runtime, 1, controls);
      },
      apply(tr, previous): SectionFoldState {
        const mappedCollapsed = measureEditorPerformanceProbe(
          'section-fold-map',
          previous.collapsed.size + previous.anonymousHeadingPositions.size,
          () => mapCollapsedFoldTargets(previous.collapsed, tr),
        );
        const meta = tr.getMeta(sectionFoldKey) as unknown;
        if (typeof meta === 'number') {
          const heading = tr.doc.nodeAt(meta);
          if (heading?.type.name === 'heading') {
            const target = foldTargetForHeading(heading, meta);
            if (mappedCollapsed.has(target)) mappedCollapsed.delete(target);
            else mappedCollapsed.add(target);
            return rebuildSectionFoldState(
              tr.doc,
              mappedCollapsed,
              runtime,
              previous.rebuildCount + 1,
              controls,
            );
          }
        }
        if (!tr.docChanged) return previous;
        if (isPlainParagraphTextTransaction(tr)
          && !anonymousHeadingPositionChanged(previous.anonymousHeadingPositions, tr)) {
          return {
            collapsed: mappedCollapsed,
            decorations: measureEditorPerformanceProbe(
              'section-fold-decoration-map',
              () => previous.decorations.find().length,
              () => previous.decorations.map(tr.mapping, tr.doc),
            ),
            anonymousHeadingPositions: previous.anonymousHeadingPositions,
            rebuildCount: previous.rebuildCount,
          };
        }
        return rebuildSectionFoldState(
          tr.doc,
          mappedCollapsed,
          runtime,
          previous.rebuildCount + 1,
          controls,
        );
      },
    },
    props: {
      decorations(state) {
        return sectionFoldKey.getState(state)?.decorations ?? null;
      },
      handleDOMEvents: {
        mousedown(view, event) {
          const target = event.target as HTMLElement;
          if (!target.classList.contains('fold-toggle')) return false;

          event.preventDefault();
          event.stopPropagation();
          return toggleFromControl(view, target);
        },
        keydown(view, event) {
          if (event.key !== 'Enter' && event.key !== ' ') return false;
          const target = event.target as HTMLElement;
          if (!target.classList.contains('fold-toggle')) return false;

          event.preventDefault();
          event.stopPropagation();
          return toggleFromControl(view, target);
        },
      },
    },
  });
};

const SectionFold = Extension.create<EditorExtensionOptions>({
  name: 'sectionFold',

  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },

  addProseMirrorPlugins() {
    return [createSectionFoldPlugin(this.options.runtime)];
  },
});

const HeadingKeyboardShortcuts = Extension.create({
  name: 'headingKeyboardShortcuts',

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        // If inside a list, let the default list sink behavior handle it
        if (editor.isActive('listItem')) {
          return false;
        }
        // If inside a table, let Tab navigate cells
        if (editor.isActive('table')) {
          return false;
        }
        // If on a heading, increase level (up to h6)
        for (let level = 1; level <= 5; level++) {
          if (editor.isActive('heading', { level })) {
            editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).toggleHeading({ level: (level + 1) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
            return true;
          }
        }
        // h6 is the max level — do nothing
        if (editor.isActive('heading', { level: 6 })) {
          return true;
        }
        // On a paragraph, convert to h1
        if (editor.isActive('paragraph')) {
          editor.chain().focus().toggleHeading({ level: 1 }).run();
          return true;
        }
        return false;
      },
      'Shift-Tab': ({ editor }) => {
        // If inside a list, let the default list lift behavior handle it
        if (editor.isActive('listItem')) {
          return false;
        }
        // If inside a table, let Shift+Tab navigate cells
        if (editor.isActive('table')) {
          return false;
        }
        // If on a heading, decrease level (down to paragraph)
        if (editor.isActive('heading', { level: 1 })) {
          editor.chain().focus().toggleHeading({ level: 1 }).run();
          return true;
        }
        for (let level = 2; level <= 6; level++) {
          if (editor.isActive('heading', { level })) {
            editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).toggleHeading({ level: (level - 1) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
            return true;
          }
        }
        return false;
      },
    };
  },
});

const optionalBlockIdAttribute = {
  default: undefined,
  keepOnSplit: false,
  parseHTML: (element: HTMLElement) => {
    const id = element.getAttribute('data-id');
    return id && isAuthorablePersistentId(id) ? id : undefined;
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const id = attributes.id;
    return typeof id === 'string' && id ? { 'data-id': id } : {};
  },
};

const historicalHorizontalRuleIdAttribute = {
  default: undefined,
  keepOnSplit: false,
  parseHTML: (element: HTMLElement) => {
    const id = element.getAttribute('data-id');
    return id && isHistoricalHorizontalRuleId(id) ? id : undefined;
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const id = attributes.id;
    return typeof id === 'string' && isHistoricalHorizontalRuleId(id)
      ? { 'data-id': id }
      : {};
  },
};

function collectIdentityIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const id = node.attrs.id;
    if (ID_COLLISION_NODE_TYPES.has(node.type.name) && typeof id === 'string' && id) {
      ids.add(id);
    }
  });
  return ids;
}

function stripPastedIdCollisions(
  fragment: Fragment,
  usedIds: Set<string>,
): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    let nextAttrs = node.attrs;
    const id = node.attrs.id;
    if (ID_COLLISION_NODE_TYPES.has(node.type.name) && typeof id === 'string' && id) {
      if (usedIds.has(id)) {
        nextAttrs = { ...node.attrs, id: undefined };
      } else {
        usedIds.add(id);
      }
    }

    const nextContent = node.content.size > 0
      ? stripPastedIdCollisions(node.content, usedIds)
      : node.content;
    const nextNode = nextAttrs === node.attrs && nextContent.eq(node.content)
      ? node
      : node.type.create(nextAttrs, nextContent, node.marks);
    nodes.push(nextNode);
  });
  return Fragment.fromArray(nodes);
}

function isPlainIdentityTextTransaction(transaction: Transaction): boolean {
  if (!isPlainParagraphTextTransaction(transaction)) return false;
  return transaction.steps.every((step) => {
    const json = step.toJSON() as {
      stepType?: unknown;
      slice?: { content?: Array<{ type?: unknown }> };
    };
    return json.stepType === 'replace'
      && (json.slice?.content ?? []).every((node) => node.type === 'text');
  });
}

const BlockIdentity = Extension.create({
  name: 'blockIdentity',

  addGlobalAttributes() {
    return [
      {
        // data-id preserves editor identity without creating an HTML anchor.
        types: [...OPTIONAL_IDENTITY_NODE_TYPES],
        attributes: { id: optionalBlockIdAttribute },
      },
      {
        // horizontalRule is a legacy collision reservation, not authored identity.
        types: ['horizontalRule'],
        attributes: { id: historicalHorizontalRuleIdAttribute },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformPasted(slice, view) {
          const usedIds = collectIdentityIds(view.state.doc);
          const content = stripPastedIdCollisions(slice.content, usedIds);
          return content.eq(slice.content)
            ? slice
            : new Slice(content, slice.openStart, slice.openEnd);
        },
      },

      // ProseMirror may copy node attrs while splitting a block. Keep the
      // first occurrence and clear the copied ID from the new sibling.
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        if (transactions.filter((transaction) => transaction.docChanged)
          .every(isPlainIdentityTextTransaction)) {
          recordEditorPerformanceProbe('block-identity-id-scan', 0);
          return null;
        }

        const duplicates = measureEditorPerformanceProbe(
          'block-identity-id-scan',
          newState.doc.nodeSize,
          () => {
            const seenIds = new Set<string>();
            const found: Array<{ node: ProseMirrorNode; pos: number }> = [];
            newState.doc.descendants((node, pos) => {
              if (!ID_COLLISION_NODE_TYPES.has(node.type.name)) return;
              const id = node.attrs.id;
              if (typeof id !== 'string' || !id) return;
              if (seenIds.has(id)) found.push({ node, pos });
              else seenIds.add(id);
            });
            return found;
          },
        );

        if (duplicates.length === 0) return null;
        const transaction = newState.tr;
        for (const { node, pos } of duplicates) {
          transaction.setNodeMarkup(pos, undefined, { ...node.attrs, id: undefined });
        }
        return transaction;
      },
    })];
  },
});

/** Assign persistent identities inside the editor transaction, before any host save round-trip. */
const PersistentNodeIds = Extension.create({
  name: 'persistentNodeIds',

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        if (transactions.filter((transaction) => transaction.docChanged)
          .every(isPlainParagraphTextTransaction)) {
          recordEditorPerformanceProbe('persistent-id-scan', 0);
          return null;
        }
        const ids = measureEditorPerformanceProbe('persistent-id-scan', newState.doc.nodeSize, () => {
          const normalized = assignAutoIds(newState.doc.toJSON());
          const collected: string[] = [];
          const collect = (node: ReturnType<typeof newState.doc.toJSON>): void => {
            if ((REFERENCEABLE_NODE_TYPES.has(node.type) || REQUIRED_IDENTITY_NODE_TYPES.has(node.type))
              && typeof node.attrs?.id === 'string') {
              collected.push(node.attrs.id);
            }
            node.content?.forEach(collect);
          };
          collect(normalized);
          return collected;
        });

        let index = 0;
        let changed = false;
        const transaction = newState.tr;
        newState.doc.descendants((node, pos) => {
          if (!REFERENCEABLE_NODE_TYPES.has(node.type.name)
            && !REQUIRED_IDENTITY_NODE_TYPES.has(node.type.name)) return;
          const id = ids[index++];
          if (id && node.attrs.id !== id) {
            transaction.setNodeMarkup(pos, undefined, { ...node.attrs, id });
            changed = true;
          }
        });
        return changed ? transaction : null;
      },
    })];
  },
});

/* ===== Equation Numbering ===== */
const eqNumberingKey = new PluginKey('equationNumbering');

const EquationNumbering = Extension.create<EditorExtensionOptions>({
  name: 'equationNumbering',
  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: eqNumberingKey,
        view(view) {
          const applyNumbering = (index: DocumentStructureIndex) => {
            for (const entry of index.equations) {
              try {
                const domEl = view.nodeDOM(entry.pos) as (HTMLElement & { _setEqNumber?: (label: string | null) => void }) | null;
                if (domEl && typeof domEl._setEqNumber === 'function') {
                  domEl._setEqNumber(entry.displayLabel || null);
                }
              } catch {
                // Node may not yet be in the DOM.
              }
            }
          };
          applyNumbering(getDocumentStructureIndexState(view.state));
          const unsubscribe = subscribeToDocumentStructureIndex(view, applyNumbering);
          return { destroy: unsubscribe };
        },
      }),
    ];
  },
});

interface SemanticNumberingState {
  decorations: DecorationSet;
  semanticRevision: number;
}

const semanticNumberingKey = new PluginKey<SemanticNumberingState>('semanticNumbering');

const structureSemanticRevision = (index: DocumentStructureIndex): number =>
  (index as Partial<DocumentStructureIndexState>).semanticRevision ?? 0;

const buildSemanticNumberingDecorations = (
  doc: ProseMirrorNode,
  index: DocumentStructureIndex,
): DecorationSet => {
  const decorations: Decoration[] = [];
  for (const entry of index.headings) {
    if (!entry.numbered) continue;
    const node = doc.nodeAt(entry.pos);
    if (!node) continue;
    decorations.push(Decoration.node(entry.pos, entry.pos + node.nodeSize, {
      'data-number-label': entry.number,
    }));
  }
  return DecorationSet.create(doc, decorations);
};

const SemanticNumbering = Extension.create<EditorExtensionOptions>({
  name: 'semanticNumbering',
  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },
  addProseMirrorPlugins() {
    const runtime = this.options.runtime;
    return [new Plugin({
      key: semanticNumberingKey,
      state: {
        init(_, state): SemanticNumberingState {
          const index = documentStructureIndexKey.getState(state)
            ?? buildDocumentStructureIndex(state.doc, runtime.getSettings());
          return {
            decorations: buildSemanticNumberingDecorations(state.doc, index),
            semanticRevision: structureSemanticRevision(index),
          };
        },
        apply(transaction, previous, _oldState, newState): SemanticNumberingState {
          if (transaction.docChanged && isPlainParagraphTextTransaction(transaction)) {
            return {
              decorations: measureEditorPerformanceProbe(
                'semantic-numbering-decoration-map',
                () => previous.decorations.find().length,
                () => previous.decorations.map(transaction.mapping, newState.doc),
              ),
              semanticRevision: previous.semanticRevision,
            };
          }
          const managedIndex = documentStructureIndexKey.getState(newState);
          if (!managedIndex) {
            const fallback = buildDocumentStructureIndex(newState.doc, runtime.getSettings());
            return {
              decorations: buildSemanticNumberingDecorations(newState.doc, fallback),
              semanticRevision: previous.semanticRevision + 1,
            };
          }
          const index = managedIndex;
          const semanticRevision = structureSemanticRevision(index);
          if (previous.semanticRevision === semanticRevision) {
            if (!transaction.docChanged) return previous;
            return {
              decorations: measureEditorPerformanceProbe(
                'semantic-numbering-decoration-map',
                () => previous.decorations.find().length,
                () => previous.decorations.map(transaction.mapping, newState.doc),
              ),
              semanticRevision: previous.semanticRevision,
            };
          }
          return measureEditorPerformanceProbe(
            'semantic-numbering-rebuild',
            index.headings.length,
            () => ({
              decorations: buildSemanticNumberingDecorations(newState.doc, index),
              semanticRevision,
            }),
          );
        },
      },
      props: {
        decorations(state) {
          return semanticNumberingKey.getState(state)?.decorations ?? null;
        },
      },
      view(initialView) {
        const applyNumbering = (index: DocumentStructureIndex) => {
          const settings = runtime.getSettings();
          const preset = getCaptionPreset(settings.captionStyle);
          for (const entry of [...index.figures, ...index.tables]) {
            const dom = initialView.nodeDOM(entry.pos) as HTMLElement | null;
            if (!dom) continue;
            const label = dom.querySelector<HTMLElement>('.caption-label');
            if (label) label.dataset.numberLabel = `${entry.baseLabel}${preset.separator}`;
          }
        };
        applyNumbering(getDocumentStructureIndexState(initialView.state));
        const unsubscribe = subscribeToDocumentStructureIndex(initialView, applyNumbering);
        return { destroy: unsubscribe };
      },
    })];
  },
});

/* ===== Block Exit (Blockquote / Callout escape) ===== */
const WRAPPER_TYPES = ['blockquote', 'callout'];

const BlockExit = Extension.create({
  name: 'blockExit',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $head, empty } = state.selection;

        if (!empty) return false;
        if ($head.parent.type.name !== 'paragraph' || $head.parent.content.size !== 0) return false;

        for (let d = $head.depth - 1; d >= 0; d--) {
          const wrapper = $head.node(d);
          if (!WRAPPER_TYPES.includes(wrapper.type.name)) continue;

          // Must be the last child of the wrapper
          const indexInParent = $head.index(d);
          if (indexInParent !== wrapper.childCount - 1) return false;

          const emptyFrom = $head.before($head.depth);
          const emptyTo = $head.after($head.depth);
          const afterWrapper = $head.after(d);

          const { tr } = state;
          tr.delete(emptyFrom, emptyTo);
          const mappedAfter = tr.mapping.map(afterWrapper);
          const newPara = state.schema.nodes.paragraph.create();
          tr.insert(mappedAfter, newPara);
          tr.setSelection(TextSelection.create(tr.doc, mappedAfter + 1));
          editor.view.dispatch(tr);
          return true;
        }
        return false;
      },

      Backspace: ({ editor }) => {
        const { state } = editor;
        const { $head, empty } = state.selection;

        if (!empty) return false;
        if ($head.parent.type.name !== 'paragraph') return false;
        if ($head.parent.content.size !== 0 || $head.parentOffset !== 0) return false;

        for (let d = $head.depth - 1; d >= 0; d--) {
          const wrapper = $head.node(d);
          if (!WRAPPER_TYPES.includes(wrapper.type.name)) continue;

          const indexInParent = $head.index(d);
          if (indexInParent !== 0) return false;

          const wrapperFrom = $head.before(d);
          const { tr } = state;

          if (wrapper.childCount === 1) {
            // Only child — replace wrapper with empty paragraph
            tr.replaceWith(wrapperFrom, wrapperFrom + wrapper.nodeSize, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, wrapperFrom + 1));
          } else {
            // Has siblings — delete first empty paragraph
            const emptyFrom = $head.before($head.depth);
            const emptyTo = $head.after($head.depth);
            tr.delete(emptyFrom, emptyTo);
            // Insert paragraph before wrapper
            tr.insert(wrapperFrom, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, wrapperFrom + 1));
          }
          editor.view.dispatch(tr);
          return true;
        }
        return false;
      },
    };
  },
});

/* ===== Heading with optional numbering exclusion (e.g. Introduction, Glossary) ===== */
const HeadingNumbering = Extension.create({
  name: 'headingNumbering',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('id') || element.getAttribute('data-id'),
            renderHTML: (attributes: { id?: string | null }) =>
              attributes.id ? { id: attributes.id, 'data-id': attributes.id } : {},
          },
          numbered: {
            default: null,
            parseHTML: (element: HTMLElement) => (element.getAttribute('data-numbered') === 'false' ? false : null),
            renderHTML: (attributes: { numbered?: boolean | null }) => {
              if (attributes.numbered === false) {
                return { 'data-numbered': 'false' };
              }
              return {};
            },
          },
        },
      },
    ];
  },
});

export function createTiptapExtensions(runtime: EditorExtensionRuntime) {
  return [
  StarterKit.configure({
    codeBlock: false,
    link: {
      openOnClick: false,
      autolink: false,
      HTMLAttributes: {
        class: 'editor-link',
      },
    },
  }),
  HeadingNumbering,
  DocumentStructureIndexExtension.configure({ runtime }),
  BlockIdentity,
  PersistentNodeIds,
  Callout.configure({ runtime }),
  CustomCodeBlock.configure({ runtime } as Partial<typeof CustomCodeBlock.options> & {
    runtime: EditorExtensionRuntime;
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  CustomImage.configure({ runtime }),
  CustomTable.configure({ runtime }),
  TableRow,
  TableHeader,
  TableCell,
  MathInline.configure({ runtime }),
  Endnote.configure({ runtime }),
  MathBlock.configure({ runtime }),
  DiagramBlock.configure({ runtime }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  TextAlign.configure({
    types: ['heading', 'paragraph'],
  }),
  HeadingKeyboardShortcuts,
  BlockExit,
  CrossReference.configure({ runtime }),
  SectionFold.configure({ runtime }),
  EquationNumbering.configure({ runtime }),
  SemanticNumbering.configure({ runtime }),
  CursorHistory,
  Extension.create({
    name: 'internalLinkClick',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              click(view, event) {
                const anchor = (event.target as HTMLElement).closest('a[href]');
                if (!anchor) return false;
                const href = anchor.getAttribute('href');
                if (!href) return false;

                // Cross-document link: path ending with .sdoc (with optional #anchor)
                if (href.includes('.sdoc')) {
                  event.preventDefault();
                  const [filePath, fragment] = href.split('#');
                  runtime.openDocument(filePath, fragment || '');
                  return true;
                }

                // Internal anchor link: #id
                if (!href.startsWith('#')) return false;
                const targetId = href.slice(1);

                // Stable IDs resolve through the transaction-mapped structure index.
                let targetPos: number | null = resolveStructurePosition(view.state, targetId) ?? null;
                const slugify = (text: string) => text.toLowerCase()
                  .replace(/[^\w\s가-힣-]/g, '').replace(/\s+/g, '-')
                  .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
                const getText = (n: ProseMirrorNode): string => {
                  if (n.isText) return n.text || '';
                  let t = '';
                  n.content.forEach((c) => { t += getText(c); });
                  return t;
                };

                let imgCnt = 0;
                let tblCnt = 0;
                let eqCnt = 0;
                view.state.doc.descendants((node, pos) => {
                  if (targetPos !== null) return false;
                  // Check persisted id first
                  if (REFERENCEABLE_NODE_TYPES.has(node.type.name) && node.attrs?.id === targetId) {
                    targetPos = pos;
                    return false;
                  }
                  // Generate on-the-fly id and check
                  if (node.type.name === 'heading') {
                    const text = getText(node);
                    if (slugify(text) === targetId) {
                      targetPos = pos;
                      return false;
                    }
                  }
                  if (node.type.name === 'image') {
                    imgCnt++;
                    if (`figure-${imgCnt}` === targetId) {
                      targetPos = pos;
                      return false;
                    }
                  }
                  if (node.type.name === 'table') {
                    tblCnt++;
                    if (`table-${tblCnt}` === targetId) {
                      targetPos = pos;
                      return false;
                    }
                  }
                  if (node.type.name === 'mathBlock') {
                    eqCnt++;
                    if (`eq-${eqCnt}` === targetId) {
                      targetPos = pos;
                      return false;
                    }
                  }
                });

                if (targetPos !== null) {
                  event.preventDefault();
                  const dom = view.nodeDOM(targetPos);
                  if (dom && dom instanceof HTMLElement) {
                    dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                  return true;
                }
                return false;
              },
            },
          },
        }),
      ];
    },
  }),
  ];
}
