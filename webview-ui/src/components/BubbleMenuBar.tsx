import React from 'react';
import { BubbleMenu, Editor } from '@tiptap/react';
import { Bold, Italic, Underline, Code, Unlink } from 'lucide-react';

interface BubbleMenuBarProps {
  editor: Editor;
}

export const BubbleMenuBar: React.FC<BubbleMenuBarProps> = ({ editor }) => {
  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100, placement: 'top' }}
      className="bubble-menu"
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
        className={editor.isActive('bold') ? 'is-active' : ''}
        title="Bold"
      >
        <Bold size={14} />
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
        className={editor.isActive('italic') ? 'is-active' : ''}
        title="Italic"
      >
        <Italic size={14} />
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleUnderline().run();
        }}
        className={editor.isActive('underline') ? 'is-active' : ''}
        title="Underline"
      >
        <Underline size={14} />
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleCode().run();
        }}
        className={editor.isActive('code') ? 'is-active' : ''}
        title="Code"
      >
        <Code size={14} />
      </button>
      {editor.isActive('link') && (
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().unsetLink().run();
          }}
          className="unlink-button"
          title="Remove Link"
        >
          <Unlink size={14} />
        </button>
      )}
    </BubbleMenu>
  );
};
