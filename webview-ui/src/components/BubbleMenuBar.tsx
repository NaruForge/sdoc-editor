import React, { useRef, useState, useEffect } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import { Bold, Italic, Underline, Code, Unlink, Highlighter, Palette, Strikethrough, Subscript, Superscript } from 'lucide-react';
import { TEXT_COLORS, HIGHLIGHT_COLORS } from '../constants/colors';

interface BubbleMenuBarProps {
  editor: Editor;
}

export const BubbleMenuBar: React.FC<BubbleMenuBarProps> = ({ editor }) => {
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = React.useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Re-render on editor transaction to reflect active formatting state
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const handler = () => forceUpdate(v => v + 1);
    editor.on('transaction', handler);
    return () => { editor.off('transaction', handler); };
  }, [editor]);

  const currentColor = editor.getAttributes('textStyle').color || '';
  const currentHighlight = editor.getAttributes('highlight').color || '';

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 6 }}
      className="bubble-menu"
    >
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        className={editor.isActive('bold') ? 'is-active' : ''}
        title="Bold"
      >
        <Bold size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={editor.isActive('italic') ? 'is-active' : ''}
        title="Italic"
      >
        <Italic size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
        className={editor.isActive('underline') ? 'is-active' : ''}
        title="Underline"
      >
        <Underline size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}
        className={editor.isActive('strike') ? 'is-active' : ''}
        title="Strikethrough"
      >
        <Strikethrough size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleSubscript().run(); }}
        className={editor.isActive('subscript') ? 'is-active' : ''}
        title="Subscript"
      >
        <Subscript size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleSuperscript().run(); }}
        className={editor.isActive('superscript') ? 'is-active' : ''}
        title="Superscript"
      >
        <Superscript size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}
        className={editor.isActive('code') ? 'is-active' : ''}
        title="Code"
      >
        <Code size={14} />
      </button>

      {/* 텍스트 컬러 */}
      <div ref={colorRef} className="toolbar-dropdown">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowColorPicker(v => !v); setShowHighlightPicker(false); }}
          className={`color-picker-btn ${currentColor ? 'is-active' : ''}`}
          title="텍스트 색상"
        >
          <Palette size={14} />
          <div className="color-indicator" style={{ width: 14, background: currentColor || 'currentColor', opacity: currentColor ? 1 : 0.4 }} />
        </button>
        {showColorPicker && (
          <div className="bubble-color-picker" onMouseDown={e => e.preventDefault()}>
            {TEXT_COLORS.map(({ label, value }) => (
              <button
                key={value}
                title={label}
                className={currentColor === value ? 'is-active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (value) {
                    editor.chain().focus().setColor(value).run();
                  } else {
                    editor.chain().focus().unsetColor().run();
                  }
                  setShowColorPicker(false);
                }}
                style={{ background: value || 'transparent', border: value ? 'none' : '1px solid #555' }}
              >
                {!value && <span style={{ fontSize: 10, color: '#aaa' }}>✕</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 하이라이트 */}
      <div ref={highlightRef} className="toolbar-dropdown">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowHighlightPicker(v => !v); setShowColorPicker(false); }}
          className={`color-picker-btn ${editor.isActive('highlight') ? 'is-active' : ''}`}
          title="하이라이트"
        >
          <Highlighter size={14} />
          <div className="color-indicator" style={{ width: 14, background: currentHighlight || '#fef08a', opacity: editor.isActive('highlight') ? 1 : 0.4 }} />
        </button>
        {showHighlightPicker && (
          <div className="bubble-color-picker" onMouseDown={e => e.preventDefault()}>
            {HIGHLIGHT_COLORS.map(({ label, value }) => (
              <button
                key={value}
                title={label}
                className={currentHighlight === value ? 'is-active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (value) {
                    editor.chain().focus().setHighlight({ color: value }).run();
                  } else {
                    editor.chain().focus().unsetHighlight().run();
                  }
                  setShowHighlightPicker(false);
                }}
                style={{ background: value || 'transparent', border: value ? 'none' : '1px solid #555' }}
              >
                {!value && <span style={{ fontSize: 10, color: '#aaa' }}>✕</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {editor.isActive('link') && (
        <button
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetLink().run(); }}
          className="unlink-button"
          title="Remove Link"
        >
          <Unlink size={14} />
        </button>
      )}
    </BubbleMenu>
  );
};
