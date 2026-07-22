export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export type HeadingLevel = typeof HEADING_LEVELS[number];
export type HeadingColorKey = `headingH${HeadingLevel}Color`;

export const headingColorKey = (level: HeadingLevel): HeadingColorKey =>
  `headingH${level}Color`;

export type HeadingMenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function nextHeadingMenuIndex(
  currentIndex: number,
  key: HeadingMenuNavigationKey,
  itemCount = HEADING_LEVELS.length + 1,
): number {
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowUp') return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1;
  return currentIndex < 0 || currentIndex >= itemCount - 1 ? 0 : currentIndex + 1;
}
