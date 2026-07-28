import React from 'react';

export type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

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
}

export const Menu = React.forwardRef<HTMLDivElement, MenuProps>(function Menu({
  label,
  onEscape,
  onKeyDown,
  children,
  ...props
}, ref) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]),'
        + '[role="menuitemradio"]:not([aria-disabled="true"]),'
        + '[role="menuitemcheckbox"]:not([aria-disabled="true"])',
      ),
    ).filter((item) => item.closest('[role="menu"]') === event.currentTarget);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = nextMenuIndex(index, event.key as MenuNavigationKey, items.length);
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <div {...props} ref={ref} role="menu" aria-label={label} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
});
