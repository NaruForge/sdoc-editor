import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { all, createLowlight } from 'lowlight';
import CodeBlockComponent from './CodeBlockComponent';

const lowlight = createLowlight(all);

export const CustomCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },
}).configure({
  lowlight,
});
