import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.closest('[hidden], [aria-hidden="true"]'));
}

/**
 * Keeps keyboard focus inside a mounted modal, closes it with Escape, and
 * restores focus to the element that invoked it when the modal unmounts.
 */
export function useModalFocus(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null> | undefined,
  onClose: () => void,
  fallbackFocusRef?: RefObject<HTMLElement | null>,
): (event: KeyboardEvent<HTMLElement>) => void {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const fallbackTarget = fallbackFocusRef?.current;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    queueMicrotask(() => {
      const initialTarget = initialFocusRef?.current
        ?? getFocusableElements(dialogRef.current)[0];
      if (initialTarget?.isConnected) initialTarget.focus();
    });

    return () => {
      const returnTarget = returnFocusRef.current;
      queueMicrotask(() => {
        const returnTargetAvailable = returnTarget?.isConnected
          && !returnTarget.matches(':disabled')
          && returnTarget.getAttribute('aria-disabled') !== 'true'
          && !returnTarget.closest('[inert]');
        if (returnTargetAvailable) returnTarget.focus();
        else if (fallbackTarget?.isConnected) fallbackTarget.focus();
      });
    };
  }, [dialogRef, fallbackFocusRef, initialFocusRef]);

  return useCallback((event: KeyboardEvent<HTMLElement>): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex]?.focus();
  }, [dialogRef, onClose]);
}
