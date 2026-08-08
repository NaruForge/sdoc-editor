import React, { useCallback } from 'react';
import { useEditorContext } from '@shared/editor/context/EditorContext';
import { HEADING_COLOR_PRESETS } from '@shared/editor/constants/colors';
import {
  HEADING_LEVELS,
  headingColorKey,
  type HeadingColorKey,
  type HeadingLevel,
} from '@shared/editor/constants/headings';
import type {
  CaptionStyleName,
  DocumentSettingApplicationTarget,
  DocumentSettingKey,
  DocumentSettings,
  ResolvedDocumentSettingEntry,
  ResolvedDocumentSettingsSnapshot,
  SelfContainedMode,
  SlideBreakLevel,
  SlideTransition,
} from '@shared/types';
import { resolveDocumentSettingsSnapshot } from '@shared/settingsResolver';
import {
  countChangedSettings,
  materializeSettingsGroup,
  removeSettingsOverrides,
  restoreSettingsGroupBaseline,
  type SettingsSyncState,
} from '../designSettings';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

export type CssTarget = 'slide' | 'html';
export type DocumentSettingsExportMode = 'settings' | 'export' | 'slides';

export interface DocumentSettingsPanelProps {
  onUpdateSettings: (settings: Partial<DocumentSettings> | null) => void;
  onSelectCssFile?: (target: CssTarget) => void;
  onClearCssFile?: (target: CssTarget) => void;
  exportMode?: DocumentSettingsExportMode;
  settingsSnapshot?: ResolvedDocumentSettingsSnapshot;
  syncState?: SettingsSyncState;
  onRetrySync?: () => void;
}

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="settings-section">
      <button
        type="button"
        className="settings-section-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`settings-chevron ${open ? 'open' : ''}`} aria-hidden="true">›</span>
        <span>{title}</span>
      </button>
      <div className="settings-section-body" hidden={!open}>{children}</div>
    </section>
  );
};

const CAPTION_STYLE_OPTIONS: ReadonlyArray<{
  value: CaptionStyleName;
  labelKey: EditorTranslationKey;
  description: string;
}> = [
  { value: 'ieee', labelKey: 'settings.captionIeee', description: 'Fig. 1, Table I, (1)' },
  { value: 'iso', labelKey: 'settings.captionIso', description: 'Figure 1, Table 1, Equation (1)' },
  { value: 'modern', labelKey: 'settings.captionModern', description: 'Figure 1, Table 1, Equation 1' },
  { value: 'korean', labelKey: 'settings.captionKorean', description: '그림 1, 표 1, 식 (1)' },
];

interface CssFileTargetOption {
  target: CssTarget;
  labelKey: EditorTranslationKey;
  pathKey: 'slideCssPath' | 'htmlCssPath';
  placeholder: string;
}

const CSS_FILE_TARGET_OPTIONS: ReadonlyArray<CssFileTargetOption> = [
  { target: 'slide', labelKey: 'settings.slideCss', pathKey: 'slideCssPath', placeholder: './theme/slide.css' },
  { target: 'html', labelKey: 'settings.htmlCss', pathKey: 'htmlCssPath', placeholder: './theme/html.css' },
];

const SELF_CONTAINED_OPTIONS: ReadonlyArray<{
  value: SelfContainedMode;
  labelKey: EditorTranslationKey;
}> = [
  { value: 'none', labelKey: 'settings.embedExternal' },
  { value: 'images-only', labelKey: 'settings.embedImages' },
  { value: 'full', labelKey: 'settings.embedFull' },
];

const SLIDE_BREAK_OPTIONS: ReadonlyArray<{
  value: SlideBreakLevel;
  labelKey: EditorTranslationKey;
}> = [
  { value: 'h1-only', labelKey: 'settings.splitH1' },
  { value: 'h1-h2-vertical', labelKey: 'settings.splitH1H2' },
];

const SLIDE_TRANSITION_OPTIONS: ReadonlyArray<{ value: SlideTransition; labelKey: EditorTranslationKey }> = [
  { value: 'none', labelKey: 'common.none' },
  { value: 'fade', labelKey: 'settings.transitionFade' },
  { value: 'slide', labelKey: 'settings.transitionSlide' },
  { value: 'convex', labelKey: 'settings.transitionConvex' },
  { value: 'concave', labelKey: 'settings.transitionConcave' },
  { value: 'zoom', labelKey: 'settings.transitionZoom' },
];

const HEADING_COLOR_KEYS = HEADING_LEVELS.map(headingColorKey);

export type HeadingPalette = 'blue' | 'heritage-red' | 'black' | 'custom' | 'mixed';
type SelectableHeadingPalette = Exclude<HeadingPalette, 'mixed'>;

const HEADING_PALETTE_COLORS: Readonly<Record<Exclude<SelectableHeadingPalette, 'custom'>, string>> = {
  blue: '#2563EB',
  'heritage-red': '#A50034',
  black: '#000000',
};

const normalizeColor = (value: string): string => value.toLowerCase();

export function getHeadingPalette(
  settings: Pick<Partial<DocumentSettings>, HeadingColorKey>,
): HeadingPalette {
  const colors = HEADING_COLOR_KEYS.map((key) => settings[key]).filter(
    (value): value is string => typeof value === 'string',
  );
  if (colors.length !== HEADING_COLOR_KEYS.length) return 'mixed';
  const first = normalizeColor(colors[0]);
  if (!colors.every((color) => normalizeColor(color) === first)) return 'mixed';
  const preset = Object.entries(HEADING_PALETTE_COLORS).find(
    ([, color]) => normalizeColor(color) === first,
  );
  return preset ? preset[0] as Exclude<SelectableHeadingPalette, 'custom'> : 'custom';
}

export function applyHeadingPalette(
  settings: Partial<DocumentSettings> | null,
  palette: SelectableHeadingPalette,
  customColor = '#2563EB',
): Partial<DocumentSettings> {
  const color = palette === 'custom' ? customColor : HEADING_PALETTE_COLORS[palette];
  return HEADING_COLOR_KEYS.reduce<Partial<DocumentSettings>>(
    (next, key) => ({ ...next, [key]: color }),
    { ...(settings ?? {}) },
  );
}

export function mergeDocumentSetting<K extends keyof DocumentSettings>(
  settings: Partial<DocumentSettings> | null,
  key: K,
  value: DocumentSettings[K],
): Partial<DocumentSettings> {
  return { ...(settings ?? {}), [key]: value };
}

export function removeDocumentSettings(
  settings: Partial<DocumentSettings> | null,
  keys: ReadonlyArray<keyof DocumentSettings>,
): Partial<DocumentSettings> | null {
  const next = { ...(settings ?? {}) };
  for (const key of keys) delete next[key];
  return Object.keys(next).length > 0 ? next : null;
}

const APPEARANCE_KEYS: ReadonlyArray<keyof DocumentSettings> = [
  'headingDecoration',
  ...HEADING_COLOR_KEYS,
];
const NUMBERING_KEYS: ReadonlyArray<keyof DocumentSettings> = [
  'headingNumbering',
  'headingStartNumber',
  'captionStyle',
  'captionNumbering',
  'equationNumbering',
  'crossRefIncludeCaption',
];
const SLIDE_KEYS: ReadonlyArray<keyof DocumentSettings> = [
  'slideBreakLevel',
  'slideTransition',
  'showTitleSlide',
];
const ADVANCED_KEYS: ReadonlyArray<keyof DocumentSettings> = ['slideCssPath', 'htmlCssPath'];
const ALL_SETTINGS_KEYS: ReadonlyArray<DocumentSettingKey> = [
  ...APPEARANCE_KEYS,
  ...NUMBERING_KEYS,
  'outputDir',
  'selfContained',
  'pdfScale',
  ...SLIDE_KEYS,
  ...ADVANCED_KEYS,
];

const documentSettingsEqual = (
  left: Partial<DocumentSettings> | null,
  right: Partial<DocumentSettings> | null,
): boolean => {
  const leftRecord = left ?? {};
  const rightRecord = right ?? {};
  const leftKeys = Object.keys(leftRecord) as Array<keyof DocumentSettings>;
  return leftKeys.length === Object.keys(rightRecord).length
    && leftKeys.every((key) => leftRecord[key] === rightRecord[key]);
};

const toNativeColorValue = (value: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : '#2563EB';
};

const HEADING_PRESET_LABEL_KEYS: Readonly<Record<string, EditorTranslationKey>> = {
  '#2563eb': 'settings.presetBlue',
  '#a50034': 'settings.presetHeritageRed',
  '#000000': 'settings.presetBlack',
};

interface HeadingColorControlProps {
  level: HeadingLevel;
  value: string;
  onChange: (value: string) => void;
}

const HeadingColorControl: React.FC<HeadingColorControlProps> = ({
  level,
  value,
  onChange,
}) => {
  const { t } = useEditorI18n();
  const nativePickerRef = React.useRef<HTMLInputElement>(null);
  const normalizedValue = normalizeColor(value);
  const isPresetValue = HEADING_COLOR_PRESETS.some(
    ({ value: preset }) => normalizeColor(preset) === normalizedValue,
  );

  return (
    <div className="settings-heading-color-control">
      <div
        className="settings-heading-color-presets"
        role="group"
        aria-label={t('settings.headingColorPresets', { level })}
      >
        {HEADING_COLOR_PRESETS.map(({ value: preset }) => {
          const selected = normalizedValue === normalizeColor(preset);
          const presetLabel = t(HEADING_PRESET_LABEL_KEYS[normalizeColor(preset)]);
          return (
            <button
              key={preset}
              type="button"
              className={`settings-heading-color-swatch settings-heading-color-preset${selected ? ' is-active' : ''}`}
              style={{ backgroundColor: preset }}
              aria-label={`H${level} ${presetLabel}`}
              aria-pressed={selected}
              title={presetLabel}
              onClick={() => onChange(preset)}
            />
          );
        })}
        <button
          type="button"
          className={`settings-heading-color-swatch settings-heading-color-custom-button${isPresetValue ? '' : ' is-active'}`}
          aria-label={t('settings.customHeadingColor', { level })}
          aria-pressed={!isPresetValue}
          title={t('settings.chooseCustomColor')}
          onClick={() => nativePickerRef.current?.click()}
        />
      </div>
      <input
        ref={nativePickerRef}
        type="color"
        className="settings-heading-color-native-picker"
        value={toNativeColorValue(value)}
        aria-label={t('settings.customHeadingColor', { level })}
        tabIndex={-1}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
};

export interface DeferredTextInputProps {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
  pattern?: string;
  maxLength?: number;
  title?: string;
  errorMessage?: string;
}

export function isDeferredTextDraftValid(draft: string, pattern?: string): boolean {
  return pattern ? new RegExp(pattern).test(draft) : true;
}

export const DeferredTextInput: React.FC<DeferredTextInputProps> = ({
  value,
  placeholder,
  onCommit,
  ariaLabel,
  pattern,
  maxLength,
  title,
  errorMessage,
}) => {
  const [draft, setDraft] = React.useState(value);
  const skipCommitOnBlurRef = React.useRef(false);
  const errorId = React.useId();
  const invalid = !isDeferredTextDraftValid(draft, pattern);

  React.useEffect(() => setDraft(value), [value]);

  const handleCommit = useCallback(() => {
    if (skipCommitOnBlurRef.current) {
      skipCommitOnBlurRef.current = false;
      return;
    }
    if (!invalid && draft !== value) onCommit(draft);
  }, [draft, invalid, onCommit, value]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      skipCommitOnBlurRef.current = true;
      setDraft(value);
      event.currentTarget.blur();
    }
  }, [value]);

  return (
    <span className="settings-deferred-field">
      <input
        type="text"
        className="settings-text-input settings-path-input"
        style={{ minWidth: 0, maxWidth: '100%' }}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-errormessage={invalid ? errorId : undefined}
        pattern={pattern}
        maxLength={maxLength}
        title={title}
        spellCheck={false}
      />
      {invalid && (
        <span id={errorId} className="settings-field-error" role="alert">
          {errorMessage ?? title}
        </span>
      )}
    </span>
  );
};

export interface DeferredNumberInputProps {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  ariaLabel: string;
  errorMessage: string;
}

export function parseDeferredNumberDraft(
  draft: string,
  min: number,
  max: number,
): number | null {
  if (!draft.trim()) return null;
  const parsed = Number(draft);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/** Keep incomplete numeric input local until a valid value is explicitly committed. */
export const DeferredNumberInput: React.FC<DeferredNumberInputProps> = ({
  value,
  min,
  max,
  onCommit,
  ariaLabel,
  errorMessage,
}) => {
  const [draft, setDraft] = React.useState(String(value));
  const skipCommitOnBlurRef = React.useRef(false);
  const errorId = React.useId();
  const parsed = parseDeferredNumberDraft(draft, min, max);
  const invalid = parsed === null;

  React.useEffect(() => setDraft(String(value)), [value]);

  const handleCommit = useCallback(() => {
    if (skipCommitOnBlurRef.current) {
      skipCommitOnBlurRef.current = false;
      return;
    }
    if (parsed !== null && parsed !== value) onCommit(parsed);
  }, [onCommit, parsed, value]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      skipCommitOnBlurRef.current = true;
      setDraft(String(value));
      event.currentTarget.blur();
    }
  }, [value]);

  return (
    <span className="settings-deferred-field settings-deferred-number-field">
      <input
        type="text"
        inputMode="decimal"
        className="settings-number-input"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-errormessage={invalid ? errorId : undefined}
        spellCheck={false}
      />
      {invalid && (
        <span id={errorId} className="settings-field-error" role="alert">
          {errorMessage}
        </span>
      )}
    </span>
  );
};

const extractDocumentOverrides = (
  snapshot: ResolvedDocumentSettingsSnapshot | undefined,
): Partial<DocumentSettings> | undefined => {
  if (!snapshot) return undefined;
  const overrides: Partial<DocumentSettings> = {};
  for (const key of Object.keys(snapshot.entries) as DocumentSettingKey[]) {
    if (snapshot.entries[key].source === 'document') {
      (overrides as Record<DocumentSettingKey, unknown>)[key] = snapshot.values[key];
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
};

const SOURCE_LABEL_KEYS = {
  document: 'settings.sourceDocument',
  'book-profile': 'settings.sourceBook',
  host: 'settings.sourceHost',
  'built-in': 'settings.sourceBuiltIn',
  'temporary-view': 'settings.sourceTemporary',
} as const satisfies Record<ResolvedDocumentSettingEntry['source'], EditorTranslationKey>;

const SCOPE_LABEL_KEYS = {
  document: 'settings.scopeDocument',
  book: 'settings.scopeBook',
  host: 'settings.scopeHost',
  product: 'settings.scopeProduct',
  session: 'settings.scopeSession',
} as const satisfies Record<ResolvedDocumentSettingEntry['scope'], EditorTranslationKey>;

const PORTABILITY_LABEL_KEYS = {
  portable: 'settings.portable',
  'host-local': 'settings.hostLocal',
  'session-only': 'settings.sessionOnly',
} as const satisfies Record<ResolvedDocumentSettingEntry['portability'], EditorTranslationKey>;

const APPLICATION_TARGET_LABEL_KEYS = {
  'editor-view': 'settings.targetEditorView',
  html: 'settings.targetHtml',
  pdf: 'settings.targetPdf',
  markdown: 'settings.targetMarkdown',
  asciidoc: 'settings.targetAsciiDoc',
  slides: 'settings.targetSlides',
} as const satisfies Record<DocumentSettingApplicationTarget, EditorTranslationKey>;

interface SettingLabelProps {
  label: string;
  settingKey: DocumentSettingKey;
  snapshot: ResolvedDocumentSettingsSnapshot;
  as?: 'label' | 'span';
}

const SettingLabel: React.FC<SettingLabelProps> = ({
  label,
  settingKey,
  snapshot,
  as = 'label',
}) => {
  const { t } = useEditorI18n();
  const entry = snapshot.entries[settingKey];
  const content = (
    <>
      <span>{label}</span>
      <span className="settings-provenance" aria-label={t('settings.valueOrigin')}>
        <span className="settings-badge">{t(SOURCE_LABEL_KEYS[entry.source])}</span>
        <span className="settings-badge">{t(SCOPE_LABEL_KEYS[entry.scope])}</span>
        <span className="settings-badge">{t(PORTABILITY_LABEL_KEYS[entry.portability])}</span>
      </span>
      <span className="settings-targets">
        {t('settings.appliesTo', {
          targets: entry.appliesTo.map((target) => t(APPLICATION_TARGET_LABEL_KEYS[target])).join(', '),
        })}
      </span>
    </>
  );
  return as === 'span'
    ? <span className="settings-label settings-label-with-meta">{content}</span>
    : <label className="settings-label settings-label-with-meta">{content}</label>;
};

export function useSettingsSyncPresentation(syncState: SettingsSyncState | undefined): {
  labelKey: EditorTranslationKey;
  tone: 'neutral' | 'progress' | 'success' | 'error' | 'warning';
  detail?: string;
  canRetry: boolean;
} {
  return React.useMemo(() => {
    if (!syncState || syncState.status === 'idle') {
      return { labelKey: 'settings.syncIdle', tone: 'neutral', canRetry: false };
    }
    const labelKey: EditorTranslationKey = `settings.sync${syncState.status
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('')}` as EditorTranslationKey;
    const tone = syncState.status === 'failed'
      ? 'error'
      : syncState.status === 'conflict' ? 'warning'
        : syncState.status === 'saved' ? 'success'
          : syncState.status === 'syncing' || syncState.status === 'saving' ? 'progress'
            : 'neutral';
    return {
      labelKey,
      tone,
      detail: 'message' in syncState ? syncState.message : undefined,
      canRetry: syncState.status === 'failed' && syncState.canRetry,
    };
  }, [syncState]);
}

export const DocumentSettingsPanel: React.FC<DocumentSettingsPanelProps> = ({
  onUpdateSettings,
  onSelectCssFile,
  onClearCssFile,
  exportMode = 'settings',
  settingsSnapshot,
  syncState,
  onRetrySync,
}) => {
  const { t } = useEditorI18n();
  const { state } = useEditorContext();
  const docSettings = state.docSettings;
  const mergedSettings = state.settings;
  const panelBaselineRef = React.useRef<Partial<DocumentSettings> | null>(docSettings);
  const latestDocSettingsRef = React.useRef<Partial<DocumentSettings> | null>(docSettings);
  const pendingDocSettingsRef = React.useRef<Partial<DocumentSettings> | null | undefined>(undefined);
  const [draftDocSettings, setDraftDocSettings] = React.useState<Partial<DocumentSettings> | null>(docSettings);
  const [confirmResetAll, setConfirmResetAll] = React.useState(false);
  const suppliedSnapshotHasTemporaryView = settingsSnapshot
    ? settingsSnapshot.entries.headingNumbering.source === 'temporary-view'
      || settingsSnapshot.entries.headingDecoration.source === 'temporary-view'
    : false;
  const snapshotDocumentOverrides = extractDocumentOverrides(settingsSnapshot);
  const resolvedSnapshot = settingsSnapshot
    && !suppliedSnapshotHasTemporaryView
    && documentSettingsEqual(draftDocSettings, docSettings)
    ? settingsSnapshot
    : resolveDocumentSettingsSnapshot({
        context: 'standalone',
        documentSettings: draftDocSettings ?? snapshotDocumentOverrides,
      });
  const displaySettings = {
    ...mergedSettings,
    ...resolvedSnapshot.values,
    ...(draftDocSettings ?? {}),
  };
  const syncPresentation = useSettingsSyncPresentation(syncState);
  const headingPalette = getHeadingPalette(displaySettings);
  const previousSyncStatusRef = React.useRef(syncState?.status);
  const [customPaletteOpen, setCustomPaletteOpen] = React.useState(
    headingPalette === 'custom',
  );

  React.useEffect(() => {
    const pending = pendingDocSettingsRef.current;
    if (pending !== undefined && !documentSettingsEqual(pending, docSettings)) return;
    const acknowledgedPendingUpdate = pending !== undefined;
    if (!acknowledgedPendingUpdate
      && !documentSettingsEqual(latestDocSettingsRef.current, docSettings)) {
      // An explicit replacement/reload owns a new settings baseline. Local
      // updates set pending first and therefore never take this path.
      panelBaselineRef.current = docSettings;
    }
    latestDocSettingsRef.current = docSettings;
    setDraftDocSettings(docSettings);
    if (!acknowledgedPendingUpdate) setCustomPaletteOpen(false);
    pendingDocSettingsRef.current = undefined;
  }, [docSettings]);

  React.useEffect(() => {
    const previousStatus = previousSyncStatusRef.current;
    if (previousStatus === 'conflict' && syncState?.status !== 'conflict') {
      // Both conflict decisions establish a new agreed persistence baseline.
      panelBaselineRef.current = latestDocSettingsRef.current;
    }
    previousSyncStatusRef.current = syncState?.status;
  }, [syncState?.status]);

  React.useEffect(() => {
    if (headingPalette === 'custom') setCustomPaletteOpen(true);
  }, [headingPalette]);

  const emitSettings = useCallback((settings: Partial<DocumentSettings> | null) => {
    latestDocSettingsRef.current = settings;
    pendingDocSettingsRef.current = settings;
    setDraftDocSettings(settings);
    onUpdateSettings(settings);
  }, [onUpdateSettings]);

  const updateField = useCallback(<K extends keyof DocumentSettings>(
    key: K,
    value: DocumentSettings[K],
  ) => {
    emitSettings(mergeDocumentSetting(latestDocSettingsRef.current, key, value));
  }, [emitSettings]);

  const resetGroupToHostDefaults = useCallback((keys: ReadonlyArray<keyof DocumentSettings>) => {
    if (keys.some((key) => APPEARANCE_KEYS.includes(key))) setCustomPaletteOpen(false);
    emitSettings(removeSettingsOverrides(latestDocSettingsRef.current, keys));
  }, [emitSettings]);

  const undoGroup = useCallback((keys: readonly DocumentSettingKey[]) => {
    emitSettings(restoreSettingsGroupBaseline(
      latestDocSettingsRef.current,
      panelBaselineRef.current,
      keys,
    ));
  }, [emitSettings]);

  const materializeGroup = useCallback((keys: readonly DocumentSettingKey[]) => {
    emitSettings(materializeSettingsGroup(
      latestDocSettingsRef.current,
      resolvedSnapshot,
      keys,
    ));
  }, [emitSettings, resolvedSnapshot]);

  const handleNumberingModeChange = useCallback((mode: 'sequential' | 'hierarchical') => {
    emitSettings({
      ...(latestDocSettingsRef.current ?? {}),
      captionNumbering: mode,
      equationNumbering: mode,
    });
  }, [emitSettings]);

  const handleHeadingPaletteChange = useCallback((
    palette: SelectableHeadingPalette,
    customColor?: string,
  ) => {
    emitSettings(applyHeadingPalette(
      latestDocSettingsRef.current,
      palette,
      customColor ?? displaySettings.headingH1Color,
    ));
  }, [displaySettings.headingH1Color, emitSettings]);

  const selectHeadingPalette = useCallback((palette: Exclude<SelectableHeadingPalette, 'custom'>) => {
    setCustomPaletteOpen(false);
    handleHeadingPaletteChange(palette);
  }, [handleHeadingPaletteChange]);

  const handleTextFieldCommit = useCallback((
    key: CssFileTargetOption['pathKey'] | 'outputDir',
    value: string,
  ) => {
    const trimmedValue = value.trim();
    const nextSettings = { ...(latestDocSettingsRef.current ?? {}) };
    if (trimmedValue.length > 0) nextSettings[key] = trimmedValue;
    else delete nextSettings[key];
    emitSettings(Object.keys(nextSettings).length > 0 ? nextSettings : null);
  }, [emitSettings]);

  const renderAppearance = exportMode === 'settings';
  const renderNumbering = exportMode === 'settings';
  const renderExport = exportMode === 'export';
  const renderSlides = exportMode === 'export' || exportMode === 'slides';
  const renderAdvanced = exportMode !== 'settings';
  const title = exportMode === 'settings'
    ? t('settings.title')
    : exportMode === 'export' ? t('settings.exportOptions') : t('settings.slideOptions');
  const hostDefaultsLabel = t('settings.hostDefaults');
  const renderGroupActions = (keys: readonly DocumentSettingKey[]) => {
    const changedCount = countChangedSettings(
      draftDocSettings,
      panelBaselineRef.current,
      keys,
    );
    return (
      <div className="settings-group-actions">
        <div className="settings-change-summary" role="status">
          {t('settings.changesSinceOpen', { count: changedCount })}
        </div>
        <div className="settings-group-action-buttons">
          <button
            type="button"
            className="settings-reset-btn"
            onClick={() => undoGroup(keys)}
            disabled={changedCount === 0}
          >
            {t('settings.undoGroup')}
          </button>
          <button
            type="button"
            className="settings-reset-btn"
            onClick={() => materializeGroup(keys)}
          >
            {t('settings.pinEffective')}
          </button>
          <button
            type="button"
            className="settings-reset-btn"
            onClick={() => resetGroupToHostDefaults(keys)}
          >
            {hostDefaultsLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="settings-panel">
      <div className="settings-panel-title">{title}</div>
      {exportMode === 'settings' && (
        <>
          <div className="settings-panel-description">
            {t('settings.documentSavedDescription')}
          </div>
          {syncState && (
            <div
              className={`settings-sync-state is-${syncPresentation.tone}`}
              role="status"
              aria-live="polite"
            >
              <span>{t(syncPresentation.labelKey)}</span>
              {syncPresentation.detail && <span>{syncPresentation.detail}</span>}
              {syncPresentation.canRetry && onRetrySync && (
                <button type="button" onClick={onRetrySync}>{t('common.retry')}</button>
              )}
            </div>
          )}
        </>
      )}

      {renderAppearance && (
        <CollapsibleSection title={t('settings.documentAppearance')} defaultOpen>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.decoration')}
              settingKey="headingDecoration"
              snapshot={resolvedSnapshot}
            />
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.decoration')}
              checked={displaySettings.headingDecoration}
              onChange={(event) => updateField('headingDecoration', event.target.checked)}
            />
          </div>
          <div className="settings-row settings-palette-row">
            <SettingLabel
              as="span"
              label={t('settings.headingPalette')}
              settingKey="headingH1Color"
              snapshot={resolvedSnapshot}
            />
            <div className="settings-palette-layout">
              <div className="settings-palette-grid" role="group" aria-label={t('settings.headingPalette')}>
              {([
                ['blue', t('settings.presetBlue'), HEADING_PALETTE_COLORS.blue],
                ['heritage-red', t('settings.presetHeritageRed'), HEADING_PALETTE_COLORS['heritage-red']],
                ['black', t('settings.presetBlack'), HEADING_PALETTE_COLORS.black],
              ] as const).map(([palette, label, color]) => {
                const selected = headingPalette === palette && !customPaletteOpen;
                return (
                <button
                  key={palette}
                  type="button"
                  className={`settings-palette-card${selected ? ' is-active' : ''}`}
                  aria-label={`${label}, ${color}`}
                  aria-pressed={selected}
                  onClick={() => selectHeadingPalette(palette)}
                >
                  <span className="settings-palette-swatch" style={{ backgroundColor: color }} />
                  <span className="settings-palette-name">{label}</span>
                  <span className="settings-palette-hex">{color}</span>
                  {selected && <span className="settings-palette-check" aria-hidden="true">✓</span>}
                </button>
                );
              })}
              <button
                type="button"
                className={`settings-palette-card${customPaletteOpen ? ' is-active' : ''}`}
                aria-label={`${t('settings.custom')}, ${displaySettings.headingH1Color.toUpperCase()}`}
                aria-pressed={customPaletteOpen}
                onClick={() => setCustomPaletteOpen(true)}
              >
                <span className="settings-palette-swatch" style={{ backgroundColor: displaySettings.headingH1Color }} />
                <span className="settings-palette-name">{t('settings.custom')}</span>
                <span className="settings-palette-hex">{displaySettings.headingH1Color.toUpperCase()}</span>
                {customPaletteOpen && <span className="settings-palette-check" aria-hidden="true">✓</span>}
              </button>
              </div>
              {headingPalette === 'mixed' && (
                <div className="settings-palette-mixed-notice" role="status">
                  {t('settings.mixedPaletteDescription')}
                </div>
              )}
              {customPaletteOpen && (
                <div className="settings-custom-palette-controls">
                  <input
                    type="color"
                    className="settings-custom-palette-picker"
                    value={toNativeColorValue(displaySettings.headingH1Color)}
                    aria-label={t('settings.customPalettePicker')}
                    onChange={(event) => handleHeadingPaletteChange('custom', event.target.value.toUpperCase())}
                  />
                  <DeferredTextInput
                    value={displaySettings.headingH1Color.toUpperCase()}
                    placeholder="#2563EB"
                    ariaLabel={t('settings.customPaletteHex')}
                    pattern="^#[0-9a-fA-F]{6}$"
                    maxLength={7}
                    title={t('settings.customPaletteHexHint')}
                    errorMessage={t('settings.customPaletteHexHint')}
                    onCommit={(value) => {
                      if (/^#[0-9a-f]{6}$/i.test(value)) {
                        handleHeadingPaletteChange('custom', value.toUpperCase());
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <CollapsibleSection title={t('settings.advancedHeadingColors')}>
            {HEADING_LEVELS.map((level) => {
              const key = headingColorKey(level);
              return (
                <div className="settings-row settings-heading-color-row" key={key}>
                  <SettingLabel
                    label={t('settings.headingColor', { level })}
                    settingKey={key}
                    snapshot={resolvedSnapshot}
                  />
                  <HeadingColorControl
                    level={level}
                    value={displaySettings[key]}
                    onChange={(value) => {
                      setCustomPaletteOpen(false);
                      updateField(key, value);
                    }}
                  />
                </div>
              );
            })}
          </CollapsibleSection>
          {renderGroupActions(APPEARANCE_KEYS)}
        </CollapsibleSection>
      )}

      {renderNumbering && (
        <CollapsibleSection title={t('settings.numberingAndReferences')} defaultOpen>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.headingNumbering')}
              settingKey="headingNumbering"
              snapshot={resolvedSnapshot}
            />
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.headingNumbering')}
              checked={displaySettings.headingNumbering}
              onChange={(event) => updateField('headingNumbering', event.target.checked)}
            />
          </div>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.headingStartNumber')}
              settingKey="headingStartNumber"
              snapshot={resolvedSnapshot}
            />
            <input
              type="number"
              min={0}
              step={1}
              className="settings-text-input"
              aria-label={t('settings.headingStartNumber')}
              value={displaySettings.headingStartNumber}
              disabled={!displaySettings.headingNumbering}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isInteger(value) && value >= 0) updateField('headingStartNumber', value);
              }}
            />
          </div>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.captionStyle')}
              settingKey="captionStyle"
              snapshot={resolvedSnapshot}
            />
            <select
              className="settings-select"
              aria-label={t('settings.captionStyle')}
              value={displaySettings.captionStyle}
              onChange={(event) => updateField('captionStyle', event.target.value as CaptionStyleName)}
            >
              {CAPTION_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
              ))}
            </select>
          </div>
          <div className="settings-hint">
            {CAPTION_STYLE_OPTIONS.find(
              (option) => option.value === displaySettings.captionStyle,
            )?.description}
          </div>
          <div className="settings-row">
            <SettingLabel
              as="span"
              label={t('settings.numberingStyle')}
              settingKey="captionNumbering"
              snapshot={resolvedSnapshot}
            />
            <div className="settings-radio-group">
              <label className="settings-radio-label">
                <input
                  type="radio"
                  name="numberingMode"
                  value="sequential"
                  checked={displaySettings.captionNumbering !== 'hierarchical'}
                  onChange={() => handleNumberingModeChange('sequential')}
                />
                {t('settings.numberingSequential')}
              </label>
              <label className="settings-radio-label">
                <input
                  type="radio"
                  name="numberingMode"
                  value="hierarchical"
                  checked={displaySettings.captionNumbering === 'hierarchical'}
                  onChange={() => handleNumberingModeChange('hierarchical')}
                />
                {t('settings.numberingHierarchical')}
              </label>
            </div>
          </div>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.includeCaptionCrossRef')}
              settingKey="crossRefIncludeCaption"
              snapshot={resolvedSnapshot}
            />
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.includeCaptionCrossRef')}
              checked={displaySettings.crossRefIncludeCaption}
              onChange={(event) => updateField('crossRefIncludeCaption', event.target.checked)}
            />
          </div>
          {renderGroupActions(NUMBERING_KEYS)}
        </CollapsibleSection>
      )}

      {renderExport && (
        <>
        <CollapsibleSection title={t('settings.general')}>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.outputFolder')}
              settingKey="outputDir"
              snapshot={resolvedSnapshot}
            />
            <DeferredTextInput
              value={draftDocSettings?.outputDir ?? displaySettings.outputDir}
              placeholder="./export"
              ariaLabel={t('settings.outputFolder')}
              onCommit={(value) => handleTextFieldCommit('outputDir', value)}
            />
          </div>
          <div className="settings-hint">{t('settings.outputFolderHint')}</div>
          {renderGroupActions(['outputDir'])}
        </CollapsibleSection>
        <CollapsibleSection title="HTML">
          <div className="settings-row">
            <SettingLabel
              label={t('settings.htmlEmbedding')}
              settingKey="selfContained"
              snapshot={resolvedSnapshot}
            />
            <select
              className="settings-select"
              aria-label={t('settings.htmlEmbedding')}
              value={draftDocSettings?.selfContained ?? displaySettings.selfContained}
              onChange={(event) => updateField('selfContained', event.target.value as SelfContainedMode)}
            >
              {SELF_CONTAINED_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
              ))}
            </select>
          </div>
          {renderGroupActions(['selfContained', 'htmlCssPath'])}
        </CollapsibleSection>
        <CollapsibleSection title="PDF">
          <div className="settings-row">
            <SettingLabel
              label={t('settings.pdfScale')}
              settingKey="pdfScale"
              snapshot={resolvedSnapshot}
            />
            <DeferredNumberInput
              value={draftDocSettings?.pdfScale ?? displaySettings.pdfScale}
              min={10}
              max={200}
              ariaLabel={t('settings.pdfScale')}
              errorMessage={t('settings.pdfScaleError')}
              onCommit={(value) => updateField('pdfScale', value)}
            />
          </div>
          {renderGroupActions(['pdfScale'])}
        </CollapsibleSection>
        </>
      )}

      {renderSlides && (
        <CollapsibleSection title={t('settings.slides')}>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.slideSplit')}
              settingKey="slideBreakLevel"
              snapshot={resolvedSnapshot}
            />
            <select
              className="settings-select"
              aria-label={t('settings.slideSplit')}
              value={draftDocSettings?.slideBreakLevel ?? displaySettings.slideBreakLevel}
              onChange={(event) => updateField('slideBreakLevel', event.target.value as SlideBreakLevel)}
            >
              {SLIDE_BREAK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.titleSlide')}
              settingKey="showTitleSlide"
              snapshot={resolvedSnapshot}
            />
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.titleSlide')}
              checked={draftDocSettings?.showTitleSlide ?? displaySettings.showTitleSlide}
              onChange={(event) => updateField('showTitleSlide', event.target.checked)}
            />
          </div>
          <div className="settings-row">
            <SettingLabel
              label={t('settings.transition')}
              settingKey="slideTransition"
              snapshot={resolvedSnapshot}
            />
            <select
              className="settings-select"
              aria-label={t('settings.transition')}
              value={draftDocSettings?.slideTransition ?? displaySettings.slideTransition}
              onChange={(event) => updateField('slideTransition', event.target.value as SlideTransition)}
            >
              {SLIDE_TRANSITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>
          {renderGroupActions(SLIDE_KEYS)}
        </CollapsibleSection>
      )}

      {renderAdvanced && (
        <CollapsibleSection title={t('settings.advanced')}>
          {CSS_FILE_TARGET_OPTIONS.map(({ target, labelKey, pathKey, placeholder }) => {
            const label = t(labelKey);
            const cssPath = draftDocSettings?.[pathKey];
            const hasPath = typeof cssPath === 'string' && cssPath.length > 0;
            return (
              <div className="settings-row" key={target}>
                <SettingLabel label={label} settingKey={pathKey} snapshot={resolvedSnapshot} />
                {onSelectCssFile ? (
                  <div className="settings-file-picker">
                    <span className="settings-file-path" title={hasPath ? cssPath : t('settings.notSet')}>
                      {hasPath ? cssPath : t('settings.notSet')}
                    </span>
                    <button
                      type="button"
                      className="settings-file-btn"
                      onClick={() => onSelectCssFile(target)}
                      aria-label={t('settings.chooseFile', { label })}
                    >
                      …
                    </button>
                    {hasPath && onClearCssFile && (
                      <button
                        type="button"
                        className="settings-file-clear-btn"
                        onClick={() => onClearCssFile(target)}
                        aria-label={t('settings.clearFile', { label })}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ) : (
                  <DeferredTextInput
                    value={cssPath ?? ''}
                    placeholder={placeholder}
                    ariaLabel={label}
                    onCommit={(value) => handleTextFieldCommit(pathKey, value)}
                  />
                )}
              </div>
            );
          })}
          {renderGroupActions(ADVANCED_KEYS)}
        </CollapsibleSection>
      )}

      {exportMode === 'settings' && (
        <div className="settings-footer">
          <button
            type="button"
            className="settings-reset-btn"
            disabled={countChangedSettings(
              draftDocSettings,
              panelBaselineRef.current,
              ALL_SETTINGS_KEYS,
            ) === 0}
            onClick={() => undoGroup(ALL_SETTINGS_KEYS)}
          >
            {t('settings.undoAll')}
          </button>
          {confirmResetAll ? (
            <div role="group" aria-label={t('settings.resetConfirmGroup')}>
              <span>{t('settings.resetConfirmPrompt')}</span>
              <button
                type="button"
                className="settings-reset-btn"
                onClick={() => {
                  setConfirmResetAll(false);
                  setCustomPaletteOpen(false);
                  emitSettings(null);
                }}
              >
                {t('settings.resetConfirm')}
              </button>
              <button
                type="button"
                className="settings-reset-btn"
                onClick={() => setConfirmResetAll(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="settings-reset-btn"
              onClick={() => setConfirmResetAll(true)}
              title={t('settings.resetTitle')}
            >
              {t('settings.resetAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
