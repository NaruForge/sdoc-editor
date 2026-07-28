import React, { useLayoutEffect, useRef } from 'react';

export type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';
export type MenuKeyIntent =
  | 'escape'
  | 'tab-forward'
  | 'tab-backward'
  | 'navigate'
  | 'none';

export function menuKeyIntent(key: string, shiftKey = false): MenuKeyIntent {
  if (key === 'Escape') return 'escape';
  if (key === 'Tab') return shiftKey ? 'tab-backward' : 'tab-forward';
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return 'navigate';
  return 'none';
}

export function nextMenuIndex(
  currentIndex: number,
  key: MenuNavigationKey,
  itemCount: number,
): number {
  if (itemCount <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
  return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1;
}

interface MenuProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  onEscape?: () => void;
  onClose?: () => void;
  autoFocus?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export const Menu = React.forwardRef<HTMLDivElement, MenuProps>(function Menu({
  label,
  onEscape,
  onClose,
  autoFocus = false,
  returnFocusRef,
  onKeyDown,
  onFocusCapture,
  children,
  ...props
}, ref) {
  const menuRef = useRef<HTMLDivElement>(null);
  const didAutoFocusRef = useRef(false);

  const setRef = (element: HTMLDivElement | null) => {
    menuRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  const menuItems = (menu: HTMLDivElement): HTMLElement[] => Array.from(
    menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"]),'
      + '[role="menuitemradio"]:not([aria-disabled="true"]),'
      + '[role="menuitemcheckbox"]:not([aria-disabled="true"])',
    ),
  ).filter((item) =>
    item.closest('[role="menu"]') === menu
    && !item.matches(':disabled')
  );

  const setRovingItem = (items: readonly HTMLElement[], activeIndex: number): void => {
    items.forEach((item, index) => {
      item.tabIndex = index === activeIndex ? 0 : -1;
    });
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = menuItems(menu);
    const focusedIndex = items.indexOf(document.activeElement as HTMLElement);
    const activeIndex = focusedIndex >= 0 ? focusedIndex : 0;
    setRovingItem(items, activeIndex);
    if (autoFocus && !didAutoFocusRef.current && items[activeIndex]) {
      didAutoFocusRef.current = true;
      items[activeIndex]?.focus();
    }
  }, [autoFocus, children]);

  useLayoutEffect(() => () => {
    returnFocusRef?.current?.focus();
  }, [returnFocusRef]);

  const closeAndRestoreFocus = (): void => {
    onClose?.();
    queueMicrotask(() => returnFocusRef?.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const intent = menuKeyIntent(event.key, event.shiftKey);
    if (intent === 'escape') {
      event.preventDefault();
      if (onEscape) onEscape();
      else closeAndRestoreFocus();
      return;
    }
    if ((intent === 'tab-forward' || intent === 'tab-backward') && onClose) {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (intent !== 'navigate') return;
    const items = menuItems(event.currentTarget);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = nextMenuIndex(index, event.key as MenuNavigationKey, items.length);
    if (next >= 0) {
      event.preventDefault();
      setRovingItem(items, next);
      items[next]?.focus();
    }
  };

  return (
    <div
      {...props}
      ref={setRef}
      role="menu"
      aria-label={label}
      onFocusCapture={(event) => {
        onFocusCapture?.(event);
        if (event.defaultPrevented || !menuRef.current) return;
        const items = menuItems(menuRef.current);
        const index = items.indexOf(event.target as HTMLElement);
        if (index >= 0) setRovingItem(items, index);
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
});
