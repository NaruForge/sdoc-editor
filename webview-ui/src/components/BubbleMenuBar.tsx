import React, { useRef } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import { Bold, Italic, Underline, Code, Unlink, Highlighter, Palette } from 'lucide-react';

interface BubbleMenuBarProps {
  editor: Editor;
}

const TEXT_COLORS = [
  { label: '기본', value: '' },
  { label: 'LG Red', value: '#A50034' },
  { label: '빨강', value: '#ef4444' },
  { label: '주황', value: '#f97316' },
  { label: '노랑', value: '#eab308' },
  { label: '초록', value: '#22c55e' },
  { label: '파랑', value: '#3b82f6' },
  { label: '보라', value: '#a855f7' },
  { label: '회색', value: '#6b7280' },
];

const HIGHLIGHT_COLORS = [
  { label: '없음', value: '' },
  { label: '노랑', value: '#fef08a' },
  { label: '초록', value: '#bbf7d0' },
  { label: '하늘', value: '#bae6fd' },
  { label: '분홍', value: '#fbcfe8' },
  { label: '주황', value: '#fed7aa' },
  { label: '보라', value: '#e9d5ff' },
];

export const BubbleMenuBar: React.FC<BubbleMenuBarProps> = ({ editor }) => {
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = React.useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

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
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}
        className={editor.isActive('code') ? 'is-active' : ''}
        title="Code"
      >
        <Code size={14} />
      </button>

      {/* 텍스트 컬러 */}
      <div ref={colorRef} style={{ position: 'relative' }}>
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowColorPicker(v => !v); setShowHighlightPicker(false); }}
          className={currentColor ? 'is-active' : ''}
          title="텍스트 색상"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
        >
          <Palette size={14} />
          <div style={{ width: 14, height: 3, borderRadius: 2, background: currentColor || 'currentColor', opacity: currentColor ? 1 : 0.4 }} />
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
      <div ref={highlightRef} style={{ position: 'relative' }}>
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowHighlightPicker(v => !v); setShowColorPicker(false); }}
          className={editor.isActive('highlight') ? 'is-active' : ''}
          title="하이라이트"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
        >
          <Highlighter size={14} />
          <div style={{ width: 14, height: 3, borderRadius: 2, background: currentHighlight || '#fef08a', opacity: editor.isActive('highlight') ? 1 : 0.4 }} />
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
