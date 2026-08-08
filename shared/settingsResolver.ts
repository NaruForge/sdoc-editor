/**
 * Settings resolution: doc meta.settings > VS Code / external defaults > hardcoded defaults.
 * Caption presets: IEEE / ISO / Modern / Korean.
 */

import { computeRevision } from './document/operations/sha256';
import type {
  CaptionStyleName,
  DocumentSettingApplicationTarget,
  DocumentSettingKey,
  DocumentSettingPortability,
  DocumentSettingScope,
  DocumentSettingSource,
  DocumentSettings,
  DocumentSettingsSnapshotChange,
  ResolvedDocumentSettingEntries,
  ResolvedDocumentSettingEntry,
  ResolvedDocumentSettingsSnapshot,
  ResolvedEditorSettings,
  TemporaryDocumentViewPreferences,
} from './types';
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

export interface DocumentSettingDefinition<K extends DocumentSettingKey = DocumentSettingKey> {
  defaultValue: Required<DocumentSettings>[K];
  appliesTo: readonly DocumentSettingApplicationTarget[];
}

export type DocumentSettingRegistry = {
  readonly [K in DocumentSettingKey]-?: Readonly<DocumentSettingDefinition<K>>;
};

const setting = <T>(
  defaultValue: T,
  appliesTo: readonly DocumentSettingApplicationTarget[],
): Readonly<{ defaultValue: T; appliesTo: readonly DocumentSettingApplicationTarget[] }> => ({
  defaultValue,
  appliesTo,
});

const ALL_CONTENT_TARGETS = [
  'editor-view', 'html', 'pdf', 'markdown', 'asciidoc', 'slides',
] as const satisfies readonly DocumentSettingApplicationTarget[];
const VISUAL_DOCUMENT_TARGETS = [
  'editor-view', 'html', 'pdf',
] as const satisfies readonly DocumentSettingApplicationTarget[];
const ALL_EXPORT_TARGETS = [
  'html', 'pdf', 'markdown', 'asciidoc', 'slides',
] as const satisfies readonly DocumentSettingApplicationTarget[];

/** Versioned built-in values and application metadata; the registry is the defaults source of truth. */
export const DOCUMENT_SETTING_REGISTRY = {
  headingNumbering: setting(true, ALL_CONTENT_TARGETS),
  headingStartNumber: setting(1, ALL_CONTENT_TARGETS),
  headingDecoration: setting(true, VISUAL_DOCUMENT_TARGETS),
  headingH1Color: setting('#2563EB', VISUAL_DOCUMENT_TARGETS),
  headingH2Color: setting('#2563EB', VISUAL_DOCUMENT_TARGETS),
  headingH3Color: setting('#2563EB', VISUAL_DOCUMENT_TARGETS),
  headingH4Color: setting('#2563EB', VISUAL_DOCUMENT_TARGETS),
  headingH5Color: setting('#2563EB', VISUAL_DOCUMENT_TARGETS),
  headingH6Color: setting('#2563EB', VISUAL_DOCUMENT_TARGETS),
  captionStyle: setting('modern', ALL_CONTENT_TARGETS),
  captionNumbering: setting('sequential', ALL_CONTENT_TARGETS),
  equationNumbering: setting('sequential', ALL_CONTENT_TARGETS),
  crossRefIncludeCaption: setting(false, ALL_CONTENT_TARGETS),
  slideCssPath: setting('', ['slides']),
  htmlCssPath: setting('', ['html', 'pdf']),
  pdfScale: setting(70, ['pdf']),
  selfContained: setting('images-only', ['html', 'pdf', 'slides']),
  slideBreakLevel: setting('h1-only', ['slides']),
  slideTransition: setting('none', ['slides']),
  showTitleSlide: setting(true, ['slides']),
  outputDir: setting('', ALL_EXPORT_TARGETS),
} satisfies DocumentSettingRegistry;

const DOCUMENT_SETTING_KEYS = Object.keys(DOCUMENT_SETTING_REGISTRY) as DocumentSettingKey[];

/** Hardcoded, versioned defaults — last-resort fallback. */
export const SETTINGS_DEFAULTS = Object.freeze(Object.fromEntries(
  DOCUMENT_SETTING_KEYS.map((key) => [key, DOCUMENT_SETTING_REGISTRY[key].defaultValue]),
)) as Readonly<Required<DocumentSettings>>;

/** Defaults shared by the VS Code extension, webview, converters, and CLI. */
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
  headingStartNumber: SETTINGS_DEFAULTS.headingStartNumber,
  headingDecoration: SETTINGS_DEFAULTS.headingDecoration,
  headingH1Color: SETTINGS_DEFAULTS.headingH1Color,
  headingH2Color: SETTINGS_DEFAULTS.headingH2Color,
  headingH3Color: SETTINGS_DEFAULTS.headingH3Color,
  headingH4Color: SETTINGS_DEFAULTS.headingH4Color,
  headingH5Color: SETTINGS_DEFAULTS.headingH5Color,
  headingH6Color: SETTINGS_DEFAULTS.headingH6Color,
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
 * Compatibility wrapper with the historical priority:
 * docSettings > externalDefaults > built-in. New portable flows must use
 * resolveDocumentSettingsSnapshot so host defaults cannot leak into exports.
 */
export function resolveSettings(
  docSettings?: Partial<DocumentSettings>,
  externalDefaults?: Partial<DocumentSettings>,
): Required<DocumentSettings> {
  return { ...resolveDocumentSettingsSnapshot({
    context: 'editor',
    documentSettings: docSettings,
    hostSettings: externalDefaults,
  }).values };
}

export interface ResolveDocumentSettingsSnapshotOptions {
  context: ResolvedDocumentSettingsSnapshot['context'];
  documentSettings?: Partial<DocumentSettings>;
  bookProfileSettings?: Partial<DocumentSettings>;
  hostSettings?: Partial<DocumentSettings>;
  temporaryView?: TemporaryDocumentViewPreferences;
  chapterSettings?: readonly {
    documentPath: string;
    settings?: Partial<DocumentSettings>;
  }[];
}

const SOURCE_METADATA: Record<DocumentSettingSource, {
  scope: DocumentSettingScope;
  portability: DocumentSettingPortability;
}> = {
  document: { scope: 'document', portability: 'portable' },
  'book-profile': { scope: 'book', portability: 'portable' },
  host: { scope: 'host', portability: 'host-local' },
  'built-in': { scope: 'product', portability: 'portable' },
  'temporary-view': { scope: 'session', portability: 'session-only' },
};

function getDefinedSetting(
  settings: Partial<DocumentSettings> | undefined,
  key: DocumentSettingKey,
): Required<DocumentSettings>[DocumentSettingKey] | undefined {
  const value = settings?.[key];
  return value === undefined ? undefined : value;
}

function getTemporaryViewValue(
  preferences: TemporaryDocumentViewPreferences | undefined,
  key: DocumentSettingKey,
): boolean | undefined {
  if (key !== 'headingNumbering' && key !== 'headingDecoration') return undefined;
  const preference = preferences?.[key];
  if (preference === 'show') return true;
  if (preference === 'hide') return false;
  return undefined;
}

function createResolvedEntry(
  key: DocumentSettingKey,
  value: Required<DocumentSettings>[DocumentSettingKey],
  source: DocumentSettingSource,
): ResolvedDocumentSettingEntry {
  return Object.freeze({
    value,
    source,
    ...SOURCE_METADATA[source],
    appliesTo: DOCUMENT_SETTING_REGISTRY[key].appliesTo,
  });
}

/**
 * Resolve an immutable, provenance-aware settings snapshot.
 *
 * Portable standalone and Book contexts deliberately ignore host settings.
 * The editor context retains host inheritance for UI provenance only and may
 * overlay session-only view preferences.
 */
export function resolveDocumentSettingsSnapshot(
  options: ResolveDocumentSettingsSnapshotOptions,
): ResolvedDocumentSettingsSnapshot {
  const valueRecord: Partial<Required<DocumentSettings>> = {};
  const entryRecord: Partial<Record<DocumentSettingKey, ResolvedDocumentSettingEntry>> = {};

  for (const key of DOCUMENT_SETTING_KEYS) {
    let value = DOCUMENT_SETTING_REGISTRY[key].defaultValue;
    let source: DocumentSettingSource = 'built-in';

    if (options.context === 'book') {
      const profileValue = getDefinedSetting(options.bookProfileSettings, key);
      if (profileValue !== undefined) {
        value = profileValue;
        source = 'book-profile';
      }
    } else {
      if (options.context === 'editor') {
        const hostValue = getDefinedSetting(options.hostSettings, key);
        if (hostValue !== undefined) {
          value = hostValue;
          source = 'host';
        }
      }
      const documentValue = getDefinedSetting(options.documentSettings, key);
      if (documentValue !== undefined) {
        value = documentValue;
        source = 'document';
      }
      if (options.context === 'editor') {
        const temporaryValue = getTemporaryViewValue(options.temporaryView, key);
        if (temporaryValue !== undefined) {
          value = temporaryValue;
          source = 'temporary-view';
        }
      }
    }

    (valueRecord as Record<DocumentSettingKey, unknown>)[key] = value;
    entryRecord[key] = createResolvedEntry(key, value, source);
  }

  const values = Object.freeze(valueRecord) as Readonly<Required<DocumentSettings>>;
  const entries = Object.freeze(entryRecord) as ResolvedDocumentSettingEntries;
  const diagnostics = options.context === 'book'
    ? Object.freeze((options.chapterSettings ?? []).flatMap(({ documentPath, settings }) =>
      DOCUMENT_SETTING_KEYS.flatMap((key) => {
        const chapterValue = getDefinedSetting(settings, key);
        if (chapterValue === undefined || Object.is(chapterValue, values[key])) return [];
        return [Object.freeze({
          severity: 'warning' as const,
          code: 'CHAPTER_SETTING_OVERRIDDEN' as const,
          key,
          documentPath,
          message: `${documentPath} stores ${key}, but the Book publish profile overrides it.`,
        })];
      })))
    : Object.freeze([]);
  const fingerprint = computeRevision(JSON.stringify({
    version: '1',
    context: options.context,
    entries: DOCUMENT_SETTING_KEYS.map((key) => ({
      key,
      value: entries[key].value,
      source: entries[key].source,
    })),
    diagnostics,
  }));

  return Object.freeze({
    version: '1',
    context: options.context,
    values,
    entries,
    diagnostics,
    fingerprint,
  });
}

export function materializeDocumentSettings(
  snapshot: ResolvedDocumentSettingsSnapshot,
): Required<DocumentSettings>;
export function materializeDocumentSettings(
  snapshot: ResolvedDocumentSettingsSnapshot,
  keys: readonly DocumentSettingKey[],
): Partial<DocumentSettings>;
export function materializeDocumentSettings(
  snapshot: ResolvedDocumentSettingsSnapshot,
  keys: readonly DocumentSettingKey[] = DOCUMENT_SETTING_KEYS,
): Partial<DocumentSettings> {
  const materialized: Partial<DocumentSettings> = {};
  for (const key of keys) {
    (materialized as Record<DocumentSettingKey, unknown>)[key] = snapshot.values[key];
  }
  return materialized;
}

export function diffDocumentSettingsSnapshots(
  baseline: ResolvedDocumentSettingsSnapshot,
  current: ResolvedDocumentSettingsSnapshot,
): DocumentSettingsSnapshotChange[] {
  return DOCUMENT_SETTING_KEYS.flatMap((key) => {
    const before = baseline.entries[key];
    const after = current.entries[key];
    return Object.is(before.value, after.value) && before.source === after.source
      ? []
      : [{ key, before, after } as DocumentSettingsSnapshotChange];
  });
}

export function resolveEditorSettings(
  docSettings?: Partial<DocumentSettings>,
  externalDefaults?: Partial<DocumentSettings>,
  hostDefaults?: Partial<Pick<ResolvedEditorSettings, 'defaultImageAlignment' | 'exportImagePath'>>,
): ResolvedEditorSettings {
  const settings = resolveSettings(docSettings, externalDefaults);
  const preset = getCaptionPreset(settings.captionStyle);
  return {
    ...EDITOR_SETTINGS_DEFAULTS,
    ...settings,
    imageCaptionPrefix: preset.figurePrefix,
    tableCaptionPrefix: preset.tablePrefix,
    equationCaptionPrefix: preset.equationPrefix,
    captionSeparator: preset.separator,
    tableNumberStyle: preset.tableNumberStyle,
    equationParens: preset.equationParens,
    ...stripUndefined(hostDefaults),
  };
}

function stripUndefined<T extends object>(obj?: Partial<T>): Partial<T> {
  if (!obj) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result as Partial<T>;
}
