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
  DocumentSettings,
  SelfContainedMode,
  SlideBreakLevel,
  SlideTransition,
} from '@shared/types';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

export type CssTarget = 'slide' | 'html';
export type DocumentSettingsExportMode = 'settings' | 'export' | 'slides';

export interface DocumentSettingsPanelProps {
  onUpdateSettings: (settings: Partial<DocumentSettings> | null) => void;
  onSelectCssFile?: (target: CssTarget) => void;
  onClearCssFile?: (target: CssTarget) => void;
  exportMode?: DocumentSettingsExportMode;
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

interface DeferredTextInputProps {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
  pattern?: string;
  maxLength?: number;
  title?: string;
}

const DeferredTextInput: React.FC<DeferredTextInputProps> = ({
  value,
  placeholder,
  onCommit,
  ariaLabel,
  pattern,
  maxLength,
  title,
}) => {
  const [draft, setDraft] = React.useState(value);
  const skipCommitOnBlurRef = React.useRef(false);
  const invalid = pattern ? !new RegExp(pattern).test(draft) : false;

  React.useEffect(() => setDraft(value), [value]);

  const handleCommit = useCallback(() => {
    if (skipCommitOnBlurRef.current) {
      skipCommitOnBlurRef.current = false;
      return;
    }
    if (draft !== value) onCommit(draft);
  }, [draft, onCommit, value]);

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
      pattern={pattern}
      maxLength={maxLength}
      title={title}
      spellCheck={false}
    />
  );
};

interface GroupDefaultsButtonProps {
  onClick: () => void;
  label: string;
}

const GroupDefaultsButton: React.FC<GroupDefaultsButtonProps> = ({ onClick, label }) => (
  <button type="button" className="settings-reset-btn" onClick={onClick}>
    {label}
  </button>
);

export const DocumentSettingsPanel: React.FC<DocumentSettingsPanelProps> = ({
  onUpdateSettings,
  onSelectCssFile,
  onClearCssFile,
  exportMode = 'settings',
}) => {
  const { t } = useEditorI18n();
  const { state } = useEditorContext();
  const docSettings = state.docSettings;
  const mergedSettings = state.settings;
  const latestDocSettingsRef = React.useRef<Partial<DocumentSettings> | null>(docSettings);
  const pendingDocSettingsRef = React.useRef<Partial<DocumentSettings> | null | undefined>(undefined);
  const [draftDocSettings, setDraftDocSettings] = React.useState<Partial<DocumentSettings> | null>(docSettings);
  const [confirmResetAll, setConfirmResetAll] = React.useState(false);
  const displaySettings = { ...mergedSettings, ...(draftDocSettings ?? {}) };
  const headingPalette = getHeadingPalette(displaySettings);
  const [customPaletteOpen, setCustomPaletteOpen] = React.useState(
    headingPalette === 'custom',
  );

  React.useEffect(() => {
    const pending = pendingDocSettingsRef.current;
    if (pending !== undefined && !documentSettingsEqual(pending, docSettings)) return;
    const acknowledgedPendingUpdate = pending !== undefined;
    latestDocSettingsRef.current = docSettings;
    setDraftDocSettings(docSettings);
    if (!acknowledgedPendingUpdate) setCustomPaletteOpen(false);
    pendingDocSettingsRef.current = undefined;
  }, [docSettings]);

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
    emitSettings(removeDocumentSettings(latestDocSettingsRef.current, keys));
  }, [emitSettings]);

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

  return (
    <div className="settings-panel">
      <div className="settings-panel-title">{title}</div>
      {exportMode === 'settings' && (
        <div className="settings-panel-description">
          {t('settings.documentSavedDescription')}
        </div>
      )}

      {renderAppearance && (
        <CollapsibleSection title={t('settings.documentAppearance')} defaultOpen>
          <div className="settings-row">
            <label className="settings-label">{t('settings.decoration')}</label>
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.decoration')}
              checked={displaySettings.headingDecoration}
              onChange={(event) => updateField('headingDecoration', event.target.checked)}
            />
          </div>
          <div className="settings-row settings-palette-row">
            <span className="settings-label">{t('settings.headingPalette')}</span>
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
                  <label className="settings-label">
                    {t('settings.headingColor', { level })}
                  </label>
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
          <GroupDefaultsButton
            label={hostDefaultsLabel}
            onClick={() => {
              setCustomPaletteOpen(false);
              resetGroupToHostDefaults(APPEARANCE_KEYS);
            }}
          />
        </CollapsibleSection>
      )}

      {renderNumbering && (
        <CollapsibleSection title={t('settings.numberingAndReferences')} defaultOpen>
          <div className="settings-row">
            <label className="settings-label">{t('settings.headingNumbering')}</label>
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.headingNumbering')}
              checked={displaySettings.headingNumbering}
              onChange={(event) => updateField('headingNumbering', event.target.checked)}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label">{t('settings.headingStartNumber')}</label>
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
            <label className="settings-label">{t('settings.captionStyle')}</label>
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
            <span className="settings-label">{t('settings.numberingStyle')}</span>
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
            <label className="settings-label">{t('settings.includeCaptionCrossRef')}</label>
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.includeCaptionCrossRef')}
              checked={displaySettings.crossRefIncludeCaption}
              onChange={(event) => updateField('crossRefIncludeCaption', event.target.checked)}
            />
          </div>
          <GroupDefaultsButton label={hostDefaultsLabel} onClick={() => resetGroupToHostDefaults(NUMBERING_KEYS)} />
        </CollapsibleSection>
      )}

      {renderExport && (
        <>
        <CollapsibleSection title={t('settings.general')}>
          <div className="settings-row">
            <label className="settings-label">{t('settings.outputFolder')}</label>
            <DeferredTextInput
              value={draftDocSettings?.outputDir ?? displaySettings.outputDir}
              placeholder="./export"
              ariaLabel={t('settings.outputFolder')}
              onCommit={(value) => handleTextFieldCommit('outputDir', value)}
            />
          </div>
          <div className="settings-hint">{t('settings.outputFolderHint')}</div>
          <GroupDefaultsButton label={hostDefaultsLabel} onClick={() => resetGroupToHostDefaults(['outputDir'])} />
        </CollapsibleSection>
        <CollapsibleSection title="HTML">
          <div className="settings-row">
            <label className="settings-label">{t('settings.htmlEmbedding')}</label>
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
          <GroupDefaultsButton label={hostDefaultsLabel} onClick={() => resetGroupToHostDefaults(['selfContained', 'htmlCssPath'])} />
        </CollapsibleSection>
        <CollapsibleSection title="PDF">
          <div className="settings-row">
            <label className="settings-label">{t('settings.pdfScale')}</label>
            <input
              type="number"
              className="settings-number-input"
              aria-label={t('settings.pdfScale')}
              min={10}
              max={200}
              step={5}
              value={draftDocSettings?.pdfScale ?? displaySettings.pdfScale}
              onChange={(event) => updateField(
                'pdfScale',
                Math.min(200, Math.max(10, Number(event.target.value) || 70)),
              )}
            />
          </div>
          <GroupDefaultsButton label={hostDefaultsLabel} onClick={() => resetGroupToHostDefaults(['pdfScale'])} />
        </CollapsibleSection>
        </>
      )}

      {renderSlides && (
        <CollapsibleSection title={t('settings.slides')}>
          <div className="settings-row">
            <label className="settings-label">{t('settings.slideSplit')}</label>
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
            <label className="settings-label">{t('settings.titleSlide')}</label>
            <input
              type="checkbox"
              className="settings-toggle"
              aria-label={t('settings.titleSlide')}
              checked={draftDocSettings?.showTitleSlide ?? displaySettings.showTitleSlide}
              onChange={(event) => updateField('showTitleSlide', event.target.checked)}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label">{t('settings.transition')}</label>
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
          <GroupDefaultsButton label={hostDefaultsLabel} onClick={() => resetGroupToHostDefaults(SLIDE_KEYS)} />
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
                <label className="settings-label">{label}</label>
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
          <GroupDefaultsButton label={hostDefaultsLabel} onClick={() => resetGroupToHostDefaults(ADVANCED_KEYS)} />
        </CollapsibleSection>
      )}

      {exportMode === 'settings' && (
        <div className="settings-footer">
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
