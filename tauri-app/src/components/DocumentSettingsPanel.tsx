import React, { useCallback } from 'react';
import { useEditorContext } from '../context/EditorContext';
import type { DocumentSettings, CaptionStyleName } from '@shared/types';

interface DocumentSettingsPanelProps {
  onUpdateSettings: (settings: Partial<DocumentSettings> | null) => void;
}

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

export const DocumentSettingsPanel: React.FC<DocumentSettingsPanelProps> = ({ onUpdateSettings }) => {
  const { state } = useEditorContext();
  const docSettings = state.docSettings;
  const mergedSettings = state.settings;

  const updateField = useCallback(<K extends keyof DocumentSettings>(key: K, value: DocumentSettings[K]) => {
    const next = { ...docSettings, [key]: value };
    onUpdateSettings(next);
  }, [docSettings, onUpdateSettings]);

  const handleNumberingModeChange = useCallback((mode: 'sequential' | 'hierarchical') => {
    onUpdateSettings({
      ...docSettings,
      captionNumbering: mode === 'hierarchical' ? 'hierarchical' : 'sequential',
      equationNumbering: mode,
    });
  }, [docSettings, onUpdateSettings]);

  const handleResetAll = useCallback(() => {
    onUpdateSettings(null);
  }, [onUpdateSettings]);

  return (
    <div className="settings-panel">
      <div className="settings-panel-title">문서 설정</div>

      <CollapsibleSection title="제목 / 번호">
        <div className="settings-row">
          <label className="settings-label">번호 매김</label>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={mergedSettings.headingNumbering}
            onChange={(e) => updateField('headingNumbering', e.target.checked)}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">데코레이션</label>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={mergedSettings.headingDecoration}
            onChange={(e) => updateField('headingDecoration', e.target.checked)}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">H1 색상</label>
          <div className="settings-color-wrapper">
            <input
              type="color"
              className="settings-color"
              value={mergedSettings.headingH1Color}
              onChange={(e) => updateField('headingH1Color', e.target.value)}
            />
            <span className="settings-color-value">{mergedSettings.headingH1Color}</span>
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">H2 색상</label>
          <div className="settings-color-wrapper">
            <input
              type="color"
              className="settings-color"
              value={mergedSettings.headingH2Color}
              onChange={(e) => updateField('headingH2Color', e.target.value)}
            />
            <span className="settings-color-value">{mergedSettings.headingH2Color}</span>
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">H3 색상</label>
          <div className="settings-color-wrapper">
            <input
              type="color"
              className="settings-color"
              value={mergedSettings.headingH3Color}
              onChange={(e) => updateField('headingH3Color', e.target.value)}
            />
            <span className="settings-color-value">{mergedSettings.headingH3Color}</span>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="캡션 / 번호">
        <div className="settings-row">
          <label className="settings-label">캡션 스타일</label>
          <select
            className="settings-select"
            value={mergedSettings.captionStyle}
            onChange={(e) => updateField('captionStyle', e.target.value as CaptionStyleName)}
          >
            {CAPTION_STYLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-hint">
          {CAPTION_STYLE_OPTIONS.find(o => o.value === mergedSettings.captionStyle)?.description}
        </div>
        <div className="settings-row">
          <label className="settings-label">번호 방식</label>
          <div className="settings-radio-group">
            <label className="settings-radio-label">
              <input
                type="radio"
                name="numberingMode"
                value="sequential"
                checked={mergedSettings.captionNumbering !== 'hierarchical'}
                onChange={() => handleNumberingModeChange('sequential')}
              />
              Sequential
            </label>
            <label className="settings-radio-label">
              <input
                type="radio"
                name="numberingMode"
                value="hierarchical"
                checked={mergedSettings.captionNumbering === 'hierarchical'}
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
            checked={mergedSettings.crossRefIncludeCaption}
            onChange={(e) => updateField('crossRefIncludeCaption', e.target.checked)}
          />
        </div>
      </CollapsibleSection>

      <div className="settings-footer">
        <button
          className="settings-reset-btn"
          onClick={handleResetAll}
          title="문서별 설정을 삭제하고 전역 설정으로 복원합니다"
        >
          🔄 기본값 불러오기
        </button>
      </div>
    </div>
  );
};
