/**
 * Settings resolution: doc meta.settings > VS Code / external defaults > hardcoded defaults.
 * Caption presets: IEEE / ISO / Modern / Korean.
 */

import type { DocumentSettings, CaptionStyleName, ResolvedEditorSettings } from './types';
export type { CaptionStyleName };

// ─── Caption Presets ────────────────────────────────────────────

export interface CaptionPreset {
  figurePrefix: string;
  tablePrefix: string;
  equationPrefix: string;
  separator: string;
  tableNumberStyle: 'arabic' | 'roman';
  equationParens: boolean;
}

export const CAPTION_PRESETS: Record<CaptionStyleName, CaptionPreset> = {
  ieee: {
    figurePrefix: 'Fig. ',
    tablePrefix: 'Table ',
    equationPrefix: '',
    separator: '. ',
    tableNumberStyle: 'roman',
    equationParens: true,
  },
  iso: {
    figurePrefix: 'Figure ',
    tablePrefix: 'Table ',
    equationPrefix: 'Equation ',
    separator: ' — ',
    tableNumberStyle: 'arabic',
    equationParens: true,
  },
  modern: {
    figurePrefix: 'Figure ',
    tablePrefix: 'Table ',
    equationPrefix: 'Equation ',
    separator: ': ',
    tableNumberStyle: 'arabic',
    equationParens: false,
  },
  korean: {
    figurePrefix: '그림 ',
    tablePrefix: '표 ',
    equationPrefix: '식 ',
    separator: ' ',
    tableNumberStyle: 'arabic',
    equationParens: true,
  },
};

export function getCaptionPreset(style: CaptionStyleName): CaptionPreset {
  return CAPTION_PRESETS[style] ?? CAPTION_PRESETS.modern;
}

// ─── Roman Numeral Conversion ───────────────────────────────────

export function toRoman(num: number): string {
  if (num <= 0) return String(num);
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return result;
}

// ─── Settings Defaults & Resolution ─────────────────────────────

/** Hardcoded defaults — last-resort fallback. */
export const SETTINGS_DEFAULTS: Required<DocumentSettings> = {
  headingNumbering: true,
  headingDecoration: true,
  headingH1Color: '#A50034',
  headingH2Color: '#A50034',
  headingH3Color: '#A50034',
  captionStyle: 'modern',
  captionNumbering: 'sequential',
  equationNumbering: 'sequential',
  crossRefIncludeCaption: false,
  slideCssPath: '',
  htmlCssPath: '',
  pdfScale: 70,
  selfContained: 'images-only',
  slideBreakLevel: 'h1-only',
  slideTransition: 'none',
  showTitleSlide: true,
  outputDir: '',
};

/** Defaults shared by the VS Code webview and the Tauri editor. */
export const EDITOR_SETTINGS_DEFAULTS: ResolvedEditorSettings = {
  captionStyle: SETTINGS_DEFAULTS.captionStyle,
  imageCaptionPrefix: CAPTION_PRESETS.modern.figurePrefix,
  tableCaptionPrefix: CAPTION_PRESETS.modern.tablePrefix,
  equationCaptionPrefix: CAPTION_PRESETS.modern.equationPrefix,
  captionSeparator: CAPTION_PRESETS.modern.separator,
  tableNumberStyle: CAPTION_PRESETS.modern.tableNumberStyle,
  equationParens: CAPTION_PRESETS.modern.equationParens,
  captionNumbering: SETTINGS_DEFAULTS.captionNumbering,
  equationNumbering: SETTINGS_DEFAULTS.equationNumbering,
  crossRefIncludeCaption: SETTINGS_DEFAULTS.crossRefIncludeCaption,
  headingNumbering: SETTINGS_DEFAULTS.headingNumbering,
  headingDecoration: SETTINGS_DEFAULTS.headingDecoration,
  headingH1Color: SETTINGS_DEFAULTS.headingH1Color,
  headingH2Color: SETTINGS_DEFAULTS.headingH2Color,
  headingH3Color: SETTINGS_DEFAULTS.headingH3Color,
  defaultImageAlignment: 'center',
  exportImagePath: 'relative',
  pdfScale: SETTINGS_DEFAULTS.pdfScale,
  selfContained: SETTINGS_DEFAULTS.selfContained,
  slideBreakLevel: SETTINGS_DEFAULTS.slideBreakLevel,
  slideTransition: SETTINGS_DEFAULTS.slideTransition,
  showTitleSlide: SETTINGS_DEFAULTS.showTitleSlide,
  outputDir: SETTINGS_DEFAULTS.outputDir,
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
