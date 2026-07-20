import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { RefTarget } from '../extensions/CrossReference';

interface CrossReferenceDialogProps {
  targets: RefTarget[];
  onSelect: (target: RefTarget) => void;
  onClose: () => void;
}

type FilterType = 'all' | RefTarget['type'];

const TYPE_META: Record<RefTarget['type'], { category: string; icon: string }> = {
  heading: { category: 'Headings', icon: '§' },
  figure: { category: 'Figures', icon: '🖼' },
  table: { category: 'Tables', icon: '▦' },
  equation: { category: 'Equations', icon: '∑' },
};

const FILTERS: { id: FilterType; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'heading', label: '제목' },
  { id: 'figure', label: '그림' },
  { id: 'table', label: '표' },
  { id: 'equation', label: '수식' },
];

export const CrossReferenceDialog: React.FC<CrossReferenceDialogProps> = ({ targets, onSelect, onClose }) => {
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
  for (const t of filtered) {
    const cat = TYPE_META[t.type].category;
    (groups[cat] ??= []).push(t);
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
      <div className="crossref-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="crossref-dialog-header">교차 참조 삽입</div>
        <input
          ref={inputRef}
          type="text"
          className="crossref-dialog-search"
          placeholder="제목, 그림, 표, 수식 검색..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="crossref-dialog-filters">
          {FILTERS.filter(f => f.id === 'all' || availableTypes.has(f.id)).map(f => (
            <button
              key={f.id}
              type="button"
              className={`crossref-filter-chip${filter === f.id ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); setFilter(f.id); }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="crossref-dialog-list">
          {filtered.length === 0 && (
            <div className="crossref-dialog-empty">참조할 대상이 없습니다</div>
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
