import { describe, expect, it } from 'vitest';
import {
  resolveToolbarLayout,
  TOOLBAR_GROUP_ORDER,
  type ToolbarGroupId,
} from '../shared/editor/toolbar/layout';
import { nextMenuIndex } from '../shared/editor/components/ui/Menu';

const widths: Record<ToolbarGroupId, number> = {
  'inline-basic': 160,
  'inline-color': 72,
  heading: 72,
  alignment: 36,
  'lists-blocks': 140,
  insert: 52,
  'table-context': 36,
};

describe('responsive toolbar layout', () => {
  it('keeps every group visible at the exact fit boundary', () => {
    const availableWidth = Object.values(widths).reduce((sum, value) => sum + value, 0)
      + (TOOLBAR_GROUP_ORDER.length - 1) * 4;
    expect(resolveToolbarLayout({
      availableWidth,
      groupWidths: widths,
      presentGroups: TOOLBAR_GROUP_ORDER,
    })).toEqual({ visible: TOOLBAR_GROUP_ORDER, overflow: [] });
  });

  it('selects atomic groups by priority while preserving canonical order', () => {
    const layout = resolveToolbarLayout({
      availableWidth: 320,
      groupWidths: widths,
      presentGroups: TOOLBAR_GROUP_ORDER,
    });
    expect(layout.visible).toEqual(['inline-basic', 'heading', 'table-context']);
    expect(layout.overflow).toEqual([
      'inline-color',
      'alignment',
      'lists-blocks',
      'insert',
    ]);
    expect(new Set([...layout.visible, ...layout.overflow])).toEqual(new Set(TOOLBAR_GROUP_ORDER));
  });

  it('does not reserve table actions when the editor is outside a table', () => {
    const groups = TOOLBAR_GROUP_ORDER.filter((id) => id !== 'table-context');
    const layout = resolveToolbarLayout({
      availableWidth: 1024,
      groupWidths: widths,
      presentGroups: groups,
    });
    expect(layout.visible).not.toContain('table-context');
    expect(layout.overflow).not.toContain('table-context');
  });
});

describe('menu keyboard navigation', () => {
  it('wraps and supports Home and End', () => {
    expect(nextMenuIndex(-1, 'ArrowDown', 4)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowUp', 4)).toBe(3);
    expect(nextMenuIndex(3, 'ArrowDown', 4)).toBe(0);
    expect(nextMenuIndex(2, 'Home', 4)).toBe(0);
    expect(nextMenuIndex(1, 'End', 4)).toBe(3);
  });
});
