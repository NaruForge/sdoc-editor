import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { ResponsiveSidePanel } from '../shared/editor/components/ResponsiveSidePanel';
import { EditorI18nProvider } from '../shared/editor/i18n';
import {
  clampSidePanelWidth,
  getDefaultSidePanelWidth,
  getSidePanelOverlayMediaQuery,
  parseStoredSidePanelWidth,
  readStoredSidePanelWidth,
  SIDE_PANEL_CSS_CUSTOM_PROPERTIES,
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_DEFAULT_WIDTH_RATIO,
  SIDE_PANEL_KEYBOARD_STEP,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_OVERLAY_MAX_VIEWPORT_WIDTH,
  SIDE_PANEL_WIDTH_STORAGE_KEY,
  sidePanelWidthForKey,
  storeSidePanelWidth,
} from '../shared/editor/sidePanelWidth';

const stylesheet = postcss.parse(readFileSync(
  new URL('../shared/editor/styles/editor.css', import.meta.url),
  'utf8',
));

function findRule(selector: string): Rule | undefined {
  let match: Rule | undefined;
  stylesheet.walkRules((rule) => {
    if (rule.selectors.includes(selector)) match = rule;
  });
  return match;
}

function declarationValue(selector: string, property: string): string | undefined {
  const rule = findRule(selector);
  const declaration = rule?.nodes.find(
    (node) => node.type === 'decl' && node.prop === property,
  );
  return declaration?.type === 'decl' ? declaration.value : undefined;
}

describe('side panel width', () => {
  it('owns the complete responsive width contract', () => {
    expect({
      min: SIDE_PANEL_MIN_WIDTH,
      default: SIDE_PANEL_DEFAULT_WIDTH,
      max: SIDE_PANEL_MAX_WIDTH,
      ratio: SIDE_PANEL_DEFAULT_WIDTH_RATIO,
      keyboardStep: SIDE_PANEL_KEYBOARD_STEP,
      overlayMax: SIDE_PANEL_OVERLAY_MAX_VIEWPORT_WIDTH,
    }).toEqual({
      min: 320,
      default: 380,
      max: 560,
      ratio: 0.28,
      keyboardStep: 16,
      overlayMax: 1100,
    });

    expect(getDefaultSidePanelWidth()).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(getDefaultSidePanelWidth(800)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(getDefaultSidePanelWidth(1200)).toBeCloseTo(336);
    expect(getDefaultSidePanelWidth(2000)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(getSidePanelOverlayMediaQuery()).toBe(
      `(max-width: ${SIDE_PANEL_OVERLAY_MAX_VIEWPORT_WIDTH}px)`,
    );
  });

  it('provides the width contract to shared CSS through component custom properties', () => {
    const markup = renderToStaticMarkup(React.createElement(
      EditorI18nProvider,
      { locale: 'en' },
      React.createElement(
        ResponsiveSidePanel,
        {
          title: 'Navigate',
          closeLabel: 'Close',
          onClose: vi.fn(),
          returnFocusRef: React.createRef<HTMLElement>(),
        },
        'Panel content',
      ),
    ));

    for (const [property, value] of Object.entries(SIDE_PANEL_CSS_CUSTOM_PROPERTIES)) {
      expect(markup).toContain(`${property}:${value}`);
    }
  });

  it('uses component state rather than a duplicated CSS media breakpoint', () => {
    const editorBodyRule = findRule('.editor-body-layout');
    const overlayRule = findRule('.side-panel.is-overlay');
    expect(editorBodyRule).toBeDefined();
    expect(overlayRule).toBeDefined();
    expect(declarationValue('.editor-body-layout', 'position')).toBe('relative');
    expect(declarationValue('.side-panel', 'min-width')).toBe('var(--side-panel-min-width)');
    expect(declarationValue('.side-panel', 'max-width')).toBe('var(--side-panel-max-width)');
    expect(declarationValue('.side-panel.is-overlay', 'max-width')).toBe(
      'var(--side-panel-default-width)',
    );

    const mediaQueries: string[] = [];
    stylesheet.walkAtRules('media', (rule) => mediaQueries.push(rule.params));
    expect(mediaQueries).not.toContain(getSidePanelOverlayMediaQuery().slice(1, -1));
  });

  it('clamps pointer and persisted widths to the supported range', () => {
    expect(clampSidePanelWidth(100)).toBe(320);
    expect(clampSidePanelWidth(440)).toBe(440);
    expect(clampSidePanelWidth(900)).toBe(560);
    expect(parseStoredSidePanelWidth('-12')).toBe(320);
    expect(parseStoredSidePanelWidth('900')).toBe(560);
  });

  it('ignores missing, empty, non-numeric, and non-finite stored values', () => {
    expect(parseStoredSidePanelWidth(null)).toBeNull();
    expect(parseStoredSidePanelWidth('')).toBeNull();
    expect(parseStoredSidePanelWidth('wide')).toBeNull();
    expect(parseStoredSidePanelWidth('Infinity')).toBeNull();
  });

  it('implements accessible keyboard increments and limits', () => {
    expect(sidePanelWidthForKey(400, 'ArrowLeft')).toBe(384);
    expect(sidePanelWidthForKey(400, 'ArrowRight')).toBe(416);
    expect(sidePanelWidthForKey(325, 'ArrowLeft')).toBe(320);
    expect(sidePanelWidthForKey(555, 'ArrowRight')).toBe(560);
    expect(sidePanelWidthForKey(400, 'Home')).toBe(320);
    expect(sidePanelWidthForKey(400, 'End')).toBe(560);
    expect(sidePanelWidthForKey(400, 'PageUp')).toBeNull();
  });

  it('contains storage read and write failures', () => {
    const broken = {
      getItem: vi.fn(() => { throw new Error('disabled'); }),
      setItem: vi.fn(() => { throw new Error('full'); }),
    };
    expect(readStoredSidePanelWidth(broken)).toBeNull();
    expect(() => storeSidePanelWidth(broken, 420)).not.toThrow();
  });

  it('uses the host-local versioned key and stores the clamped width', () => {
    const storage = { getItem: vi.fn(() => '432'), setItem: vi.fn() };
    expect(readStoredSidePanelWidth(storage)).toBe(432);
    storeSidePanelWidth(storage, 700);
    expect(storage.getItem).toHaveBeenCalledWith(SIDE_PANEL_WIDTH_STORAGE_KEY);
    expect(storage.setItem).toHaveBeenCalledWith(SIDE_PANEL_WIDTH_STORAGE_KEY, '560');
  });
});
