import React, { useCallback } from 'react';
import { useEditorContext } from '../context/EditorContext';
import type { DocumentSettings } from '@shared/types';

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

export const DocumentSettingsPanel: React.FC<DocumentSettingsPanelProps> = ({ onUpdateSettings }) => {
  const { state } = useEditorContext();
  const docSettings = state.docSettings;
  const mergedSettings = state.settings;

  const updateField = useCallback(<K extends keyof DocumentSettings>(key: K, value: DocumentSettings[K]) => {
    const next = { ...docSettings, [key]: value };
    onUpdateSettings(next);
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

      <CollapsibleSection title="캡션">
        <div className="settings-row">
          <label className="settings-label">이미지 접두사</label>
          <input
            type="text"
            className="settings-text-input"
            value={mergedSettings.imageCaptionPrefix}
            onChange={(e) => updateField('captionImagePrefix', e.target.value)}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">표 접두사</label>
          <input
            type="text"
            className="settings-text-input"
            value={mergedSettings.tableCaptionPrefix}
            onChange={(e) => updateField('captionTablePrefix', e.target.value)}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">번호 방식</label>
          <div className="settings-radio-group">
            <label className="settings-radio-label">
              <input
                type="radio"
                name="captionNumbering"
                value="simple"
                checked={mergedSettings.captionNumbering === 'simple'}
                onChange={() => updateField('captionNumbering', 'simple')}
              />
              Simple
            </label>
            <label className="settings-radio-label">
              <input
                type="radio"
                name="captionNumbering"
                value="hierarchical"
                checked={mergedSettings.captionNumbering === 'hierarchical'}
                onChange={() => updateField('captionNumbering', 'hierarchical')}
              />
              Hierarchical
            </label>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="방정식">
        <div className="settings-row">
          <label className="settings-label">번호 방식</label>
          <div className="settings-radio-group">
            <label className="settings-radio-label">
              <input
                type="radio"
                name="equationNumbering"
                value="sequential"
                checked={mergedSettings.equationNumbering === 'sequential'}
                onChange={() => updateField('equationNumbering', 'sequential')}
              />
              Sequential
            </label>
            <label className="settings-radio-label">
              <input
                type="radio"
                name="equationNumbering"
                value="hierarchical"
                checked={mergedSettings.equationNumbering === 'hierarchical'}
                onChange={() => updateField('equationNumbering', 'hierarchical')}
              />
              Hierarchical
            </label>
          </div>
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
