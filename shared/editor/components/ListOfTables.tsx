import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { Table2 } from 'lucide-react';
import { PanelEmptyState } from './PanelEmptyState';
import { buildNumberingIndex } from '../../document/numbering';
import type { ResolvedEditorSettings, TiptapNode } from '../../types';
import { findActivePosition } from '../structureIndex';
import { useEditorI18n } from '../i18n';

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
  const { t } = useEditorI18n();
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
        <div className="toc-title">{t('tables.title')}</div>
        <PanelEmptyState
          icon={<Table2 size={22} />}
          title={t('tables.emptyTitle')}
          message={t('tables.emptyMessage')}
          hint={t('tables.emptyHint')}
        />
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <div className="toc-title">{t('tables.title')}</div>
      <nav className="toc-nav">
        {entries.map((entry) => (
          <button
            key={entry.pos}
            className={`toc-entry toc-level-1 lot-entry ${activePos === entry.pos ? 'toc-active' : ''}`}
            type="button"
            onClick={() => handleClick(entry)}
            title={entry.caption || entry.label}
          >
            <span className="toc-number">{entry.label}</span>
            <span className="toc-text">
              {entry.caption || <em className="toc-empty-caption">{t('caption.none')}</em>}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
};
