import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { Table2 } from 'lucide-react';
import { PanelEmptyState } from './PanelEmptyState';
import { buildNumberingIndex } from '../../document/numbering';
import type { ResolvedEditorSettings, TiptapNode } from '../../types';
import { findActivePosition } from '../structureIndex';

interface LotEntry {
  pos: number;
  caption: string;
  label: string;
}

interface ListOfTablesProps {
  editor: TiptapEditor | null;
  settings: ResolvedEditorSettings;
}

export const ListOfTables: React.FC<ListOfTablesProps> = ({ editor, settings }) => {
  const [entries, setEntries] = useState<LotEntry[]>([]);
  const [activePos, setActivePos] = useState<number>(-1);
  const entryPositions = useMemo(() => entries.map((entry) => entry.pos), [entries]);

  const buildEntries = useCallback(() => {
    if (!editor) return;
    const result: LotEntry[] = [];
    const numbering = buildNumberingIndex(editor.getJSON() as TiptapNode, settings);
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        const entry = numbering.byId.get(String(node.attrs.id ?? ''));
        result.push({
          pos,
          caption: (node.attrs.caption as string) || '',
          label: entry?.baseLabel ?? '',
        });
      }
    });
    setEntries(result);
  }, [editor, settings]);

  useEffect(() => {
    if (!editor) return;
    buildEntries();
    const handler = () => buildEntries();
    editor.on('update', handler);
    return () => { editor.off('update', handler); };
  }, [editor, buildEntries]);

  // Track active element based on cursor position
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const cursorPos = editor.state.selection.anchor;
      setActivePos(findActivePosition(entryPositions, cursorPos));
    };
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [editor, entryPositions]);

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
            title={entry.caption || entry.label}
          >
            <span className="toc-number">{entry.label}</span>
            <span className="toc-text">
              {entry.caption || <em className="toc-empty-caption">캡션 없음</em>}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
};
