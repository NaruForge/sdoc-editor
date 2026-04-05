import React, { useEffect, useState, useCallback } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';

interface TocEntry {
  level: number;
  text: string;
  id: string;
  pos: number;  // document position of the heading node
}

interface TableOfContentsProps {
  editor: TiptapEditor | null;
  showNumbering: boolean;
}

/** Compute hierarchical number prefix for each entry, e.g. "1.2.3. " */
function computeNumbering(entries: TocEntry[]): string[] {
  const counters = [0, 0, 0, 0, 0, 0]; // index 0 = h1, ..., 5 = h6
  return entries.map((entry) => {
    const idx = entry.level - 1;
    counters[idx]++;
    // Reset all deeper counters
    for (let i = idx + 1; i < counters.length; i++) counters[i] = 0;
    // Build prefix like "1.", "1.2.", "1.2.3."
    const parts = counters.slice(0, idx + 1);
    return parts.join('.') + '. ';
  });
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ editor, showNumbering }) => {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activePos, setActivePos] = useState<number>(-1);

  const buildEntries = useCallback(() => {
    if (!editor) return;
    const doc = editor.state.doc;
    const result: TocEntry[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level as number;
        const id = (node.attrs.id as string) || '';
        const text = node.textContent;
        if (text) {
          result.push({ level, text, id, pos });
        }
      }
    });
    setEntries(result);
  }, [editor]);

  // Rebuild TOC whenever the editor content changes
  useEffect(() => {
    if (!editor) return;
    buildEntries();
    const handler = () => buildEntries();
    editor.on('update', handler);
    return () => { editor.off('update', handler); };
  }, [editor, buildEntries]);

  // Track active heading based on cursor position
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const cursorPos = editor.state.selection.anchor;
      // Find the heading whose pos range contains the cursor
      const doc = editor.state.doc;
      let bestPos = -1;
      doc.forEach((node, pos) => {
        if (node.type.name === 'heading') {
          if (pos <= cursorPos) bestPos = pos;
        }
      });
      setActivePos(bestPos);
    };
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);

  const handleClick = (entry: TocEntry) => {
    if (!editor) return;
    // Focus editor and set cursor inside the heading node
    editor.chain().focus().setTextSelection(entry.pos + 1).run();
    // Scroll the DOM heading into view
    const domNode = editor.view.nodeDOM(entry.pos) as HTMLElement | null;
    if (domNode) {
      domNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (entry.id) {
      document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const numbering = showNumbering ? computeNumbering(entries) : null;

  if (entries.length === 0) {
    return (
      <div className="toc-panel">
        <div className="toc-title">목차</div>
        <div className="toc-empty">헤딩이 없습니다</div>
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <div className="toc-title">목차</div>
      <nav className="toc-nav">
        {entries.map((entry, idx) => (
          <button
            key={`${entry.pos}-${idx}`}
            className={`toc-entry toc-level-${entry.level} ${activePos === entry.pos ? 'toc-active' : ''}`}
            onClick={() => handleClick(entry)}
            title={entry.text}
          >
            {numbering && (
              <span className="toc-number">{numbering[idx]}</span>
            )}
            <span className="toc-text">{entry.text}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};
