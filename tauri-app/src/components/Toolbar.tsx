import React, { useState, useRef, useEffect } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  ListChecks,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Table2,
  Trash2,
  PenTool,
  Image as ImageIcon,
  Link as LinkIcon,
  Sigma,
  Plus,
  ChevronRight,
  Hash,
  Palette,
  Highlighter,
  Strikethrough,
  Subscript,
  Superscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  GitGraph,
  Quote,
  MessageSquareWarning,
  MoreHorizontal,
} from 'lucide-react';
import { CALLOUT_ICONS, CALLOUT_LABELS, type CalloutVariant } from '../extensions/Callout';
import { TEXT_COLORS, HIGHLIGHT_COLORS } from '../constants/colors';

interface ToolbarProps {
  editor: TiptapEditor | null;
  onInsertDrawio?: () => void;
  onInsertImage?: () => void;
  onInsertLink?: () => void;
  onInsertMath?: () => void;
  onInsertDiagram?: () => void;
  onInsertCrossRef?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  editor,
  onInsertDrawio,
  onInsertImage,
  onInsertLink,
  onInsertMath,
  onInsertDiagram,
  onInsertCrossRef,
}) => {
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [insertQuery, setInsertQuery] = useState('');
  const [showTableSub, setShowTableSub] = useState(false);
  const [showCalloutSub, setShowCalloutSub] = useState(false);
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showAlignMenu, setShowAlignMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const highlightPickerRef = useRef<HTMLDivElement>(null);
  const [customRows, setCustomRows] = useState('3');
  const [customCols, setCustomCols] = useState('3');
  const insertMenuRef = useRef<HTMLDivElement>(null);
  const alignMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const [, forceToolbarUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => forceToolbarUpdate(v => v + 1);
    editor.on('transaction', handler);
    return () => { editor.off('transaction', handler); };
  }, [editor]);

  // Close menus on outside click
  useEffect(() => {
    const targets: { open: boolean; ref: React.RefObject<HTMLDivElement | null>; close: () => void }[] = [
      { open: showInsertMenu, ref: insertMenuRef, close: closeInsertMenu },
      { open: showAlignMenu, ref: alignMenuRef, close: () => setShowAlignMenu(false) },
      { open: showMoreMenu, ref: moreMenuRef, close: () => setShowMoreMenu(false) },
    ];
    const active = targets.filter(t => t.open);
    if (!active.length) return;
    const handleClick = (e: MouseEvent) => {
      active.forEach(({ ref, close }) => {
        if (ref.current && !ref.current.contains(e.target as Node)) close();
      });
    };
    const id = requestAnimationFrame(() => document.addEventListener('mousedown', handleClick));
    return () => { cancelAnimationFrame(id); document.removeEventListener('mousedown', handleClick); };
  }, [showInsertMenu, showAlignMenu, showMoreMenu]);

  if (!editor) return null;

  const Btn: React.FC<{
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    title?: string;
  }> = ({ onClick, isActive, disabled, children, title }) => (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      disabled={disabled}
      title={title}
      className={`toolbar-button ${isActive ? 'is-active' : ''}`}
    >
      {children}
    </button>
  );

  const insertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    closeInsertMenu();
  };

  function closeInsertMenu() {
    setShowInsertMenu(false);
    setShowTableSub(false);
    setShowCalloutSub(false);
    setShowCustomSize(false);
    setInsertQuery('');
  }

  const insertActions: { label: string; keywords: string; icon: React.ReactNode; run: () => void }[] = [
    { label: '표', keywords: 'table 표 그리드', icon: <Table2 size={15} />, run: () => insertTable(3, 3) },
    ...(onInsertImage ? [{ label: '이미지', keywords: 'image picture 이미지 그림 사진', icon: <ImageIcon size={15} />, run: onInsertImage }] : []),
    ...(onInsertDrawio ? [{ label: 'Draw.io 다이어그램', keywords: 'drawio diagram 다이어그램 도형', icon: <PenTool size={15} />, run: onInsertDrawio }] : []),
    ...(onInsertMath ? [{ label: '수식', keywords: 'math equation 수식 latex katex', icon: <Sigma size={15} />, run: onInsertMath }] : []),
    { label: '코드 블록', keywords: 'code 코드 block 프로그램', icon: <Code size={15} />, run: () => editor.chain().focus().toggleCodeBlock().run() },
    ...(onInsertDiagram ? [{ label: '다이어그램 (Mermaid)', keywords: 'mermaid diagram 다이어그램 차트', icon: <GitGraph size={15} />, run: onInsertDiagram }] : []),
    { label: '수평선', keywords: 'hr horizontal rule 수평선 구분선', icon: <span style={{ fontSize: '15px', lineHeight: '15px', width: '15px', textAlign: 'center' }}>—</span>, run: () => editor.chain().focus().setHorizontalRule().run() },
    ...(Object.entries(CALLOUT_ICONS) as [CalloutVariant, string][]).map(([variant, icon]) => ({
      label: `콜아웃 · ${CALLOUT_LABELS[variant]}`,
      keywords: `callout 콜아웃 ${variant} ${CALLOUT_LABELS[variant]}`,
      icon: <span>{icon}</span>,
      run: () => editor.chain().focus().insertContent({ type: 'callout', attrs: { variant }, content: [{ type: 'paragraph' }] }).run(),
    })),
    ...(onInsertCrossRef ? [{ label: '교차 참조', keywords: 'crossref reference 교차 참조 링크 anchor', icon: <Hash size={15} />, run: onInsertCrossRef }] : []),
  ];

  const insertQ = insertQuery.trim().toLowerCase();
  const filteredInsertActions = insertQ
    ? insertActions.filter(a => a.label.toLowerCase().includes(insertQ) || a.keywords.toLowerCase().includes(insertQ))
    : [];

  // Active alignment icon
  const activeAlign = editor.isActive({ textAlign: 'center' }) ? <AlignCenter size={16} />
    : editor.isActive({ textAlign: 'right' }) ? <AlignRight size={16} />
    : editor.isActive({ textAlign: 'justify' }) ? <AlignJustify size={16} />
    : <AlignLeft size={16} />;

  return (
    <div className="toolbar">

      {/* ── 인라인 서식 ──────────────────────────────────── */}
      <Btn onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="굵게 (Ctrl+B)">
        <Bold size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="기울임 (Ctrl+I)">
        <Italic size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="밑줄 (Ctrl+U)">
        <UnderlineIcon size={16} />
      </Btn>
      {onInsertLink && (
        <Btn onClick={onInsertLink} isActive={editor.isActive('link')} title="링크 삽입 (Ctrl+K)">
          <LinkIcon size={16} />
        </Btn>
      )}

      {/* 텍스트 색상 */}
      <div ref={colorPickerRef} className="toolbar-dropdown">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowColorPicker(v => !v); setShowHighlightPicker(false); }}
          title="텍스트 색상"
          className={`toolbar-button color-picker-btn ${editor.isActive('textStyle') && editor.getAttributes('textStyle').color ? 'is-active' : ''}`}
        >
          <Palette size={16} />
          <div className="color-indicator" style={{ width: 16, background: editor.getAttributes('textStyle').color || 'currentColor', opacity: editor.getAttributes('textStyle').color ? 1 : 0.4 }} />
        </button>
        {showColorPicker && (
          <div className="bubble-color-picker" style={{ top: '100%', left: 0 }} onMouseDown={e => e.preventDefault()}>
            {TEXT_COLORS.map(({ label, value }) => (
              <button key={value} title={label} className={editor.getAttributes('textStyle').color === value ? 'is-active' : ''}
                onMouseDown={(e) => { e.preventDefault(); if (value) editor.chain().focus().setColor(value).run(); else editor.chain().focus().unsetColor().run(); setShowColorPicker(false); }}
                style={{ background: value || 'transparent', border: value ? 'none' : '1px solid #555' }}>
                {!value && <span style={{ fontSize: 10, color: '#aaa' }}>✕</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 하이라이트 */}
      <div ref={highlightPickerRef} className="toolbar-dropdown">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowHighlightPicker(v => !v); setShowColorPicker(false); }}
          title="하이라이트"
          className={`toolbar-button color-picker-btn ${editor.isActive('highlight') ? 'is-active' : ''}`}
        >
          <Highlighter size={16} />
          <div className="color-indicator" style={{ width: 16, background: editor.getAttributes('highlight').color || '#fef08a', opacity: editor.isActive('highlight') ? 1 : 0.4 }} />
        </button>
        {showHighlightPicker && (
          <div className="bubble-color-picker" style={{ top: '100%', left: 0 }} onMouseDown={e => e.preventDefault()}>
            {HIGHLIGHT_COLORS.map(({ label, value }) => (
              <button key={value} title={label} className={editor.getAttributes('highlight').color === value ? 'is-active' : ''}
                onMouseDown={(e) => { e.preventDefault(); if (value) editor.chain().focus().setHighlight({ color: value }).run(); else editor.chain().focus().unsetHighlight().run(); setShowHighlightPicker(false); }}
                style={{ background: value || 'transparent', border: value ? 'none' : '1px solid #555' }}>
                {!value && <span style={{ fontSize: 10, color: '#aaa' }}>✕</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 서식 더보기 (Strike / Sub / Super) */}
      <div ref={moreMenuRef} className="toolbar-dropdown">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowMoreMenu(v => !v); }}
          title="서식 더보기"
          className={`toolbar-button ${editor.isActive('strike') || editor.isActive('subscript') || editor.isActive('superscript') ? 'is-active' : ''}`}
        >
          <MoreHorizontal size={16} />
        </button>
        {showMoreMenu && (
          <div className="insert-menu" style={{ minWidth: '160px' }} onMouseDown={e => e.preventDefault()}>
            <button className={`insert-menu-item${editor.isActive('strike') ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); setShowMoreMenu(false); }}>
              <Strikethrough size={14} /><span>취소선</span>
            </button>
            <button className={`insert-menu-item${editor.isActive('subscript') ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleSubscript().run(); setShowMoreMenu(false); }}>
              <Subscript size={14} /><span>아래 첨자</span>
            </button>
            <button className={`insert-menu-item${editor.isActive('superscript') ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleSuperscript().run(); setShowMoreMenu(false); }}>
              <Superscript size={14} /><span>위 첨자</span>
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-separator" />

      {/* ── 헤딩 ─────────────────────────────────────────── */}
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} isActive={editor.isActive('heading', { level: 1 })} title="제목 1 (H1)">
        <Heading1 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor.isActive('heading', { level: 2 })} title="제목 2 (H2)">
        <Heading2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} isActive={editor.isActive('heading', { level: 3 })} title="제목 3 (H3)">
        <Heading3 size={16} />
      </Btn>
      <Btn
        onClick={() => {
          const isUnnumbered = editor.getAttributes('heading').numbered === false;
          editor.chain().focus().updateAttributes('heading', { numbered: isUnnumbered ? null : false }).run();
        }}
        isActive={editor.isActive('heading') && editor.getAttributes('heading').numbered === false}
        disabled={!editor.isActive('heading')}
        title="번호 제외 (Introduction, Glossary 등 번호가 필요 없는 제목)"
      >
        <Hash size={16} />
      </Btn>

      <div className="toolbar-separator" />

      {/* ── 정렬 드롭다운 ─────────────────────────────────── */}
      <div ref={alignMenuRef} className="toolbar-dropdown">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowAlignMenu(v => !v); }}
          title="텍스트 정렬"
          className="toolbar-button"
        >
          {activeAlign}
          <ChevronRight size={10} style={{ transform: 'rotate(90deg)', marginLeft: 2 }} />
        </button>
        {showAlignMenu && (
          <div className="insert-menu" style={{ minWidth: '140px' }} onMouseDown={e => e.preventDefault()}>
            {([
              { align: 'left', icon: <AlignLeft size={14} />, label: '왼쪽 정렬' },
              { align: 'center', icon: <AlignCenter size={14} />, label: '가운데 정렬' },
              { align: 'right', icon: <AlignRight size={14} />, label: '오른쪽 정렬' },
              { align: 'justify', icon: <AlignJustify size={14} />, label: '양쪽 정렬' },
            ] as const).map(({ align, icon, label }) => (
              <button
                key={align}
                className={`insert-menu-item${editor.isActive({ textAlign: align }) ? ' is-active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign(align).run(); setShowAlignMenu(false); }}
              >
                {icon}<span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar-separator" />

      {/* ── 리스트 / 블록 ─────────────────────────────────── */}
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} title="글머리 목록">
        <List size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title="번호 목록">
        <ListOrdered size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} isActive={editor.isActive('taskList')} title="할 일 목록">
        <ListChecks size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editor.isActive('blockquote')} title="인용 블록">
        <Quote size={16} />
      </Btn>

      <div className="toolbar-separator" />

      {/* ── 삽입 메뉴 ─────────────────────────────────────── */}
      <div ref={insertMenuRef} className="toolbar-dropdown">
        <Btn onClick={() => setShowInsertMenu(!showInsertMenu)} title="삽입...">
          <Plus size={16} />
          <span style={{ marginLeft: '4px' }}>삽입</span>
        </Btn>
        {showInsertMenu && (
          <div className="insert-menu">
            <input
              type="text"
              className="insert-menu-search"
              placeholder="삽입할 항목 검색..."
              value={insertQuery}
              autoFocus
              onChange={(e) => setInsertQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            />
            {insertQ ? (
              <>
                {filteredInsertActions.length === 0 && (
                  <div className="insert-menu-empty">일치하는 항목이 없습니다</div>
                )}
                {filteredInsertActions.map((action) => (
                  <button
                    key={action.label}
                    className="insert-menu-item"
                    onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); action.run(); }}
                  >
                    {action.icon}<span>{action.label}</span>
                  </button>
                ))}
              </>
            ) : (
            <>
            {/* Table */}
            <div className="insert-menu-item has-sub"
              onMouseEnter={() => setShowTableSub(true)}
              onMouseLeave={() => { setShowTableSub(false); setShowCustomSize(false); }}>
              <Table2 size={15} /><span>표</span>
              <ChevronRight size={14} className="insert-menu-arrow" />
              {showTableSub && (
                <div className="insert-submenu">
                  <div style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>크기 선택</div>
                  {[3, 5, 7, 10].map(size => (
                    <button key={size} className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); insertTable(size, size); }}>
                      {size} × {size}
                    </button>
                  ))}
                  <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowCustomSize(true); }}>
                    사용자 정의...
                  </button>
                  {showCustomSize && (
                    <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input type="number" min="1" max="50" value={customRows} onChange={(e) => setCustomRows(e.target.value)} className="insert-size-input" placeholder="행" />
                        <span style={{ fontSize: '12px' }}>×</span>
                        <input type="number" min="1" max="50" value={customCols} onChange={(e) => setCustomCols(e.target.value)} className="insert-size-input" placeholder="열" />
                      </div>
                      <button className="insert-menu-item" style={{ textAlign: 'center', fontWeight: 'bold' }}
                        onMouseDown={(e) => { e.preventDefault(); const r = parseInt(customRows), c = parseInt(customCols); if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && r <= 50 && c <= 50) insertTable(r, c); }}>
                        삽입
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {onInsertImage && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertImage(); }}>
                <ImageIcon size={15} /><span>이미지</span>
              </button>
            )}
            {onInsertDrawio && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertDrawio(); }}>
                <PenTool size={15} /><span>Draw.io 다이어그램</span>
              </button>
            )}
            {onInsertMath && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertMath(); }}>
                <Sigma size={15} /><span>수식</span>
              </button>
            )}
            <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); editor.chain().focus().toggleCodeBlock().run(); }}>
              <Code size={15} /><span>코드 블록</span>
            </button>
            {onInsertDiagram && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertDiagram(); }}>
                <GitGraph size={15} /><span>다이어그램 (Mermaid)</span>
              </button>
            )}
            <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); editor.chain().focus().setHorizontalRule().run(); }}>
              <span style={{ fontSize: '15px', lineHeight: '15px', width: '15px', textAlign: 'center' }}>—</span>
              <span>수평선</span>
            </button>

            {/* Callout */}
            <div className="insert-menu-item has-sub"
              onMouseEnter={() => setShowCalloutSub(true)}
              onMouseLeave={() => setShowCalloutSub(false)}>
              <MessageSquareWarning size={15} /><span>콜아웃</span>
              <ChevronRight size={14} className="insert-menu-arrow" />
              {showCalloutSub && (
                <div className="insert-submenu">
                  {(Object.entries(CALLOUT_ICONS) as [CalloutVariant, string][]).map(([variant, icon]) => (
                    <button key={variant} className="insert-menu-item"
                      onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); editor.chain().focus().insertContent({ type: 'callout', attrs: { variant }, content: [{ type: 'paragraph' }] }).run(); }}>
                      <span>{icon}</span><span>{CALLOUT_LABELS[variant]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {onInsertCrossRef && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertCrossRef(); }}>
                <Hash size={15} /><span>교차 참조</span>
              </button>
            )}
            </>
            )}
          </div>
        )}
      </div>

      {/* 표 삭제 — 표 내부일 때만 표시 */}
      {editor.isActive('table') && (
        <Btn onClick={() => editor.chain().focus().deleteTable().run()} title="표 삭제">
          <Trash2 size={16} />
        </Btn>
      )}

    </div>
  );
};
