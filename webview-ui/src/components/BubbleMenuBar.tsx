import React, { useRef } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor, useEditorState } from '@tiptap/react';
import { Bold, Italic, Underline, Code, Unlink, Highlighter, Palette, Strikethrough, Subscript, Superscript, Quote } from 'lucide-react';
import { TEXT_COLORS, HIGHLIGHT_COLORS } from '../constants/colors';
import { CALLOUT_ICONS, CALLOUT_LABELS, type CalloutVariant } from '../extensions/Callout';

interface BubbleMenuBarProps {
  editor: Editor;
}

export const BubbleMenuBar: React.FC<BubbleMenuBarProps> = ({ editor }) => {
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = React.useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const activeState = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive('bold'),
      italic: ctx.editor.isActive('italic'),
      underline: ctx.editor.isActive('underline'),
      strike: ctx.editor.isActive('strike'),
      subscript: ctx.editor.isActive('subscript'),
      superscript: ctx.editor.isActive('superscript'),
      code: ctx.editor.isActive('code'),
      highlight: ctx.editor.isActive('highlight'),
      link: ctx.editor.isActive('link'),
      blockquote: ctx.editor.isActive('blockquote'),
      callout: ctx.editor.isActive('callout'),
      calloutVariant: (ctx.editor.getAttributes('callout').variant as CalloutVariant) || null,
      textColor: (ctx.editor.getAttributes('textStyle').color as string) || '',
      highlightColor: (ctx.editor.getAttributes('highlight').color as string) || '',
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 6 }}
      className="bubble-menu"
    >
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        className={activeState.bold ? 'is-active' : ''}
        title="Bold"
      >
        <Bold size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={activeState.italic ? 'is-active' : ''}
        title="Italic"
      >
        <Italic size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
        className={activeState.underline ? 'is-active' : ''}
        title="Underline"
      >
        <Underline size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}
        className={activeState.strike ? 'is-active' : ''}
        title="Strikethrough"
      >
        <Strikethrough size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleSubscript().run(); }}
        className={activeState.subscript ? 'is-active' : ''}
        title="Subscript"
      >
        <Subscript size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleSuperscript().run(); }}
        className={activeState.superscript ? 'is-active' : ''}
        title="Superscript"
      >
        <Superscript size={14} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}
        className={activeState.code ? 'is-active' : ''}
        title="Code"
      >
        <Code size={14} />
      </button>

      {/* 텍스트 컬러 */}
      <div ref={colorRef} className="toolbar-dropdown">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowColorPicker(v => !v); setShowHighlightPicker(false); }}
          className={`color-picker-btn ${activeState.textColor ? 'is-active' : ''}`}
          title="텍스트 색상"
        >
          <Palette size={14} />
          <div className="color-indicator" style={{ width: 14, background: activeState.textColor || 'currentColor', opacity: activeState.textColor ? 1 : 0.4 }} />
        </button>
        {showColorPicker && (
          <div className="bubble-color-picker" onMouseDown={e => e.preventDefault()}>
            {TEXT_COLORS.map(({ label, value }) => (
              <button
                key={value}
                title={label}
                className={activeState.textColor === value ? 'is-active' : ''}
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
          className={`color-picker-btn ${activeState.highlight ? 'is-active' : ''}`}
          title="하이라이트"
        >
          <Highlighter size={14} />
          <div className="color-indicator" style={{ width: 14, background: activeState.highlightColor || '#fef08a', opacity: activeState.highlight ? 1 : 0.4 }} />
        </button>
        {showHighlightPicker && (
          <div className="bubble-color-picker" onMouseDown={e => e.preventDefault()}>
            {HIGHLIGHT_COLORS.map(({ label, value }) => (
              <button
                key={value}
                title={label}
                className={activeState.highlightColor === value ? 'is-active' : ''}
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

      {activeState.link && (
        <button
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetLink().run(); }}
          className="unlink-button"
          title="Remove Link"
        >
          <Unlink size={14} />
        </button>
      )}

      {/* Blockquote 토글 */}
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}
        className={activeState.blockquote ? 'is-active' : ''}
        title="Blockquote"
      >
        <Quote size={14} />
      </button>

      {/* Callout variant 선택 */}
      {activeState.callout && (
        <>
          <div className="bubble-menu-separator" />
          <div className="callout-variant-picker">
            {(Object.entries(CALLOUT_ICONS) as [CalloutVariant, string][]).map(([variant, icon]) => (
              <button
                key={variant}
                title={CALLOUT_LABELS[variant]}
                className={`callout-variant-btn ${activeState.calloutVariant === variant ? 'is-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().updateAttributes('callout', { variant }).run();
                }}
              >
                {icon}
              </button>
            ))}
          </div>
        </>
      )}
    </BubbleMenu>
  );
};
