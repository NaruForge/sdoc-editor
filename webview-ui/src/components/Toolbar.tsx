import React, { useState } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Table2,
  Trash2,
  FileJson,
  ListOrdered as NumberIcon,
} from 'lucide-react';

interface ToolbarProps {
  editor: TiptapEditor | null;
  onViewJson?: () => void;
  showNumbering: boolean;
  onToggleNumbering: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ editor, onViewJson, showNumbering, onToggleNumbering }) => {
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [customRows, setCustomRows] = useState('3');
  const [customCols, setCustomCols] = useState('3');

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
    setShowTablePicker(false);
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

      <div className="toolbar-separator" />

      {/* Code block */}
      <Button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive('codeBlock')}
        title="Code Block"
      >
        <Code size={16} />
      </Button>

      <div className="toolbar-separator" />

      {/* Table with picker */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <Button
          onClick={() => setShowTablePicker(!showTablePicker)}
          title="Insert Table"
        >
          <Table2 size={16} />
        </Button>
        {showTablePicker && (
          <div className="table-picker">
            <div style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
              Select table size:
            </div>
            {[3, 5, 7, 10].map(size => (
              <button
                key={size}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertTable(size, size);
                }}
                className="table-picker-option"
              >
                {size} × {size}
              </button>
            ))}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowCustomSize(true);
              }}
              className="table-picker-option"
            >
              Custom...
            </button>
            {showCustomSize && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={customRows}
                    onChange={(e) => setCustomRows(e.target.value)}
                    style={{
                      width: '50px',
                      padding: '2px 4px',
                      background: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '3px',
                      fontSize: '12px',
                    }}
                    placeholder="Rows"
                  />
                  <span style={{ fontSize: '12px' }}>×</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={customCols}
                    onChange={(e) => setCustomCols(e.target.value)}
                    style={{
                      width: '50px',
                      padding: '2px 4px',
                      background: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '3px',
                      fontSize: '12px',
                    }}
                    placeholder="Cols"
                  />
                </div>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const r = parseInt(customRows);
                    const c = parseInt(customCols);
                    if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && r <= 50 && c <= 50) {
                      insertTable(r, c);
                      setShowCustomSize(false);
                    }
                  }}
                  className="table-picker-option"
                  style={{ textAlign: 'center', fontWeight: 'bold' }}
                >
                  Insert
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <Button
        onClick={() => editor.chain().focus().deleteTable().run()}
        disabled={!editor.isActive('table')}
        title="Delete Table"
      >
        <Trash2 size={16} />
      </Button>

      {/* View JSON */}
      {onViewJson && (
        <>
          <div className="toolbar-separator" />
          <Button
            onClick={onViewJson}
            title="View JSON Source"
          >
            <FileJson size={16} />
            <span style={{ marginLeft: '4px' }}>JSON</span>
          </Button>
        </>
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
    </div>
  );
};
