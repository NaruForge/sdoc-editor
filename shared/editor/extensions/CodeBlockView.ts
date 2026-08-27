import { CodeBlock, type CodeBlockOptions } from '@tiptap/extension-code-block';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { all, createLowlight } from 'lowlight';
import type { EditorExtensionRuntime } from '../extensionRuntime';
import CodeBlockComponent from './CodeBlockComponent';
import {
  createOptimizedLowlightPlugin,
  type LowlightLike,
} from './optimizedLowlightPlugin';

const lowlight = createLowlight(all);

interface CustomCodeBlockOptions extends CodeBlockOptions {
  lowlight: LowlightLike;
  runtime?: EditorExtensionRuntime;
}

export const CustomCodeBlock = CodeBlock.extend<CustomCodeBlockOptions>({
  addOptions() {
    const parent = this.parent?.();
    if (!parent) throw new Error('CodeBlock parent options are unavailable');
    return {
      ...parent,
      lowlight,
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      createOptimizedLowlightPlugin({
        name: this.name,
        lowlight: this.options.lowlight,
        defaultLanguage: this.options.defaultLanguage,
      }),
    ];
  },
});
