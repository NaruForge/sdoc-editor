import React, { useState, useRef, useEffect, useId, useMemo } from 'react';
import type { RefTarget } from '../extensions/CrossReference';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';
import { ModalDialog } from './ModalDialog';

interface CrossReferenceDialogProps {
  targets: RefTarget[];
  onSelect: (target: RefTarget) => void;
  onClose: () => void;
}

type FilterType = 'all' | RefTarget['type'];

const TYPE_META: Record<RefTarget['type'], { categoryKey: EditorTranslationKey; icon: string }> = {
  heading: { categoryKey: 'crossRef.heading', icon: '§' },
  figure: { categoryKey: 'crossRef.figure', icon: '🖼' },
  table: { categoryKey: 'crossRef.table', icon: '▦' },
  equation: { categoryKey: 'crossRef.equation', icon: '∑' },
};

const FILTERS: { id: FilterType; labelKey: EditorTranslationKey }[] = [
  { id: 'all', labelKey: 'crossRef.filterAll' },
  { id: 'heading', labelKey: 'crossRef.heading' },
  { id: 'figure', labelKey: 'crossRef.figure' },
  { id: 'table', labelKey: 'crossRef.table' },
  { id: 'equation', labelKey: 'crossRef.equation' },
];

export const CrossReferenceDialog: React.FC<CrossReferenceDialogProps> = ({ targets, onSelect, onClose }) => {
  const { t } = useEditorI18n();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const availableTypes = useMemo(() => new Set(targets.map(t => t.type)), [targets]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return targets.filter(t => {
      if (filter !== 'all' && t.type !== filter) return false;
      if (!q) return true;
      return t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    });
  }, [targets, query, filter]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filter]);

  const groups: Record<string, RefTarget[]> = {};
  for (const target of filtered) {
    const cat = t(TYPE_META[target.type].categoryKey);
    (groups[cat] ??= []).push(target);
  }

  const flatItems = Object.values(groups).flat();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSelectedIndex(Math.max(0, flatItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        onSelect(flatItems[selectedIndex]);
      }
    }
  };

  return (
    <ModalDialog
      titleId={titleId}
      size="sm"
      className="crossref-dialog"
      overlayClassName="crossref-dialog-overlay"
      initialFocusRef={inputRef}
      onCancel={onClose}
      onKeyDown={handleKeyDown}
    >
        <div id={titleId} className="crossref-dialog-header">{t('crossRef.title')}</div>
        <input
          ref={inputRef}
          type="text"
          className="crossref-dialog-search"
          placeholder={t('crossRef.searchPlaceholder')}
          aria-label={t('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="crossref-dialog-filters">
          {FILTERS.filter(f => f.id === 'all' || availableTypes.has(f.id)).map(f => (
            <button
              key={f.id}
              type="button"
              className={`crossref-filter-chip${filter === f.id ? ' is-active' : ''}`}
              aria-pressed={filter === f.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFilter(f.id)}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <div
          className="crossref-dialog-list"
          role="listbox"
          aria-label={t('crossRef.title')}
          aria-activedescendant={flatItems[selectedIndex]
            ? `crossref-option-${flatItems[selectedIndex].id}`
            : undefined}
        >
          {filtered.length === 0 && (
            <div className="crossref-dialog-empty">{t('crossRef.empty')}</div>
          )}
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat} role="group" aria-label={cat}>
              <div className="crossref-category" aria-hidden="true">{cat}</div>
              {items.map((item) => {
                const idx = flatItems.indexOf(item);
                return (
                  <div
                    key={item.id}
                    id={`crossref-option-${item.id}`}
                    className={`crossref-item${idx === selectedIndex ? ' focused' : ''}`}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="crossref-icon">{TYPE_META[item.type].icon}</span>
                    <span className="crossref-label">{item.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
    </ModalDialog>
  );
};
