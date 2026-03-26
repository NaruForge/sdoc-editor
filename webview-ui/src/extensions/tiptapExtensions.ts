import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { CustomTable } from './CustomTable';
import { CustomImage } from './CustomImage';
import { MathInline } from './MathInline';
import { MathBlock } from './MathBlock';

/**
 * Custom keyboard shortcuts for heading level changes:
 * - Tab: increase heading level (h1→h2→h3) or convert paragraph to h1
 * - Shift+Tab: decrease heading level (h3→h2→h1) or convert h1 to paragraph
 */
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
    history: false, // Disable Tiptap's built-in history (using VS Code undo)
  }),
  Underline,
  Link.configure({
    openOnClick: false, // Don't open links on click in editor
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
  HeadingKeyboardShortcuts,
];
