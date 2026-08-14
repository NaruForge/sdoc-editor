import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READING_WIDTH,
  parseStoredReadingWidth,
  READING_WIDTH_CSS_MAX,
  READING_WIDTH_IDS,
  READING_WIDTH_STORAGE_KEY,
  readingWidthCssMax,
} from '../shared/editor/readingWidth';

const stylesheet = postcss.parse(readFileSync(
  new URL('../shared/editor/styles/editor.css', import.meta.url),
  'utf8',
));

function declarationValue(selector: string, property: string): string | undefined {
  let value: string | undefined;
  stylesheet.walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return;
    const declaration = rule.nodes.find(
      (node) => node.type === 'decl' && node.prop === property,
    );
    if (declaration?.type === 'decl') value = declaration.value;
  });
  return value;
}

describe('reading width', () => {
  it('defaults to wide and maps each id to a CSS measure', () => {
    expect(DEFAULT_READING_WIDTH).toBe('wide');
    expect(READING_WIDTH_STORAGE_KEY).toBe('sdoc-editor-reading-width');
    expect([...READING_WIDTH_IDS]).toEqual(['narrow', 'comfortable', 'wide', 'full']);
    expect(READING_WIDTH_CSS_MAX).toEqual({
      narrow: '44rem',
      comfortable: '56rem',
      wide: '72rem',
      full: '100%',
    });
    expect(readingWidthCssMax('narrow')).toBe('44rem');
    expect(readingWidthCssMax('full')).toBe('100%');
  });

  it('restores valid stored ids and falls back to wide for missing or invalid values', () => {
    expect(parseStoredReadingWidth(null)).toBe('wide');
    expect(parseStoredReadingWidth('')).toBe('wide');
    expect(parseStoredReadingWidth('   ')).toBe('wide');
    expect(parseStoredReadingWidth('44rem')).toBe('wide');
    expect(parseStoredReadingWidth('Wide')).toBe('wide');
    expect(parseStoredReadingWidth('narrow')).toBe('narrow');
    expect(parseStoredReadingWidth('comfortable')).toBe('comfortable');
    expect(parseStoredReadingWidth('wide')).toBe('wide');
    expect(parseStoredReadingWidth('full')).toBe('full');
    expect(parseStoredReadingWidth('  full  ')).toBe('full');
  });

  it('drives the shared reading column from a variable, not a hardcoded 44rem cap', () => {
    expect(declarationValue('.editor-scroll-area', '--editor-reading-max')).toBe('72rem');
    expect(declarationValue(
      '.editor-scroll-area[data-reading-width="narrow"]',
      '--editor-reading-max',
    )).toBe('44rem');
    expect(declarationValue(
      '.editor-scroll-area[data-reading-width="comfortable"]',
      '--editor-reading-max',
    )).toBe('56rem');
    expect(declarationValue(
      '.editor-scroll-area[data-reading-width="wide"]',
      '--editor-reading-max',
    )).toBe('72rem');
    expect(declarationValue(
      '.editor-scroll-area[data-reading-width="full"]',
      '--editor-reading-max',
    )).toBe('100%');
    expect(declarationValue('.editor-scroll-area .editor-title-area', 'max-width'))
      .toBe('min(100%, var(--editor-reading-max))');
    expect(declarationValue('.editor-scroll-area .ProseMirror', 'max-width'))
      .toBe('min(100%, var(--editor-reading-max))');
    const combined = stylesheet.nodes.find((node): node is Rule => (
      node.type === 'rule'
      && node.selectors.includes('.editor-scroll-area .editor-title-area')
      && node.selectors.includes('.editor-scroll-area .ProseMirror')
    ));
    expect(combined).toBeDefined();
  });

  it('keeps overlay left pad without re-imposing a 44rem reading cap', () => {
    const overlaySelector = '.editor-body-layout:has(.side-panel.is-overlay) .editor-scroll-area';
    expect(declarationValue(overlaySelector, 'padding-left'))
      .toBe('min(var(--side-panel-default-width), max(0px, 100% - 12rem))');
    expect(declarationValue(overlaySelector, 'max-width')).toBeUndefined();
    expect(declarationValue(overlaySelector, '--editor-reading-max')).toBeUndefined();
  });
});
