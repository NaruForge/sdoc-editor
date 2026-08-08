import { Extension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { buildNumberingIndex } from '../document/numbering';
import type { TiptapNode } from '../types';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionOptions,
  type EditorExtensionRuntime,
} from './extensionRuntime';
import { Callout } from './extensions/Callout';
import { CustomCodeBlock } from './extensions/CodeBlockView';
import { CustomImage } from './extensions/CustomImage';
import { CustomTable } from './extensions/CustomTable';
import { DiagramBlock } from './extensions/DiagramBlock';
import { MathBlock } from './extensions/MathBlock';
import { MathInline } from './extensions/MathInline';

const BookPreviewHeadingAttributes = Extension.create({
  name: 'bookPreviewHeadingAttributes',
  addGlobalAttributes() {
    return [{
      types: ['heading'],
      attributes: {
        id: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('id') || element.getAttribute('data-id'),
          renderHTML: (attributes: Record<string, unknown>) =>
            typeof attributes.id === 'string' && attributes.id ? { id: attributes.id } : {},
        },
        numbered: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-numbered') !== 'false',
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.numbered === false ? { 'data-numbered': 'false' } : {},
        },
      },
    }];
  },
});

function numberingDecorations(
  doc: ProseMirrorNode,
  runtime: EditorExtensionRuntime,
): DecorationSet {
  const settings = runtime.getSettings();
  const index = buildNumberingIndex(doc.toJSON() as TiptapNode, {
    headingNumbering: settings.headingNumbering,
    headingStartNumber: settings.headingStartNumber,
    captionNumbering: settings.captionNumbering,
    equationNumbering: settings.equationNumbering,
    captionStyle: settings.captionStyle,
    crossRefIncludeCaption: settings.crossRefIncludeCaption,
  });
  const decorations: Decoration[] = [];
  const visit = (node: ProseMirrorNode, position: number, path: number[]): void => {
    if (node.type.name === 'heading') {
      const entry = index.byPath.get(path.join('.'));
      if (entry?.numbered) {
        decorations.push(Decoration.node(position, position + node.nodeSize, {
          'data-number-label': entry.number,
        }));
      }
    }
    const contentStart = node.type.name === 'doc' ? position : position + 1;
    node.forEach((child, offset, childIndex) => {
      visit(child, contentStart + offset, [...path, childIndex]);
    });
  };
  visit(doc, 0, []);
  return DecorationSet.create(doc, decorations);
}

const BookPreviewNumbering = Extension.create<EditorExtensionOptions>({
  name: 'bookPreviewNumbering',
  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },
  addProseMirrorPlugins() {
    const runtime = this.options.runtime;
    return [new Plugin({
      props: {
        decorations: (state) => numberingDecorations(state.doc, runtime),
      },
    })];
  },
});

/** Browser-safe shared extension set for immutable composed Book previews. */
export function createBookPreviewExtensions(runtime: EditorExtensionRuntime) {
  return [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: false } }),
    BookPreviewHeadingAttributes,
    BookPreviewNumbering.configure({ runtime }),
    Callout.configure({ runtime }),
    CustomCodeBlock.configure({ runtime } as Partial<typeof CustomCodeBlock.options> & {
      runtime: EditorExtensionRuntime;
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
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
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ];
}
