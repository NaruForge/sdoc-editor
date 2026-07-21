import { describe, expect, it } from 'vitest';
import { findActivePosition } from '../shared/editor/structureIndex';
import { applyEditorSettingsCss } from '../shared/editor/applyEditorSettingsCss';
import { resolveEditorSettings } from '../shared/settingsResolver';
import { isUpdatedDrawioAsset } from '../shared/editor/drawioUpdates';

describe('large document structure lookup', () => {
  it('finds active structural entries without rescanning document nodes', () => {
    const positions = Array.from({ length: 5_000 }, (_, index) => index * 10);
    for (let cursor = 0; cursor < 1_000; cursor += 10) {
      expect(findActivePosition(positions, cursor + 7)).toBe(cursor);
    }
    expect(findActivePosition(positions, -1)).toBe(-1);
    expect(findActivePosition(positions, 100_000)).toBe(49_990);
  });
});

describe('Draw.io update identity', () => {
  it('does not match another nested asset with the same basename', () => {
    expect(isUpdatedDrawioAsset('./drawio/a/system.drawio.svg', './drawio/a/system.drawio.svg')).toBe(true);
    expect(isUpdatedDrawioAsset('./drawio/b/system.drawio.svg', './drawio/a/system.drawio.svg')).toBe(false);
    expect(isUpdatedDrawioAsset(undefined, './drawio/a/system.drawio.svg')).toBe(false);
  });
});

describe('shared host editor styling', () => {
  it('applies the same resolved font weights through the shared controller', () => {
    const values = new Map<string, string>();
    const editorTarget = {
      style: { setProperty: (name: string, value: string) => { values.set(name, value); } },
      dataset: {},
    };
    const rootValues = new Map<string, string>();
    const rootTarget = { style: { setProperty: (name: string, value: string) => { rootValues.set(name, value); } } };
    const settings = {
      ...resolveEditorSettings(),
      fontWeightBody: 450, fontWeightBold: 750, fontWeightH1: 800, fontWeightH2: 650, fontWeightH3: 550,
    };
    applyEditorSettingsCss(editorTarget, rootTarget, settings);
    expect(Object.fromEntries(values)).toMatchObject({
      '--font-weight-body': '450', '--font-weight-bold': '750', '--font-weight-h1': '800',
      '--font-weight-h2': '650', '--font-weight-h3': '550',
    });
    expect(rootValues.get('--font-weight-h1')).toBe('800');
  });
});
