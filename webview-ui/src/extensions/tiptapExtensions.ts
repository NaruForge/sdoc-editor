import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { CustomTable } from './CustomTable';
import { CustomImage } from './CustomImage';

export const tiptapExtensions = [
  StarterKit.configure({
    history: false, // Disable Tiptap's built-in history (using VS Code undo)
  }),
  Underline,
  CustomImage,
  CustomTable,
  TableRow,
  TableHeader,
  TableCell,
];
