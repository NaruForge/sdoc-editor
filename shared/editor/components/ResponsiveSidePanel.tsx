import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEditorI18n } from '../i18n';
import {
  clampSidePanelWidth,
  getDefaultSidePanelWidth,
  getSidePanelOverlayMediaQuery,
  readStoredSidePanelWidth,
  SIDE_PANEL_CSS_CUSTOM_PROPERTIES,
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  sidePanelWidthForKey,
  storeSidePanelWidth,
} from '../sidePanelWidth';

interface ResponsiveSidePanelProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const getLocalStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const getDefaultDockedWidth = (): number => (
  getDefaultSidePanelWidth(typeof window === 'undefined' ? undefined : window.innerWidth)
);
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
  const { t } = useEditorI18n();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => (
    typeof window === 'undefined' ? null : readStoredSidePanelWidth(getLocalStorage())
  ));
  const [isOverlay, setIsOverlay] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(getSidePanelOverlayMediaQuery()).matches,
  );
  const clearDragState = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && resizeHandleRef.current?.hasPointerCapture(drag.pointerId)) {
      resizeHandleRef.current.releasePointerCapture(drag.pointerId);
    }
    document.documentElement.classList.remove('is-resizing-side-panel');
  }, []);

  const finishDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!commit) setPreferredWidth(drag.startWidth);
    else setPreferredWidth((width) => {
      const nextWidth = width ?? drag.startWidth;
      storeSidePanelWidth(getLocalStorage(), nextWidth);
      return nextWidth;
    });
    clearDragState();
  }, [clearDragState]);

  useEffect(() => {
    if (isOverlay && dragRef.current) finishDrag(false);
  }, [finishDrag, isOverlay]);

  useEffect(() => {
    const media = window.matchMedia(getSidePanelOverlayMediaQuery());
    const sync = () => setIsOverlay(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (isOverlay) closeRef.current?.focus();
  }, [isOverlay]);

  useEffect(() => () => {
    clearDragState();
    returnFocusRef.current?.focus();
  }, [clearDragState, returnFocusRef]);

  useEffect(() => {
    const cancelWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return;
      event.preventDefault();
      finishDrag(false);
    };
    document.addEventListener('keydown', cancelWithEscape);
    return () => document.removeEventListener('keydown', cancelWithEscape);
  }, [finishDrag]);

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
        style={{
          ...SIDE_PANEL_CSS_CUSTOM_PROPERTIES,
          ...(!isOverlay && preferredWidth !== null ? { width: `${preferredWidth}px` } : {}),
        } as React.CSSProperties}
      >
        {!isOverlay && <div
          ref={resizeHandleRef}
          className="side-panel-resize-handle"
          role="separator"
          aria-label={t('sidePanel.resize')}
          aria-orientation="vertical"
          aria-valuemin={SIDE_PANEL_MIN_WIDTH}
          aria-valuemax={SIDE_PANEL_MAX_WIDTH}
          aria-valuenow={Math.round(preferredWidth ?? getDefaultDockedWidth())}
          tabIndex={0}
          onKeyDown={(event) => {
            const currentWidth = preferredWidth
              ?? panelRef.current?.getBoundingClientRect().width
              ?? SIDE_PANEL_DEFAULT_WIDTH;
            const nextWidth = sidePanelWidthForKey(currentWidth, event.key);
            if (nextWidth === null) return;
            event.preventDefault();
            setPreferredWidth(nextWidth);
            storeSidePanelWidth(getLocalStorage(), nextWidth);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const startWidth = preferredWidth
              ?? panelRef.current?.getBoundingClientRect().width
              ?? SIDE_PANEL_DEFAULT_WIDTH;
            dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
            document.documentElement.classList.add('is-resizing-side-panel');
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            setPreferredWidth(clampSidePanelWidth(drag.startWidth + event.clientX - drag.startX));
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            finishDrag(true);
          }}
          onPointerCancel={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) finishDrag(false);
          }}
          onLostPointerCapture={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) finishDrag(false);
          }}
        />}
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
