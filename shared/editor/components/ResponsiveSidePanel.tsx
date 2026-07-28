import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface ResponsiveSidePanelProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}

const NARROW_PANEL_QUERY = '(max-width: 720px)';

export const ResponsiveSidePanel: React.FC<ResponsiveSidePanelProps> = ({
  title,
  closeLabel,
  onClose,
  children,
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_PANEL_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(NARROW_PANEL_QUERY);
    const sync = () => setIsNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (isNarrow) closeRef.current?.focus();
  }, [isNarrow]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isNarrow) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isNarrow, onClose]);

  return (
    <>
      <button
        type="button"
        className="side-panel-scrim"
        aria-label={closeLabel}
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        id="editor-side-panel"
        className="side-panel"
        role={isNarrow ? 'dialog' : 'complementary'}
        aria-modal={isNarrow ? true : undefined}
        aria-labelledby={titleId}
        tabIndex={isNarrow ? -1 : undefined}
      >
        <div className="side-panel-mobile-header">
          <strong id={titleId}>{title}</strong>
          <button ref={closeRef} type="button" className="side-panel-close" onClick={onClose} aria-label={closeLabel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="side-panel-content">{children}</div>
      </aside>
    </>
  );
};
