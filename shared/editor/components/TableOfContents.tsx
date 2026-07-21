import React, { useEffect, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, BookOpen } from 'lucide-react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { PanelEmptyState } from './PanelEmptyState';
import { buildNumberingIndex } from '../../document/numbering';
import type { ResolvedEditorSettings, TiptapNode } from '../../types';

interface TocEntry {
  level: number;
  text: string;
  id: string;
  pos: number;  // document position of the heading node
  numbered: boolean;
  number: string;
}

interface TableOfContentsProps {
  editor: TiptapEditor | null;
  showNumbering: boolean;
  settings: ResolvedEditorSettings;
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
    // Pop stack items at the same or deeper level (they are siblings/descendants, not ancestors)
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }
    // If any remaining ancestor is collapsed, this entry is hidden
    visible[i] = !stack.some(s => collapsed.has(s.pos));
    stack.push({ level: entry.level, pos: entry.pos });
  }
  return visible;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ editor, showNumbering, settings }) => {
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
    const numbering = buildNumberingIndex(editor.getJSON() as TiptapNode, settings);
    const result: TocEntry[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level as number;
        const id = (node.attrs.id as string) || '';
        const text = node.textContent;
        const numbered = node.attrs.numbered !== false;
        const number = numbering.byId.get(id)?.number ?? '';
        if (text) {
          result.push({ level, text, id, pos, numbered, number });
        }
      }
    });
    setEntries(result);
  }, [editor, settings]);

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

  const visibility = computeVisibility(entries, collapsed);

  if (entries.length === 0) {
    return (
      <div className="toc-panel">
        <div className="toc-title">목차</div>
        <PanelEmptyState
          icon={<BookOpen size={22} />}
          title="아직 목차가 없습니다"
          message="본문에 제목(H1~H3)을 추가하면 목차가 자동으로 만들어집니다."
          hint="툴바의 H1·H2·H3 버튼을 누르거나 줄 시작에서 # 뒤에 공백을 입력하세요."
        />
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
                {showNumbering && entry.number && (
                  <span className="toc-number">{entry.number}. </span>
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
