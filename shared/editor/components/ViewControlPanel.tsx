import React from 'react';
import type { UiLanguagePreference } from '../i18n';
import { useEditorI18n } from '../i18n';

export interface ViewControlPanelProps {
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  uiLanguagePreference: UiLanguagePreference;
  onUiLanguagePreferenceChange: (preference: UiLanguagePreference) => void;
}

export const ViewControlPanel: React.FC<ViewControlPanelProps> = ({
  showNumbering,
  onToggleNumbering,
  showDecoration,
  onToggleDecoration,
  uiLanguagePreference,
  onUiLanguagePreferenceChange,
}) => {
  const { t } = useEditorI18n();

  return (
    <div className="side-panel-section">
      <div className="side-panel-section-title">{t('panel.viewControls')}</div>
      <div className="side-panel-section-desc">{t('panel.viewOnlyDescription')}</div>
      <label className="side-panel-control-row">
        <span className="side-panel-control-copy">
          <span className="side-panel-toggle-label">{t('panel.interfaceLanguage')}</span>
          <span className="side-panel-control-description">
            {t('panel.interfaceLanguageDescription')}
          </span>
        </span>
        <select
          className="side-panel-select"
          aria-label={t('panel.interfaceLanguage')}
          value={uiLanguagePreference}
          onChange={(event) => {
            onUiLanguagePreferenceChange(event.target.value as UiLanguagePreference);
          }}
        >
          <option value="auto">{t('language.auto')}</option>
          <option value="ko">{t('language.korean')}</option>
          <option value="en">{t('language.english')}</option>
        </select>
      </label>
      <div className="side-panel-toggle-row">
        <span className="side-panel-toggle-label">{t('panel.headingNumbering')}</span>
        <button
          type="button"
          className={`side-panel-toggle-btn${showNumbering ? ' is-active' : ''}`}
          onClick={onToggleNumbering}
          title={t(showNumbering ? 'panel.hideNumbering' : 'panel.showNumbering')}
          aria-label={t(showNumbering ? 'panel.hideNumbering' : 'panel.showNumbering')}
          aria-pressed={showNumbering}
        >
          {showNumbering ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="side-panel-toggle-row">
        <span className="side-panel-toggle-label">{t('panel.headingDecoration')}</span>
        <button
          type="button"
          className={`side-panel-toggle-btn${showDecoration ? ' is-active' : ''}`}
          onClick={onToggleDecoration}
          title={t(showDecoration ? 'panel.hideDecoration' : 'panel.showDecoration')}
          aria-label={t(showDecoration ? 'panel.hideDecoration' : 'panel.showDecoration')}
          aria-pressed={showDecoration}
        >
          {showDecoration ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
};
