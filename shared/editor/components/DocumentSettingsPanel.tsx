import React, { useCallback } from 'react';
import { useEditorContext } from '@shared/editor/context/EditorContext';
import { HEADING_COLOR_PRESETS } from '@shared/editor/constants/colors';
import {
  HEADING_LEVELS,
  headingColorKey,
  type HeadingLevel,
} from '@shared/editor/constants/headings';
import type {
  CaptionStyleName,
  DocumentSettings,
  SelfContainedMode,
  SlideBreakLevel,
  SlideTransition,
} from '@shared/types';
export interface DocumentSettingsPanelProps {
  onUpdateSettings: (settings: Partial<DocumentSettings> | null) => void;
  onSelectCssFile?: (target: CssTarget) => void;
  onClearCssFile?: (target: CssTarget) => void;
}

export type CssTarget = 'slide' | 'html';

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="settings-section">
      <button className="settings-section-header" onClick={() => setOpen(v => !v)}>
        <span className={`settings-chevron ${open ? 'open' : ''}`}>▶</span>
        <span>{title}</span>
      </button>
      {open && <div className="settings-section-body">{children}</div>}
    </div>
  );
};

const CAPTION_STYLE_OPTIONS: { value: CaptionStyleName; label: string; description: string }[] = [
  { value: 'ieee', label: 'IEEE (간결형)', description: 'Fig. 1, Table I, (1)' },
  { value: 'iso', label: 'ISO/IEC (정석형)', description: 'Figure 1, Table 1, Equation (1)' },
  { value: 'modern', label: 'Modern (현대형)', description: 'Figure 1, Table 1, Equation 1' },
  { value: 'korean', label: 'Korean (한국형)', description: '그림 1, 표 1, 식 (1)' },
];

interface CssFileTargetOption {
  target: CssTarget;
  label: string;
  pathKey: 'slideCssPath' | 'htmlCssPath';
  placeholder: string;
}

const CSS_FILE_TARGET_OPTIONS: CssFileTargetOption[] = [
  { target: 'slide', label: 'Slide CSS', pathKey: 'slideCssPath', placeholder: './theme/slide.css' },
  { target: 'html', label: 'HTML CSS', pathKey: 'htmlCssPath', placeholder: './theme/html.css' },
];

const UNSET_CSS_PATH_LABEL = '(설정 안됨)';

const SELF_CONTAINED_OPTIONS: { value: SelfContainedMode; label: string }[] = [
  { value: 'none', label: '외부 파일 참조' },
  { value: 'images-only', label: '이미지만 포함' },
  { value: 'full', label: '완전 포함' },
];

const SLIDE_BREAK_OPTIONS: { value: SlideBreakLevel; label: string }[] = [
  { value: 'h1-only', label: 'H1마다 새 슬라이드' },
  { value: 'h1-h2-vertical', label: 'H1 수평 / H2 수직' },
];

const SLIDE_TRANSITION_OPTIONS: { value: SlideTransition; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'convex', label: 'Convex' },
  { value: 'concave', label: 'Concave' },
  { value: 'zoom', label: 'Zoom' },
];

interface HeadingColorControlProps {
  level: HeadingLevel;
  value: string;
  onChange: (value: string) => void;
}

const toNativeColorValue = (value: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : '#2563EB';
};

const HeadingColorControl: React.FC<HeadingColorControlProps> = ({ level, value, onChange }) => {
  const nativePickerRef = React.useRef<HTMLInputElement>(null);
  const normalizedValue = value.toLowerCase();
  const isPresetValue = HEADING_COLOR_PRESETS.some(
    ({ value: preset }) => preset.toLowerCase() === normalizedValue,
  );

  return (
    <div className="settings-heading-color-control">
      <div className="settings-heading-color-presets" role="group" aria-label={`H${level} 대표 색상`}>
        {HEADING_COLOR_PRESETS.map(({ label, value: preset }) => (
          <button
            key={preset}
            type="button"
            className={`settings-heading-color-swatch settings-heading-color-preset${normalizedValue === preset.toLowerCase() ? ' is-active' : ''}`}
            style={{ backgroundColor: preset }}
            aria-label={`H${level} ${label}`}
            aria-pressed={normalizedValue === preset.toLowerCase()}
            title={label}
            onClick={() => onChange(preset)}
          />
        ))}
        <button
          type="button"
          className={`settings-heading-color-swatch settings-heading-color-custom-button${isPresetValue ? '' : ' is-active'}`}
          aria-label={`H${level} 사용자 지정 색상`}
          aria-pressed={!isPresetValue}
          title="사용자 지정 색상 선택"
          onClick={() => nativePickerRef.current?.click()}
        />
      </div>
      <input
        ref={nativePickerRef}
        type="color"
        className="settings-heading-color-native-picker"
        value={toNativeColorValue(value)}
        aria-label={`H${level} RGB Color Picker`}
        tabIndex={-1}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
};

export function mergeDocumentSetting<K extends keyof DocumentSettings>(
  settings: Partial<DocumentSettings> | null,
  key: K,
  value: DocumentSettings[K],
): Partial<DocumentSettings> {
  return { ...(settings ?? {}), [key]: value };
}

const documentSettingsEqual = (
  left: Partial<DocumentSettings> | null,
  right: Partial<DocumentSettings> | null,
): boolean => {
  const leftRecord = left ?? {};
  const rightRecord = right ?? {};
  const leftKeys = Object.keys(leftRecord) as Array<keyof DocumentSettings>;
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => leftRecord[key] === rightRecord[key]);
};

interface DeferredTextInputProps {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}

const DeferredTextInput: React.FC<DeferredTextInputProps> = ({ value, placeholder, onCommit }) => {
  const [draft, setDraft] = React.useState(value);
  const skipCommitOnBlurRef = React.useRef(false);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleCommit = useCallback(() => {
    if (skipCommitOnBlurRef.current) {
      skipCommitOnBlurRef.current = false;
      return;
    }

    if (draft !== value) {
      onCommit(draft);
    }
  }, [draft, onCommit, value]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      skipCommitOnBlurRef.current = true;
      setDraft(value);
      event.currentTarget.blur();
    }
  }, [value]);

  return (
    <input
      type="text"
      className="settings-text-input settings-path-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={handleCommit}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      spellCheck={false}
    />
  );
};

export const DocumentSettingsPanel: React.FC<DocumentSettingsPanelProps> = ({
  onUpdateSettings,
  onSelectCssFile,
  onClearCssFile,
}) => {
  const { state } = useEditorContext();
  const docSettings = state.docSettings;
  const mergedSettings = state.settings;
  const latestDocSettingsRef = React.useRef<Partial<DocumentSettings> | null>(docSettings);
  const pendingDocSettingsRef = React.useRef<Partial<DocumentSettings> | null | undefined>(undefined);
  const [draftDocSettings, setDraftDocSettings] = React.useState<Partial<DocumentSettings> | null>(docSettings);
  const displaySettings = { ...mergedSettings, ...(draftDocSettings ?? {}) };

  React.useEffect(() => {
    const pending = pendingDocSettingsRef.current;
    if (pending !== undefined && !documentSettingsEqual(pending, docSettings)) return;
    latestDocSettingsRef.current = docSettings;
    setDraftDocSettings(docSettings);
    pendingDocSettingsRef.current = undefined;
  }, [docSettings]);

  const emitSettings = useCallback((settings: Partial<DocumentSettings> | null) => {
    latestDocSettingsRef.current = settings;
    pendingDocSettingsRef.current = settings;
    setDraftDocSettings(settings);
    onUpdateSettings(settings);
  }, [onUpdateSettings]);

  const updateField = useCallback(<K extends keyof DocumentSettings>(key: K, value: DocumentSettings[K]) => {
    emitSettings(mergeDocumentSetting(latestDocSettingsRef.current, key, value));
  }, [emitSettings]);

  const handleNumberingModeChange = useCallback((mode: 'sequential' | 'hierarchical') => {
    emitSettings({
      ...(latestDocSettingsRef.current ?? {}),
      captionNumbering: mode === 'hierarchical' ? 'hierarchical' : 'sequential',
      equationNumbering: mode,
    });
  }, [emitSettings]);

  const handleResetAll = useCallback(() => {
    emitSettings(null);
  }, [emitSettings]);

  const handleTextFieldCommit = useCallback((key: CssFileTargetOption['pathKey'] | 'outputDir', value: string) => {
    const trimmedValue = value.trim();
    const nextSettings: Partial<DocumentSettings> = { ...(latestDocSettingsRef.current ?? {}) };
    if (trimmedValue.length > 0) {
      nextSettings[key] = trimmedValue;
    } else {
      delete nextSettings[key];
    }
    emitSettings(Object.keys(nextSettings).length > 0 ? nextSettings : null);
  }, [emitSettings]);

  return (
    <div className="settings-panel">
      <div className="settings-panel-title">문서 설정</div>

      <CollapsibleSection title="제목 / 번호">
        <div className="settings-row">
          <label className="settings-label">번호 매김</label>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={displaySettings.headingNumbering}
            onChange={(e) => updateField('headingNumbering', e.target.checked)}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">데코레이션</label>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={displaySettings.headingDecoration}
            onChange={(e) => updateField('headingDecoration', e.target.checked)}
          />
        </div>
        {HEADING_LEVELS.map((level) => {
          const key = headingColorKey(level);
          return (
            <div className="settings-row settings-heading-color-row" key={key}>
              <label className="settings-label">H{level} 색상</label>
              <HeadingColorControl
                level={level}
                value={displaySettings[key]}
                onChange={(value) => updateField(key, value)}
              />
            </div>
          );
        })}
      </CollapsibleSection>

      <CollapsibleSection title="캡션 / 번호">
        <div className="settings-row">
          <label className="settings-label">캡션 스타일</label>
          <select
            className="settings-select"
            value={displaySettings.captionStyle}
            onChange={(e) => updateField('captionStyle', e.target.value as CaptionStyleName)}
          >
            {CAPTION_STYLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-hint">
          {CAPTION_STYLE_OPTIONS.find(o => o.value === displaySettings.captionStyle)?.description}
        </div>
        <div className="settings-row">
          <label className="settings-label">번호 방식</label>
          <div className="settings-radio-group">
            <label className="settings-radio-label">
              <input
                type="radio"
                name="numberingMode"
                value="sequential"
                checked={displaySettings.captionNumbering !== 'hierarchical'}
                onChange={() => handleNumberingModeChange('sequential')}
              />
              Sequential
            </label>
            <label className="settings-radio-label">
              <input
                type="radio"
                name="numberingMode"
                value="hierarchical"
                checked={displaySettings.captionNumbering === 'hierarchical'}
                onChange={() => handleNumberingModeChange('hierarchical')}
              />
              Hierarchical
            </label>
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">CrossRef에 캡션 포함</label>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={displaySettings.crossRefIncludeCaption}
            onChange={(e) => updateField('crossRefIncludeCaption', e.target.checked)}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="스타일 (Export CSS)">
        {CSS_FILE_TARGET_OPTIONS.map(({ target, label, pathKey, placeholder }) => {
          const cssPath = draftDocSettings?.[pathKey];
          const hasPath = typeof cssPath === 'string' && cssPath.length > 0;

          return (
            <div className="settings-row" key={target}>
              <label className="settings-label">{label}</label>
              {onSelectCssFile ? <div className="settings-file-picker">
                <span className="settings-file-path" title={hasPath ? cssPath : UNSET_CSS_PATH_LABEL}>
                  {hasPath ? cssPath : UNSET_CSS_PATH_LABEL}
                </span>
                <button
                  type="button"
                  className="settings-file-btn"
                  onClick={() => onSelectCssFile(target)}
                  title={`${label} 선택`}
                >
                  📁
                </button>
                {hasPath && onClearCssFile && (
                  <button
                    type="button"
                    className="settings-file-clear-btn"
                    onClick={() => onClearCssFile(target)}
                    title={`${label} 지우기`}
                  >
                    ✕
                  </button>
                )}
              </div> : <DeferredTextInput
                value={cssPath ?? ''}
                placeholder={placeholder}
                onCommit={(value) => handleTextFieldCommit(pathKey, value)}
              />}
            </div>
          );
        })}
      </CollapsibleSection>

      <CollapsibleSection title="내보내기 (Export)">
        <div className="settings-row">
          <label className="settings-label">PDF 배율</label>
          <input
            type="number"
            className="settings-number-input"
            min={10}
            max={200}
            step={5}
            value={draftDocSettings?.pdfScale ?? displaySettings.pdfScale}
            onChange={(e) => updateField('pdfScale', Math.min(200, Math.max(10, Number(e.target.value) || 70)))}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">HTML 포함 수준</label>
          <select
            className="settings-select"
            value={draftDocSettings?.selfContained ?? displaySettings.selfContained}
            onChange={(e) => updateField('selfContained', e.target.value as SelfContainedMode)}
          >
            {SELF_CONTAINED_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label className="settings-label">출력 폴더</label>
          <DeferredTextInput
            value={draftDocSettings?.outputDir ?? displaySettings.outputDir}
            placeholder="./export"
            onCommit={(value) => handleTextFieldCommit('outputDir', value)}
          />
        </div>
        <div className="settings-hint">
          비워두면 문서와 같은 폴더에 저장합니다. 상대 경로는 워크스페이스 기준입니다.
        </div>
        <div className="settings-row">
          <label className="settings-label">슬라이드 분리</label>
          <select
            className="settings-select"
            value={draftDocSettings?.slideBreakLevel ?? displaySettings.slideBreakLevel}
            onChange={(e) => updateField('slideBreakLevel', e.target.value as SlideBreakLevel)}
          >
            {SLIDE_BREAK_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label className="settings-label">타이틀 슬라이드</label>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={draftDocSettings?.showTitleSlide ?? displaySettings.showTitleSlide}
            onChange={(e) => updateField('showTitleSlide', e.target.checked)}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">전환 효과</label>
          <select
            className="settings-select"
            value={draftDocSettings?.slideTransition ?? displaySettings.slideTransition}
            onChange={(e) => updateField('slideTransition', e.target.value as SlideTransition)}
          >
            {SLIDE_TRANSITION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </CollapsibleSection>

      <div className="settings-footer">
        <button
          className="settings-reset-btn"
          onClick={handleResetAll}
          title="문서별 설정을 삭제하고 VS Code 전역 설정으로 복원합니다"
        >
          🔄 기본값 불러오기
        </button>
      </div>
    </div>
  );
};
