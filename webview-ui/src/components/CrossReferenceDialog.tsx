import React, { useState, useRef, useEffect } from 'react';
import type { RefTarget } from '../extensions/CrossReference';

interface CrossReferenceDialogProps {
  targets: RefTarget[];
  onSelect: (target: RefTarget) => void;
  onClose: () => void;
}

export const CrossReferenceDialog: React.FC<CrossReferenceDialogProps> = ({ targets, onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? targets.filter(t => {
        const q = query.toLowerCase();
        return t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
      })
    : targets;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const groups: Record<string, RefTarget[]> = {};
  for (const t of filtered) {
    const cat = t.type === 'heading' ? 'Headings' : t.type === 'figure' ? 'Figures' : 'Tables';
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
        <div className="crossref-dialog-header">Insert Cross Reference</div>
        <input
          ref={inputRef}
          type="text"
          className="crossref-dialog-search"
          placeholder="Search headings, figures, tables..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="crossref-dialog-list">
          {filtered.length === 0 && (
            <div className="crossref-dialog-empty">No targets found</div>
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
                    <span className="crossref-icon">
                      {item.type === 'heading' ? '§' : item.type === 'figure' ? '🖼' : '▦'}
                    </span>
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
