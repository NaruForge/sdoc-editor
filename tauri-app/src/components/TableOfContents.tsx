import React, { useEffect, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
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

/** Returns true if the entry at idx has at least one subordinate entry */
function hasChildren(entries: TocEntry[], idx: number): boolean {
  const level = entries[idx].level;
  for (let i = idx + 1; i < entries.length; i++) {
    if (entries[i].level <= level) return false;
    if (entries[i].level > level) return true;
  }
  return false;
}

/**
 * Computes visibility for each entry based on collapsed state.
 * Uses a stack-based algorithm: an entry is hidden if any ancestor
 * in its chain is currently collapsed.
 */
function computeVisibility(entries: TocEntry[], collapsed: Set<number>): boolean[] {
  const visible: boolean[] = new Array(entries.length).fill(true);
  const stack: { level: number; pos: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }
    visible[i] = !stack.some(s => collapsed.has(s.pos));
    stack.push({ level: entry.level, pos: entry.pos });
  }
  return visible;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ editor, showNumbering }) => {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activePos, setActivePos] = useState<number>(-1);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const toggleCollapse = (pos: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  };

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
      domNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (entry.id) {
      document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const numbering = showNumbering ? computeNumbering(entries) : null;
  const visibility = computeVisibility(entries, collapsed);

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
        {entries.map((entry, idx) => {
          if (!visibility[idx]) return null;
          const isCollapsed = collapsed.has(entry.pos);
          const showToggle = hasChildren(entries, idx);
          return (
            <div
              key={`${entry.pos}-${idx}`}
              className={`toc-entry toc-level-${entry.level} ${activePos === entry.pos ? 'toc-active' : ''}`}
            >
              <button
                className="toc-toggle"
                aria-label={isCollapsed ? '펼치기' : '접기'}
                style={{ visibility: showToggle ? 'visible' : 'hidden' }}
                onClick={() => toggleCollapse(entry.pos)}
              >
                {isCollapsed
                  ? <ChevronRight size={12} />
                  : <ChevronDown size={12} />}
              </button>
              <button
                className="toc-label"
                onClick={() => handleClick(entry)}
                title={entry.text}
              >
                {numbering && (
                  <span className="toc-number">{numbering[idx]}</span>
                )}
                <span className="toc-text">{entry.text}</span>
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
};
