import React, { useRef } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor, useEditorState } from '@tiptap/react';
import { Bold, Italic, Underline, Code, Pencil, Highlighter, Palette, Strikethrough, Subscript, Superscript, Quote } from 'lucide-react';
import { TEXT_COLORS, HIGHLIGHT_COLORS } from '../constants/colors';
import { CALLOUT_ICONS, type CalloutVariant } from '@shared/editor/extensions/Callout';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

interface BubbleMenuBarProps {
  editor: Editor;
  onEditLink?: () => void;
}

const TEXT_COLOR_KEYS: readonly EditorTranslationKey[] = [
  'color.default', 'color.blueDefault', 'color.red', 'color.orange', 'color.yellow',
  'color.green', 'color.blue', 'color.purple', 'color.gray',
];

const HIGHLIGHT_COLOR_KEYS: readonly EditorTranslationKey[] = [
  'color.none', 'color.yellow', 'color.green', 'color.sky',
  'color.pink', 'color.orange', 'color.purple',
];

const CALLOUT_LABEL_KEYS: Record<CalloutVariant, EditorTranslationKey> = {
  note: 'callout.note',
  info: 'callout.info',
  tip: 'callout.tip',
  warning: 'callout.warning',
  danger: 'callout.danger',
};

export const BubbleMenuBar: React.FC<BubbleMenuBarProps> = ({ editor, onEditLink }) => {
  const { t } = useEditorI18n();
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
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={activeState.bold ? 'is-active' : ''}
        title={t('toolbar.bold')}
        aria-label={t('toolbar.bold')}
        aria-pressed={activeState.bold}
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={activeState.italic ? 'is-active' : ''}
        title={t('toolbar.italic')}
        aria-label={t('toolbar.italic')}
        aria-pressed={activeState.italic}
      >
        <Italic size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={activeState.underline ? 'is-active' : ''}
        title={t('toolbar.underline')}
        aria-label={t('toolbar.underline')}
        aria-pressed={activeState.underline}
      >
        <Underline size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={activeState.strike ? 'is-active' : ''}
        title={t('toolbar.strikethrough')}
        aria-label={t('toolbar.strikethrough')}
        aria-pressed={activeState.strike}
      >
        <Strikethrough size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        className={activeState.subscript ? 'is-active' : ''}
        title={t('toolbar.subscript')}
        aria-label={t('toolbar.subscript')}
        aria-pressed={activeState.subscript}
      >
        <Subscript size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        className={activeState.superscript ? 'is-active' : ''}
        title={t('toolbar.superscript')}
        aria-label={t('toolbar.superscript')}
        aria-pressed={activeState.superscript}
      >
        <Superscript size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={activeState.code ? 'is-active' : ''}
        title={t('bubble.code')}
        aria-label={t('bubble.code')}
        aria-pressed={activeState.code}
      >
        <Code size={14} />
      </button>

      {/* 텍스트 컬러 */}
      <div ref={colorRef} className="toolbar-dropdown">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setShowColorPicker(v => !v); setShowHighlightPicker(false); }}
          className={`color-picker-btn ${activeState.textColor ? 'is-active' : ''}`}
          title={t('toolbar.textColor')}
          aria-label={t('toolbar.textColor')}
          aria-expanded={showColorPicker}
        >
          <Palette size={14} />
          <div className="color-indicator" style={{ width: 14, background: activeState.textColor || 'currentColor', opacity: activeState.textColor ? 1 : 0.4 }} />
        </button>
        {showColorPicker && (
          <div className="bubble-color-picker" onMouseDown={e => e.preventDefault()}>
            {TEXT_COLORS.map(({ value }, index) => (
              <button
                type="button"
                key={value}
                title={t(TEXT_COLOR_KEYS[index])}
                aria-label={t(TEXT_COLOR_KEYS[index])}
                className={activeState.textColor === value ? 'is-active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
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
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setShowHighlightPicker(v => !v); setShowColorPicker(false); }}
          className={`color-picker-btn ${activeState.highlight ? 'is-active' : ''}`}
          title={t('toolbar.highlight')}
          aria-label={t('toolbar.highlight')}
          aria-expanded={showHighlightPicker}
        >
          <Highlighter size={14} />
          <div className="color-indicator" style={{ width: 14, background: activeState.highlightColor || '#fef08a', opacity: activeState.highlight ? 1 : 0.4 }} />
        </button>
        {showHighlightPicker && (
          <div className="bubble-color-picker" onMouseDown={e => e.preventDefault()}>
            {HIGHLIGHT_COLORS.map(({ value }, index) => (
              <button
                type="button"
                key={value}
                title={t(HIGHLIGHT_COLOR_KEYS[index])}
                aria-label={t(HIGHLIGHT_COLOR_KEYS[index])}
                className={activeState.highlightColor === value ? 'is-active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
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

      {activeState.link && onEditLink && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onEditLink}
          className="unlink-button"
          title={t('link.editTitle')}
          aria-label={t('link.editTitle')}
        >
          <Pencil size={14} />
        </button>
      )}

      {/* Blockquote 토글 */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={activeState.blockquote ? 'is-active' : ''}
        title={t('toolbar.blockquote')}
        aria-label={t('toolbar.blockquote')}
        aria-pressed={activeState.blockquote}
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
                type="button"
                key={variant}
                title={t('bubble.calloutVariant', { variant: t(CALLOUT_LABEL_KEYS[variant]) })}
                aria-label={t('bubble.calloutVariant', { variant: t(CALLOUT_LABEL_KEYS[variant]) })}
                aria-pressed={activeState.calloutVariant === variant}
                className={`callout-variant-btn ${activeState.calloutVariant === variant ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
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
