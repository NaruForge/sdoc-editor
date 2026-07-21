import { StarterKit } from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Link } from '@tiptap/extension-link';
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
import { DiagramBlock } from './DiagramBlock';
import { CrossReference } from './CrossReference';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Callout } from './Callout';
import { CursorHistory } from './CursorHistory';
import type { ResolvedEditorSettings, TiptapNode } from '@shared/types';
import { assignAutoIds } from '../../document/sdocUtils';
import { buildNumberingIndex } from '../../document/numbering';
import { getCaptionPreset } from '../../settingsResolver';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionOptions,
  type EditorExtensionRuntime,
} from '../extensionRuntime';

/* ===== Section Fold (Collapse) ===== */
const sectionFoldKey = new PluginKey<Set<number>>('sectionFold');

const SectionFold = Extension.create({
  name: 'sectionFold',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sectionFoldKey,
        state: {
          init(): Set<number> {
            return new Set();
          },
          apply(tr, oldSet: Set<number>): Set<number> {
            const meta = tr.getMeta(sectionFoldKey);
            if (meta !== undefined) {
              const next = new Set(oldSet);
              if (next.has(meta)) {
                next.delete(meta);
              } else {
                next.add(meta);
              }
              return next;
            }
            if (tr.docChanged) {
              const next = new Set<number>();
              oldSet.forEach((pos) => {
                const mapped = tr.mapping.map(pos, 1);
                const node = tr.doc.nodeAt(mapped);
                if (node && node.type.name === 'heading') {
                  next.add(mapped);
                }
              });
              return next;
            }
            return oldSet;
          },
        },
        props: {
          decorations(state) {
            const collapsed = sectionFoldKey.getState(state)!;
            const decorations: Decoration[] = [];

            state.doc.forEach((node, offset) => {
              if (node.type.name === 'heading' && (node.attrs.level as number) <= 6) {
                const isCollapsed = collapsed.has(offset);

                const widget = Decoration.widget(
                  offset + 1,
                  () => {
                    const span = document.createElement('span');
                    span.className = 'fold-toggle';
                    span.textContent = isCollapsed ? '▸' : '▾';
                    span.setAttribute('contenteditable', 'false');
                    return span;
                  },
                  { side: -1, key: `fold-${offset}-${isCollapsed ? 'c' : 'o'}` },
                );
                decorations.push(widget);

                if (isCollapsed) {
                  const headingLevel = node.attrs.level as number;
                  let nextOffset = offset + node.nodeSize;
                  while (nextOffset < state.doc.content.size) {
                    const nextNode = state.doc.nodeAt(nextOffset);
                    if (!nextNode) break;
                    if (nextNode.type.name === 'heading' && (nextNode.attrs.level as number) <= headingLevel) break;
                    decorations.push(
                      Decoration.node(nextOffset, nextOffset + nextNode.nodeSize, {
                        class: 'section-collapsed',
                      }),
                    );
                    nextOffset += nextNode.nodeSize;
                  }
                }
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement;
              if (!target.classList.contains('fold-toggle')) return false;

              event.preventDefault();
              event.stopPropagation();

              const heading = target.parentElement;
              if (!heading || !/^H[1-6]$/i.test(heading.tagName)) return false;

              const pos = view.posAtDOM(heading, 0);
              const resolved = view.state.doc.resolve(pos);
              const headingPos = resolved.before(resolved.depth);

              const tr = view.state.tr.setMeta(sectionFoldKey, headingPos);
              view.dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
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

const REFERENCEABLE_NODE_TYPES = new Set(['heading', 'image', 'table', 'mathBlock']);

/** Assign persistent identities inside the editor transaction, before any host save round-trip. */
const PersistentNodeIds = Extension.create({
  name: 'persistentNodeIds',

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const normalized = assignAutoIds(newState.doc.toJSON());
        const ids: string[] = [];
        const collect = (node: ReturnType<typeof newState.doc.toJSON>): void => {
          if (REFERENCEABLE_NODE_TYPES.has(node.type) && typeof node.attrs?.id === 'string') {
            ids.push(node.attrs.id);
          }
          node.content?.forEach(collect);
        };
        collect(normalized);

        let index = 0;
        let changed = false;
        const transaction = newState.tr;
        newState.doc.descendants((node, pos) => {
          if (!REFERENCEABLE_NODE_TYPES.has(node.type.name)) return;
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

/**
 * Build a map of { pos → equationNumber } for all mathBlock nodes.
 * Numbering mode is read from the injected editor settings:
 *   'sequential' → (1), (2), (3) across the entire document
 *   'hierarchical' → (1.1), (1.2), (2.1) resetting per H1
 */
function buildEqNumberMap(
  doc: import('@tiptap/pm/model').Node,
  settings: ResolvedEditorSettings,
): Map<number, string> {
  const map = new Map<number, string>();
  const numbering = buildNumberingIndex(doc.toJSON() as TiptapNode, settings);
  doc.descendants((node, offset) => {
    if (node.type.name === 'mathBlock') {
      const id = String(node.attrs.id ?? '');
      const label = numbering.byId.get(id)?.displayLabel;
      if (label) map.set(offset, label);
    }
  });
  return map;
}

const EquationNumbering = Extension.create<EditorExtensionOptions>({
  name: 'equationNumbering',
  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },
  addProseMirrorPlugins() {
    const runtime = this.options.runtime;
    return [
      new Plugin({
        key: eqNumberingKey,
        view() {
          let previousDoc: import('@tiptap/pm/model').Node | undefined;
          let previousSettings = '';
          return {
            update(view: EditorView) {
              const settings = runtime.getSettings();
              const settingsKey = JSON.stringify({
                captionStyle: settings.captionStyle,
                headingNumbering: settings.headingNumbering,
                captionNumbering: settings.captionNumbering,
                equationNumbering: settings.equationNumbering,
              });
              if (previousDoc?.eq(view.state.doc) && previousSettings === settingsKey) return;
              previousDoc = view.state.doc;
              previousSettings = settingsKey;
              const map = buildEqNumberMap(view.state.doc, settings);
              view.state.doc.descendants((node, offset) => {
                if (node.type.name !== 'mathBlock') return;
                // nodeDOM(offset) directly returns the NodeView's outer DOM element.
                // domAtPos() is unreliable for atom nodes because they have no inner positions.
                try {
                  const domEl = view.nodeDOM(offset) as (HTMLElement & { _setEqNumber?: (l: string | null) => void }) | null;
                  if (domEl && typeof domEl._setEqNumber === 'function') {
                    domEl._setEqNumber(map.get(offset) ?? null);
                  }
                } catch {
                  // Node may not yet be in the DOM
                }
              });
            },
          };
        },
      }),
    ];
  },
});

interface SemanticNumberingState {
  decorations: DecorationSet;
  settingsKey: string;
}

const semanticNumberingKey = new PluginKey<SemanticNumberingState>('semanticNumbering');

const semanticSettingsKey = (settings: ResolvedEditorSettings): string => [
  settings.headingNumbering,
  settings.captionNumbering,
  settings.equationNumbering,
  settings.captionStyle,
].join('|');

const buildSemanticNumberingDecorations = (
  doc: ProseMirrorNode,
  settings: ResolvedEditorSettings,
): DecorationSet => {
  const numbering = buildNumberingIndex(doc.toJSON() as TiptapNode, settings);
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const id = String(node.attrs.id ?? '');
    const entry = numbering.byId.get(id);
    if (!entry?.numbered) return;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
      'data-number-label': entry.number,
    }));
  });
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
          const settings = runtime.getSettings();
          return {
            decorations: buildSemanticNumberingDecorations(state.doc, settings),
            settingsKey: semanticSettingsKey(settings),
          };
        },
        apply(transaction, previous, _oldState, newState): SemanticNumberingState {
          const settings = runtime.getSettings();
          const settingsKey = semanticSettingsKey(settings);
          if (!transaction.docChanged && previous.settingsKey === settingsKey) return previous;
          return {
            decorations: buildSemanticNumberingDecorations(newState.doc, settings),
            settingsKey,
          };
        },
      },
      props: {
        decorations(state) {
          return semanticNumberingKey.getState(state)?.decorations ?? null;
        },
      },
      view(initialView) {
        let previousDoc: import('@tiptap/pm/model').Node | undefined;
        let previousSettings = '';
        const applyNumbering = (view: EditorView) => {
          const settings = runtime.getSettings();
          const settingsKey = semanticSettingsKey(settings);
          if (previousDoc?.eq(view.state.doc) && previousSettings === settingsKey) return;
          previousDoc = view.state.doc;
          previousSettings = settingsKey;
          const numbering = buildNumberingIndex(view.state.doc.toJSON() as TiptapNode, settings);
          const preset = getCaptionPreset(settings.captionStyle);
          view.state.doc.descendants((node, pos) => {
            const id = String(node.attrs.id ?? '');
            const entry = numbering.byId.get(id);
            if (entry?.kind !== 'figure' && entry?.kind !== 'table') return;
            const dom = view.nodeDOM(pos) as HTMLElement | null;
            if (!dom) return;
            const label = dom.querySelector<HTMLElement>('.caption-label');
            if (label) label.dataset.numberLabel = `${entry.baseLabel}${preset.separator}`;
          });
        };
        applyNumbering(initialView);
        return {
          update: applyNumbering,
        };
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
  }),
  HeadingNumbering,
  PersistentNodeIds,
  Callout,
  CustomCodeBlock,
  Underline,
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    HTMLAttributes: {
      class: 'editor-link',
    },
  }),
  CustomImage.configure({ runtime }),
  CustomTable.configure({ runtime }),
  TableRow,
  TableHeader,
  TableCell,
  MathInline.configure({ runtime }),
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
  SectionFold,
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

                // Search by persisted id attr OR by on-the-fly generated id
                let targetPos: number | null = null;
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
                  if (node.attrs?.id === targetId) {
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
