import React from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import { Bold, Italic, Underline, Code, Unlink, Strikethrough, Subscript, Superscript } from 'lucide-react';

interface BubbleMenuBarProps {
  editor: Editor;
}

export const BubbleMenuBar: React.FC<BubbleMenuBarProps> = ({ editor }) => {
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 6 }}
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
          editor.chain().focus().toggleStrike().run();
        }}
        className={editor.isActive('strike') ? 'is-active' : ''}
        title="Strikethrough"
      >
        <Strikethrough size={14} />
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleSubscript().run();
        }}
        className={editor.isActive('subscript') ? 'is-active' : ''}
        title="Subscript"
      >
        <Subscript size={14} />
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleSuperscript().run();
        }}
        className={editor.isActive('superscript') ? 'is-active' : ''}
        title="Superscript"
      >
        <Superscript size={14} />
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
