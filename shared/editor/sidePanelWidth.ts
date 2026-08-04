export const SIDE_PANEL_WIDTH_STORAGE_KEY = 'sdoc-editor-side-panel-width-v1';
export const SIDE_PANEL_MIN_WIDTH = 320;
export const SIDE_PANEL_DEFAULT_WIDTH = 380;
export const SIDE_PANEL_MAX_WIDTH = 560;
export const SIDE_PANEL_DEFAULT_WIDTH_RATIO = 0.28;
export const SIDE_PANEL_KEYBOARD_STEP = 16;
export const SIDE_PANEL_OVERLAY_MAX_VIEWPORT_WIDTH = 1100;

export const SIDE_PANEL_CSS_CUSTOM_PROPERTIES = {
  '--side-panel-min-width': `${SIDE_PANEL_MIN_WIDTH}px`,
  '--side-panel-default-width': `${SIDE_PANEL_DEFAULT_WIDTH}px`,
  '--side-panel-max-width': `${SIDE_PANEL_MAX_WIDTH}px`,
  '--side-panel-fluid-width': `${SIDE_PANEL_DEFAULT_WIDTH_RATIO * 100}vw`,
} as const;

interface SidePanelWidthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function clampSidePanelWidth(width: number): number {
  return Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, width));
}

export function getDefaultSidePanelWidth(viewportWidth?: number): number {
  if (viewportWidth === undefined) return SIDE_PANEL_DEFAULT_WIDTH;
  return Math.min(
    SIDE_PANEL_DEFAULT_WIDTH,
    Math.max(SIDE_PANEL_MIN_WIDTH, viewportWidth * SIDE_PANEL_DEFAULT_WIDTH_RATIO),
  );
}

export function getSidePanelOverlayMediaQuery(): string {
  return `(max-width: ${SIDE_PANEL_OVERLAY_MAX_VIEWPORT_WIDTH}px)`;
}

export function parseStoredSidePanelWidth(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const width = Number(value);
  return Number.isFinite(width) ? clampSidePanelWidth(width) : null;
}

export function readStoredSidePanelWidth(storage: SidePanelWidthStorage | null | undefined): number | null {
  if (!storage) return null;
  try {
    return parseStoredSidePanelWidth(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeSidePanelWidth(storage: SidePanelWidthStorage | null | undefined, width: number): void {
  if (!storage || !Number.isFinite(width)) return;
  try {
    storage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(clampSidePanelWidth(width)));
  } catch {
    // Storage may be disabled or full; resizing remains available for this session.
  }
}

export function sidePanelWidthForKey(width: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft': return clampSidePanelWidth(width - SIDE_PANEL_KEYBOARD_STEP);
    case 'ArrowRight': return clampSidePanelWidth(width + SIDE_PANEL_KEYBOARD_STEP);
    case 'Home': return SIDE_PANEL_MIN_WIDTH;
    case 'End': return SIDE_PANEL_MAX_WIDTH;
    default: return null;
  }
}
