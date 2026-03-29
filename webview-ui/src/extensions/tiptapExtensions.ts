import { StarterKit } from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Link } from '@tiptap/extension-link';
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
import { CrossReference } from './CrossReference';

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
              if (node.type.name === 'heading' && (node.attrs.level as number) <= 3) {
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
              if (!heading || !/^H[1-3]$/i.test(heading.tagName)) return false;

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
        // If on a heading, increase level (up to h3)
        for (let level = 1; level <= 2; level++) {
          if (editor.isActive('heading', { level })) {
            editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).toggleHeading({ level: (level + 1) as 1 | 2 | 3 }).run();
            return true;
          }
        }
        // h3 is the max level — do nothing
        if (editor.isActive('heading', { level: 3 })) {
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
        for (let level = 2; level <= 3; level++) {
          if (editor.isActive('heading', { level })) {
            editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).toggleHeading({ level: (level - 1) as 1 | 2 | 3 }).run();
            return true;
          }
        }
        return false;
      },
    };
  },
});

export const tiptapExtensions = [
  StarterKit.configure({
    codeBlock: false,
  }),
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
  CustomImage,
  CustomTable,
  TableRow,
  TableHeader,
  TableCell,
  MathInline,
  MathBlock,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  HeadingKeyboardShortcuts,
  CrossReference,
  SectionFold,
  Extension.create({
    name: 'internalLinkClick',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              click(view, event) {
                const anchor = (event.target as HTMLElement).closest('a[href^="#"]');
                if (!anchor) return false;
                const href = anchor.getAttribute('href');
                if (!href) return false;
                const targetId = href.slice(1);

                // Search by persisted id attr OR by on-the-fly generated id
                let targetPos: number | null = null;
                const slugify = (text: string) => text.toLowerCase()
                  .replace(/[^\w\s가-힣-]/g, '').replace(/\s+/g, '-')
                  .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
                const getText = (n: any): string => {
                  if (n.isText) return n.text || '';
                  let t = '';
                  n.content?.forEach((c: any) => { t += getText(c); });
                  return t;
                };

                let imgCnt = 0;
                let tblCnt = 0;
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
                });

                if (targetPos !== null) {
                  event.preventDefault();
                  const dom = view.nodeDOM(targetPos);
                  if (dom && dom instanceof HTMLElement) {
                    dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
