import React, { useEffect, useState, useCallback } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { Table2 } from 'lucide-react';
import { PanelEmptyState } from './PanelEmptyState';

interface LotEntry {
  pos: number;
  caption: string;
  index: number; // 1-based table number
}

interface ListOfTablesProps {
  editor: TiptapEditor | null;
}

export const ListOfTables: React.FC<ListOfTablesProps> = ({ editor }) => {
  const [entries, setEntries] = useState<LotEntry[]>([]);
  const [activePos, setActivePos] = useState<number>(-1);

  const buildEntries = useCallback(() => {
    if (!editor) return;
    const result: LotEntry[] = [];
    let idx = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        idx++;
        result.push({
          pos,
          caption: (node.attrs.caption as string) || '',
          index: idx,
        });
      }
    });
    setEntries(result);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    buildEntries();
    const handler = () => buildEntries();
    editor.on('update', handler);
    return () => { editor.off('update', handler); };
  }, [editor, buildEntries]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const cursorPos = editor.state.selection.anchor;
      let bestPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table' && pos <= cursorPos) {
          bestPos = pos;
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

  const handleClick = (entry: LotEntry) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(entry.pos + 1).run();
    const domNode = editor.view.nodeDOM(entry.pos) as HTMLElement | null;
    if (domNode) {
      domNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (entries.length === 0) {
    return (
      <div className="toc-panel">
        <div className="toc-title">표 목록</div>
        <PanelEmptyState
          icon={<Table2 size={22} />}
          title="아직 표가 없습니다"
          message="표를 삽입하면 번호와 함께 표 목록에 표시됩니다."
          hint="툴바의 삽입 → 표에서 크기를 선택해 추가하세요."
        />
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <div className="toc-title">표 목록</div>
      <nav className="toc-nav">
        {entries.map((entry) => (
          <button
            key={entry.pos}
            className={`toc-entry toc-level-1 lot-entry ${activePos === entry.pos ? 'toc-active' : ''}`}
            onClick={() => handleClick(entry)}
            title={entry.caption || `Table ${entry.index}`}
          >
            <span className="toc-number">표 {entry.index}.</span>
            <span className="toc-text">
              {entry.caption || <em className="toc-empty-caption">캡션 없음</em>}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
};
