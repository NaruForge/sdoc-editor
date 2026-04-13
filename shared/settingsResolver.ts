/**
 * Settings resolution: doc meta.settings > VS Code / external defaults > hardcoded defaults.
 */

import type { DocumentSettings } from './types';

/** Hardcoded defaults — last-resort fallback. */
export const SETTINGS_DEFAULTS: Required<DocumentSettings> = {
  headingNumbering: true,
  headingDecoration: true,
  headingH1Color: '#A50034',
  headingH2Color: '#A50034',
  headingH3Color: '#A50034',
  captionImagePrefix: 'Image',
  captionTablePrefix: 'Table',
  captionNumbering: 'simple',
  equationNumbering: 'sequential',
};

/**
 * Merge settings with priority: docSettings > externalDefaults > hardcoded.
 * Returns a fully-resolved (no undefined) DocumentSettings object.
 */
export function resolveSettings(
  docSettings?: Partial<DocumentSettings>,
  externalDefaults?: Partial<DocumentSettings>,
): Required<DocumentSettings> {
  return {
    ...SETTINGS_DEFAULTS,
    ...stripUndefined(externalDefaults),
    ...stripUndefined(docSettings),
  };
}

function stripUndefined(obj?: Partial<DocumentSettings>): Partial<DocumentSettings> {
  if (!obj) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result as Partial<DocumentSettings>;
}
