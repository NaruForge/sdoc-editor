import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface ResponsiveSidePanelProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const OVERLAY_PANEL_QUERY = '(max-width: 1100px)';
const overlayHeaderStyle: React.CSSProperties = {
  display: 'flex',
  minHeight: '40px',
  flex: 'none',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '4px 6px 4px 12px',
};

export const ResponsiveSidePanel: React.FC<ResponsiveSidePanelProps> = ({
  title,
  closeLabel,
  onClose,
  returnFocusRef,
  children,
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isOverlay, setIsOverlay] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(OVERLAY_PANEL_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(OVERLAY_PANEL_QUERY);
    const sync = () => setIsOverlay(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (isOverlay) closeRef.current?.focus();
  }, [isOverlay]);

  useEffect(() => () => {
    returnFocusRef.current?.focus();
  }, [returnFocusRef]);

  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    queueMicrotask(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOverlay) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => {
        if (element.closest('[hidden], [aria-hidden="true"]')) return false;
        const closedDetails = element.closest('details:not([open])');
        if (closedDetails && element !== closedDetails.querySelector(':scope > summary')) return false;
        return element.getClientRects().length > 0;
      });
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
  }, [closeAndRestoreFocus, isOverlay]);

  return (
    <>
      {isOverlay && <button
        type="button"
        className="side-panel-scrim"
        aria-label={closeLabel}
        tabIndex={-1}
        onClick={closeAndRestoreFocus}
      />}
      <aside
        ref={panelRef}
        id="editor-side-panel"
        className={`side-panel${isOverlay ? ' is-overlay' : ''}`}
        role={isOverlay ? 'dialog' : 'complementary'}
        aria-modal={isOverlay ? true : undefined}
        aria-labelledby={titleId}
        tabIndex={isOverlay ? -1 : undefined}
      >
        <div
          className="side-panel-mobile-header"
          style={isOverlay ? overlayHeaderStyle : undefined}
        >
          <strong id={titleId}>{title}</strong>
          <button
            ref={closeRef}
            type="button"
            className="side-panel-close"
            onClick={closeAndRestoreFocus}
            aria-label={closeLabel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="side-panel-content">{children}</div>
      </aside>
    </>
  );
};
