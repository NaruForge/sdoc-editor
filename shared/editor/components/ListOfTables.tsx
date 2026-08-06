import React, { useEffect, useState, useMemo } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { Table2 } from 'lucide-react';
import { PanelEmptyState } from './PanelEmptyState';
import type { ResolvedEditorSettings } from '../../types';
import {
  findActivePosition,
  getDocumentStructureIndexState,
  resolveStructurePosition,
} from '../structureIndex';
import { useDocumentStructureIndex } from '../hooks/useDocumentStructureIndex';
import { useEditorI18n } from '../i18n';

interface LotEntry {
  pos: number;
  caption: string;
  label: string;
  id: string;
}

interface ListOfTablesProps {
  editor: TiptapEditor | null;
  settings: ResolvedEditorSettings;
}

export const ListOfTables: React.FC<ListOfTablesProps> = ({ editor, settings }) => {
  const { t } = useEditorI18n();
  const index = useDocumentStructureIndex(editor, settings);
  const entries = useMemo<LotEntry[]>(() => (index?.tables ?? []).map((entry) => ({
    pos: entry.pos,
    id: entry.id ?? '',
    caption: entry.title ?? '',
    label: entry.baseLabel,
  })), [index]);
  const [activeId, setActiveId] = useState<string>('');

  // Track active element based on cursor position
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const cursorPos = editor.state.selection.anchor;
      const current = getDocumentStructureIndexState(editor.state).tables;
      const activePosition = findActivePosition(current.map((entry) => entry.pos), cursorPos);
      setActiveId(current.find((entry) => entry.pos === activePosition)?.id ?? '');
    };
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  const handleClick = (entry: LotEntry) => {
    if (!editor) return;
    const position = entry.id ? resolveStructurePosition(editor.state, entry.id) : entry.pos;
    if (position === undefined) return;
    editor.chain().focus().setTextSelection(position + 1).run();
    const domNode = editor.view.nodeDOM(position) as HTMLElement | null;
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
            key={entry.id || entry.pos}
            className={`toc-entry toc-level-1 lot-entry ${entry.id && activeId === entry.id ? 'toc-active' : ''}`}
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
