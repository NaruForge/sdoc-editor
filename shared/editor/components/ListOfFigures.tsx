import React, { useEffect, useState, useCallback } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { Image as ImageIcon } from 'lucide-react';
import { PanelEmptyState } from './PanelEmptyState';
import { buildNumberingIndex } from '../../document/numbering';
import type { ResolvedEditorSettings, TiptapNode } from '../../types';

interface LofEntry {
  pos: number;
  caption: string;
  label: string;
}

interface ListOfFiguresProps {
  editor: TiptapEditor | null;
  settings: ResolvedEditorSettings;
}

export const ListOfFigures: React.FC<ListOfFiguresProps> = ({ editor, settings }) => {
  const [entries, setEntries] = useState<LofEntry[]>([]);
  const [activePos, setActivePos] = useState<number>(-1);

  const buildEntries = useCallback(() => {
    if (!editor) return;
    const result: LofEntry[] = [];
    const numbering = buildNumberingIndex(editor.getJSON() as TiptapNode, settings);
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') {
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
      let bestPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && pos <= cursorPos) {
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

  const handleClick = (entry: LofEntry) => {
    if (!editor) return;
    editor.chain().focus().setNodeSelection(entry.pos).run();
    const domNode = editor.view.nodeDOM(entry.pos) as HTMLElement | null;
    if (domNode) {
      domNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (entries.length === 0) {
    return (
      <div className="toc-panel">
        <div className="toc-title">그림 목록</div>
        <PanelEmptyState
          icon={<ImageIcon size={22} />}
          title="아직 그림이 없습니다"
          message="이미지를 삽입하면 번호와 함께 그림 목록에 표시됩니다."
          hint="툴바의 삽입 → 이미지를 선택하거나 이미지를 본문에 드래그하세요."
        />
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <div className="toc-title">그림 목록</div>
      <nav className="toc-nav">
        {entries.map((entry) => (
          <button
            key={entry.pos}
            className={`toc-entry toc-level-1 lof-entry ${activePos === entry.pos ? 'toc-active' : ''}`}
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
