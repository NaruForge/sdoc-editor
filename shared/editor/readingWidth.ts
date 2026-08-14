export const READING_WIDTH_STORAGE_KEY = 'sdoc-editor-reading-width';

export const READING_WIDTH_IDS = ['narrow', 'comfortable', 'wide', 'full'] as const;

export type ReadingWidthId = (typeof READING_WIDTH_IDS)[number];

export const DEFAULT_READING_WIDTH: ReadingWidthId = 'wide';

export const READING_WIDTH_CSS_MAX: Record<ReadingWidthId, string> = {
  narrow: '44rem',
  comfortable: '56rem',
  wide: '72rem',
  full: '100%',
};

export function isReadingWidthId(value: unknown): value is ReadingWidthId {
  return typeof value === 'string'
    && (READING_WIDTH_IDS as readonly string[]).includes(value);
}

export function parseStoredReadingWidth(value: string | null): ReadingWidthId {
  if (value === null) return DEFAULT_READING_WIDTH;
  const trimmed = value.trim();
  return isReadingWidthId(trimmed) ? trimmed : DEFAULT_READING_WIDTH;
}

export function readingWidthCssMax(id: ReadingWidthId): string {
  return READING_WIDTH_CSS_MAX[id];
}
