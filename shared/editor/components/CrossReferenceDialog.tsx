import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { RefTarget } from '../extensions/CrossReference';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

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
    inputRef.current?.focus();
  }, []);

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
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        onSelect(flatItems[selectedIndex]);
      }
    }
  };

  return (
    <div className="crossref-dialog-overlay" onMouseDown={onClose}>
      <div
        className="crossref-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crossref-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div id="crossref-dialog-title" className="crossref-dialog-header">{t('crossRef.title')}</div>
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
              onMouseDown={(e) => { e.preventDefault(); setFilter(f.id); }}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <div className="crossref-dialog-list">
          {filtered.length === 0 && (
            <div className="crossref-dialog-empty">{t('crossRef.empty')}</div>
          )}
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat}>
              <div className="crossref-category">{cat}</div>
              {items.map((item) => {
                const idx = flatItems.indexOf(item);
                return (
                  <div
                    key={item.id}
                    className={`crossref-item${idx === selectedIndex ? ' focused' : ''}`}
                    role="button"
                    tabIndex={idx === selectedIndex ? 0 : -1}
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
      </div>
    </div>
  );
};
