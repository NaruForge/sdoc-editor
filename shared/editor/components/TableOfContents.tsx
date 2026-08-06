import React, { useEffect, useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, BookOpen } from 'lucide-react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { PanelEmptyState } from './PanelEmptyState';
import type { ResolvedEditorSettings } from '../../types';
import {
  buildOutlinePresentationIndex,
  findActivePosition,
  getDocumentStructureIndexState,
  resolveStructurePosition,
} from '../structureIndex';
import { useDocumentStructureIndex } from '../hooks/useDocumentStructureIndex';
import { useEditorI18n } from '../i18n';

interface TocEntry {
  level: number;
  text: string;
  id: string;
  pos: number;
  numbered: boolean;
  number: string;
}

interface TableOfContentsProps {
  editor: TiptapEditor | null;
  showNumbering: boolean;
  settings: ResolvedEditorSettings;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ editor, showNumbering, settings }) => {
  const { t } = useEditorI18n();
  const index = useDocumentStructureIndex(editor, settings);
  const entries = useMemo<TocEntry[]>(() => (index?.headings ?? [])
    .filter((entry) => Boolean(entry.title))
    .map((entry) => ({
      level: entry.headingLevel ?? 1,
      text: entry.title ?? '',
      id: entry.id ?? '',
      pos: entry.pos,
      numbered: entry.numbered,
      number: entry.number,
    })), [index]);
  const [activeId, setActiveId] = useState<string>('');
  const [collapsed, setCollapsed] = useState<Set<number | string>>(new Set());

  const toggleCollapse = (key: number | string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Track active heading based on cursor position
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const cursorPos = editor.state.selection.anchor;
      const current = getDocumentStructureIndexState(editor.state).headings;
      const activePosition = findActivePosition(current.map((entry) => entry.pos), cursorPos);
      setActiveId(current.find((entry) => entry.pos === activePosition)?.id ?? '');
    };
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  const handleClick = (entry: TocEntry) => {
    if (!editor) return;
    // Focus editor and set cursor inside the heading node
    const position = entry.id ? resolveStructurePosition(editor.state, entry.id) : entry.pos;
    if (position === undefined) return;
    editor.chain().focus().setTextSelection(position + 1).run();
    // Scroll the DOM heading into view
    const domNode = editor.view.nodeDOM(position) as HTMLElement | null;
    if (domNode) {
      domNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (entry.id) {
      document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const presentation = useMemo(
    () => buildOutlinePresentationIndex(entries, collapsed),
    [entries, collapsed],
  );

  if (entries.length === 0) {
    return (
      <div className="toc-panel">
        <div className="toc-title">{t('toc.title')}</div>
        <PanelEmptyState
          icon={<BookOpen size={22} />}
          title={t('toc.emptyTitle')}
          message={t('toc.emptyMessage')}
          hint={t('toc.emptyHint')}
        />
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <div className="toc-title">{t('toc.title')}</div>
      <nav className="toc-nav">
        {entries.map((entry, idx) => {
          if (!presentation.visible[idx]) return null;
          const collapseKey = entry.id || entry.pos;
          const isCollapsed = collapsed.has(collapseKey);
          const showToggle = presentation.hasChildren[idx];
          return (
            <div
              key={entry.id || `${entry.pos}-${idx}`}
              className={`toc-entry toc-level-${entry.level} ${entry.id && activeId === entry.id ? 'toc-active' : ''}`}
            >
              <button
                className="toc-toggle"
                type="button"
                aria-label={isCollapsed ? t('toc.expand') : t('toc.collapse')}
                style={{ visibility: showToggle ? 'visible' : 'hidden' }}
                onClick={() => toggleCollapse(collapseKey)}
              >
                {isCollapsed
                  ? <ChevronRight size={12} />
                  : <ChevronDown size={12} />}
              </button>
              <button
                className="toc-label"
                type="button"
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
