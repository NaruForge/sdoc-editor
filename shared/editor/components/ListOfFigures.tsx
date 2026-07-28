import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { Image as ImageIcon } from 'lucide-react';
import { PanelEmptyState } from './PanelEmptyState';
import { buildNumberingIndex } from '../../document/numbering';
import type { ResolvedEditorSettings, TiptapNode } from '../../types';
import { findActivePosition } from '../structureIndex';
import { useEditorI18n } from '../i18n';

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
  const { t } = useEditorI18n();
  const [entries, setEntries] = useState<LofEntry[]>([]);
  const [activePos, setActivePos] = useState<number>(-1);
  const entryPositions = useMemo(() => entries.map((entry) => entry.pos), [entries]);

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
      setActivePos(findActivePosition(entryPositions, cursorPos));
    };
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [editor, entryPositions]);

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
        <div className="toc-title">{t('figures.title')}</div>
        <PanelEmptyState
          icon={<ImageIcon size={22} />}
          title={t('figures.emptyTitle')}
          message={t('figures.emptyMessage')}
          hint={t('figures.emptyHint')}
        />
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <div className="toc-title">{t('figures.title')}</div>
      <nav className="toc-nav">
        {entries.map((entry) => (
          <button
            key={entry.pos}
            className={`toc-entry toc-level-1 lof-entry ${activePos === entry.pos ? 'toc-active' : ''}`}
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
