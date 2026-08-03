import { describe, expect, it, vi } from 'vitest';
import {
  clampSidePanelWidth,
  parseStoredSidePanelWidth,
  readStoredSidePanelWidth,
  SIDE_PANEL_WIDTH_STORAGE_KEY,
  sidePanelWidthForKey,
  storeSidePanelWidth,
} from '../shared/editor/sidePanelWidth';

describe('side panel width', () => {
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
