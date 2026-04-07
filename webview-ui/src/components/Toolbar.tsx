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
  FileJson,
  ListOrdered as NumberIcon,
  PenTool,
  Image as ImageIcon,
  Link as LinkIcon,
  Sigma,
  Download,
  Upload,
  Plus,
  ChevronRight,
  Hash,
  RemoveFormatting,
  Palette,
  Highlighter,
  Strikethrough,
  Subscript,
  Superscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  BookOpen,
  GitGraph,
} from 'lucide-react';

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

interface ToolbarProps {
  editor: TiptapEditor | null;
  onViewJson?: () => void;
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  showToc: boolean;
  onToggleToc: () => void;
  onInsertDrawio?: () => void;
  onInsertImage?: () => void;
  onInsertLink?: () => void;
  onInsertMath?: () => void;
  onInsertDiagram?: () => void;
  onInsertCrossRef?: () => void;
  onExport?: (format: 'html' | 'adoc' | 'markdown' | 'pdf') => void;
  onImport?: (format: 'markdown' | 'html') => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ editor, onViewJson, showNumbering, onToggleNumbering, showDecoration, onToggleDecoration, showToc, onToggleToc, onInsertDrawio, onInsertImage, onInsertLink, onInsertMath, onInsertDiagram, onInsertCrossRef, onExport, onImport }) => {
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [showTableSub, setShowTableSub] = useState(false);
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const highlightPickerRef = useRef<HTMLDivElement>(null);
  const [customRows, setCustomRows] = useState('3');
  const [customCols, setCustomCols] = useState('3');
  const insertMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  // Force re-render on every editor transaction so toolbar always reflects current state
  const [, forceToolbarUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => forceToolbarUpdate(v => v + 1);
    editor.on('transaction', handler);
    return () => { editor.off('transaction', handler); };
  }, [editor]);

  // Close insert menu when clicking outside
  useEffect(() => {
    if (!showInsertMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (insertMenuRef.current && !insertMenuRef.current.contains(e.target as Node)) {
        setShowInsertMenu(false);
        setShowTableSub(false);
        setShowCustomSize(false);
      }
    };
    // Defer listener to next tick so the opening mousedown doesn't immediately close it
    const id = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClick);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [showInsertMenu]);

  if (!editor) {
    return null;
  }

  const Button: React.FC<{
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    title?: string;
  }> = ({ onClick, isActive, disabled, children, title }) => (
    <button
      onMouseDown={(e) => {
        e.preventDefault(); // Prevent focus loss
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`toolbar-button ${isActive ? 'is-active' : ''}`}
    >
      {children}
    </button>
  );

  const insertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setShowInsertMenu(false);
    setShowTableSub(false);
    setShowCustomSize(false);
  };

  const closeInsertMenu = () => {
    setShowInsertMenu(false);
    setShowTableSub(false);
    setShowCustomSize(false);
  };

  return (
    <div className="toolbar">
      {/* Text formatting */}
      <Button
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold (Ctrl+B)"
      >
        <Bold size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic (Ctrl+I)"
      >
        <Italic size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline (Ctrl+U)"
      >
        <UnderlineIcon size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <Strikethrough size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        isActive={editor.isActive('subscript')}
        title="Subscript"
      >
        <Subscript size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        isActive={editor.isActive('superscript')}
        title="Superscript"
      >
        <Superscript size={16} />
      </Button>
      {onInsertLink && (
        <Button
          onClick={onInsertLink}
          isActive={editor.isActive('link')}
          title="Insert Link (Ctrl+K)"
        >
          <LinkIcon size={16} />
        </Button>
      )}

      {/* 텍스트 색상 */}
      <div ref={colorPickerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            setShowColorPicker(v => !v);
            setShowHighlightPicker(false);
          }}
          title="텍스트 색상"
          className={`toolbar-button ${editor.isActive('textStyle') && editor.getAttributes('textStyle').color ? 'is-active' : ''}`}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
        >
          <Palette size={16} />
          <div style={{ width: 16, height: 3, borderRadius: 2, background: editor.getAttributes('textStyle').color || 'currentColor', opacity: editor.getAttributes('textStyle').color ? 1 : 0.4 }} />
        </button>
        {showColorPicker && (
          <div className="bubble-color-picker" style={{ top: '100%', left: 0 }} onMouseDown={e => e.preventDefault()}>
            {TEXT_COLORS.map(({ label, value }) => (
              <button
                key={value}
                title={label}
                className={editor.getAttributes('textStyle').color === value ? 'is-active' : ''}
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
      <div ref={highlightPickerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            setShowHighlightPicker(v => !v);
            setShowColorPicker(false);
          }}
          title="하이라이트"
          className={`toolbar-button ${editor.isActive('highlight') ? 'is-active' : ''}`}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
        >
          <Highlighter size={16} />
          <div style={{ width: 16, height: 3, borderRadius: 2, background: editor.getAttributes('highlight').color || '#fef08a', opacity: editor.isActive('highlight') ? 1 : 0.4 }} />
        </button>
        {showHighlightPicker && (
          <div className="bubble-color-picker" style={{ top: '100%', left: 0 }} onMouseDown={e => e.preventDefault()}>
            {HIGHLIGHT_COLORS.map(({ label, value }) => (
              <button
                key={value}
                title={label}
                className={editor.getAttributes('highlight').color === value ? 'is-active' : ''}
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

      <div className="toolbar-separator" />

      {/* Headings */}
      <Button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        <Heading1 size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        <Heading2 size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive('heading', { level: 3 })}
        title="Heading 3"
      >
        <Heading3 size={16} />
      </Button>

      <div className="toolbar-separator" />

      {/* Text Alignment */}
      <Button
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        isActive={editor.isActive({ textAlign: 'left' })}
        title="Align Left"
      >
        <AlignLeft size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        isActive={editor.isActive({ textAlign: 'center' })}
        title="Align Center"
      >
        <AlignCenter size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        isActive={editor.isActive({ textAlign: 'right' })}
        title="Align Right"
      >
        <AlignRight size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        isActive={editor.isActive({ textAlign: 'justify' })}
        title="Justify"
      >
        <AlignJustify size={16} />
      </Button>

      <div className="toolbar-separator" />

      {/* Lists */}
      <Button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      >
        <List size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Ordered List"
      >
        <ListOrdered size={16} />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive('taskList')}
        title="Task List"
      >
        <ListChecks size={16} />
      </Button>

      <div className="toolbar-separator" />

      {/* Unified Insert Menu */}
      <div ref={insertMenuRef} style={{ position: 'relative', display: 'inline-block' }}>
        <Button
          onClick={() => setShowInsertMenu(!showInsertMenu)}
          title="Insert..."
        >
          <Plus size={16} />
          <span style={{ marginLeft: '4px' }}>Insert</span>
        </Button>
        {showInsertMenu && (
          <div className="insert-menu">
            {/* Table — with sub-menu */}
            <div
              className="insert-menu-item has-sub"
              onMouseEnter={() => setShowTableSub(true)}
              onMouseLeave={() => { setShowTableSub(false); setShowCustomSize(false); }}
            >
              <Table2 size={15} />
              <span>Table</span>
              <ChevronRight size={14} className="insert-menu-arrow" />
              {showTableSub && (
                <div className="insert-submenu">
                  <div style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
                    Select size
                  </div>
                  {[3, 5, 7, 10].map(size => (
                    <button
                      key={size}
                      className="insert-menu-item"
                      onMouseDown={(e) => { e.preventDefault(); insertTable(size, size); }}
                    >
                      {size} × {size}
                    </button>
                  ))}
                  <button
                    className="insert-menu-item"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowCustomSize(true); }}
                  >
                    Custom...
                  </button>
                  {showCustomSize && (
                    <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input type="number" min="1" max="50" value={customRows}
                          onChange={(e) => setCustomRows(e.target.value)}
                          className="insert-size-input" placeholder="R" />
                        <span style={{ fontSize: '12px' }}>×</span>
                        <input type="number" min="1" max="50" value={customCols}
                          onChange={(e) => setCustomCols(e.target.value)}
                          className="insert-size-input" placeholder="C" />
                      </div>
                      <button
                        className="insert-menu-item"
                        style={{ textAlign: 'center', fontWeight: 'bold' }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const r = parseInt(customRows);
                          const c = parseInt(customCols);
                          if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && r <= 50 && c <= 50) {
                            insertTable(r, c);
                          }
                        }}
                      >
                        Insert
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Image */}
            {onInsertImage && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertImage(); }}>
                <ImageIcon size={15} />
                <span>Image</span>
              </button>
            )}

            {/* Draw.io */}
            {onInsertDrawio && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertDrawio(); }}>
                <PenTool size={15} />
                <span>Draw.io Diagram</span>
              </button>
            )}

            {/* Math */}
            {onInsertMath && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertMath(); }}>
                <Sigma size={15} />
                <span>Math Formula</span>
              </button>
            )}

            {/* Code Block */}
            <button className="insert-menu-item" onMouseDown={(e) => {
              e.preventDefault();
              closeInsertMenu();
              editor.chain().focus().toggleCodeBlock().run();
            }}>
              <Code size={15} />
              <span>Code Block</span>
            </button>

            {/* Diagram */}
            {onInsertDiagram && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertDiagram(); }}>
                <GitGraph size={15} />
                <span>Diagram (Mermaid)</span>
              </button>
            )}

            {/* Horizontal Rule */}
            <button className="insert-menu-item" onMouseDown={(e) => {
              e.preventDefault();
              closeInsertMenu();
              editor.chain().focus().setHorizontalRule().run();
            }}>
              <span style={{ fontSize: '15px', lineHeight: '15px', width: '15px', textAlign: 'center' }}>—</span>
              <span>Horizontal Rule</span>
            </button>

            {/* Cross Reference */}
            {onInsertCrossRef && (
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); closeInsertMenu(); onInsertCrossRef(); }}>
                <Hash size={15} />
                <span>Cross Reference</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Delete Table (contextual — only shown when inside a table) */}
      {editor.isActive('table') && (
        <Button
          onClick={() => editor.chain().focus().deleteTable().run()}
          title="Delete Table"
        >
          <Trash2 size={16} />
        </Button>
      )}

      <div className="toolbar-separator" />

      {/* View JSON */}
      {onViewJson && (
        <Button
          onClick={onViewJson}
          title="View JSON Source"
        >
          <FileJson size={16} />
        </Button>
      )}

      {/* Export */}
      {onExport && (
        <div ref={exportMenuRef} style={{ position: 'relative', display: 'inline-block' }}>
          <Button
            onClick={() => setShowExportMenu(!showExportMenu)}
            title="Export Document"
          >
            <Download size={16} />
            <span style={{ marginLeft: '4px' }}>Export</span>
          </Button>
          {showExportMenu && (
            <div className="insert-menu" style={{ minWidth: '140px' }}>
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); setShowExportMenu(false); onExport('html'); }}>
                HTML
              </button>
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); setShowExportMenu(false); onExport('pdf'); }}>
                PDF
              </button>
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); setShowExportMenu(false); onExport('markdown'); }}>
                Markdown
              </button>
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); setShowExportMenu(false); onExport('adoc'); }}>
                AsciiDoc
              </button>
            </div>
          )}
        </div>
      )}

      {/* Import */}
      {onImport && (
        <div ref={importMenuRef} style={{ position: 'relative', display: 'inline-block' }}>
          <Button
            onClick={() => setShowImportMenu(!showImportMenu)}
            title="Import Document"
          >
            <Upload size={16} />
            <span style={{ marginLeft: '4px' }}>Import</span>
          </Button>
          {showImportMenu && (
            <div className="insert-menu" style={{ minWidth: '140px' }}>
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); setShowImportMenu(false); onImport('markdown'); }}>
                Markdown
              </button>
              <button className="insert-menu-item" onMouseDown={(e) => { e.preventDefault(); setShowImportMenu(false); onImport('html'); }}>
                HTML
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toggle Numbering */}
      <div className="toolbar-separator" />
      <Button
        onClick={onToggleNumbering}
        isActive={showNumbering}
        title={showNumbering ? "Hide Numbering" : "Show Numbering"}
      >
        <NumberIcon size={16} />
        <span style={{ marginLeft: '4px' }}>1.2.3</span>
      </Button>

      <Button
        onClick={onToggleDecoration}
        isActive={showDecoration}
        title={showDecoration ? "Hide Heading Decoration" : "Show Heading Decoration"}
      >
        <RemoveFormatting size={16} />
      </Button>

      <Button
        onClick={onToggleToc}
        isActive={showToc}
        title={showToc ? "Hide Table of Contents" : "Show Table of Contents"}
      >
        <BookOpen size={16} />
        <span style={{ marginLeft: '4px' }}>TOC</span>
      </Button>

    </div>
  );
};
