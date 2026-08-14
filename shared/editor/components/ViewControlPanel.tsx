import React from 'react';
import type {
  TemporaryDocumentViewPreferences,
  TemporaryViewPreference,
} from '@shared/types';
import type { UiLanguagePreference } from '../i18n';
import { useEditorI18n } from '../i18n';

export interface ViewControlPanelProps {
  /** Legacy effective value, retained while hosts migrate to controlled preferences. */
  showNumbering: boolean;
  /** Legacy adapter, called only when a preference changes the effective value. */
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  uiLanguagePreference: UiLanguagePreference;
  onUiLanguagePreferenceChange: (preference: UiLanguagePreference) => void;
  viewPreferences?: Required<TemporaryDocumentViewPreferences>;
  onViewPreferencesChange?: (preferences: Required<TemporaryDocumentViewPreferences>) => void;
  controlledEffectiveValues?: boolean;
  documentValues?: {
    headingNumbering: boolean;
    headingDecoration: boolean;
  };
}

interface ViewPreferenceControlProps {
  label: string;
  value: TemporaryViewPreference;
  effectiveValue: boolean;
  onChange: (preference: TemporaryViewPreference) => void;
}

const ViewPreferenceControl: React.FC<ViewPreferenceControlProps> = ({
  label,
  value,
  effectiveValue,
  onChange,
}) => {
  const { t } = useEditorI18n();
  const provenance = t('settings.provenanceLine', {
    source: t('settings.sourceTemporary'),
    scope: t('settings.scopeSession'),
    portability: t('settings.sessionOnly'),
  });
  return (
    <label className="side-panel-control-row side-panel-view-preference">
      <span className="side-panel-control-copy">
        <span className="side-panel-toggle-label">{label}</span>
        <span className="side-panel-control-description">
          {t('panel.sessionOnlyValue', {
            value: effectiveValue ? t('panel.visible') : t('panel.hidden'),
          })}
        </span>
        {value !== 'follow-document' && (
          <span
            className="settings-provenance"
            title={provenance}
            aria-label={`${t('settings.valueOrigin')}: ${provenance}`}
          >
            {provenance}
          </span>
        )}
      </span>
      <select
        className="side-panel-select"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as TemporaryViewPreference)}
      >
        <option value="follow-document">{t('panel.followDocument')}</option>
        <option value="show">{t('panel.alwaysShow')}</option>
        <option value="hide">{t('panel.alwaysHide')}</option>
      </select>
    </label>
  );
};

export const ViewControlPanel: React.FC<ViewControlPanelProps> = ({
  showNumbering,
  onToggleNumbering,
  showDecoration,
  onToggleDecoration,
  uiLanguagePreference,
  onUiLanguagePreferenceChange,
  viewPreferences,
  onViewPreferencesChange,
  controlledEffectiveValues = false,
  documentValues,
}) => {
  const { t } = useEditorI18n();
  const fallbackPreferences = React.useMemo<Required<TemporaryDocumentViewPreferences>>(() => ({
    headingNumbering: 'follow-document',
    headingDecoration: 'follow-document',
  }), []);
  const preferences = viewPreferences ?? fallbackPreferences;

  const updatePreference = (
    key: keyof TemporaryDocumentViewPreferences,
    preference: TemporaryViewPreference,
  ) => {
    onViewPreferencesChange?.({ ...preferences, [key]: preference });
    if (controlledEffectiveValues) return;
    const documentValue = documentValues?.[key] ?? (key === 'headingNumbering'
      ? showNumbering
      : showDecoration);
    const nextEffective = preference === 'show'
      ? true
      : preference === 'hide' ? false : documentValue;
    const currentEffective = key === 'headingNumbering' ? showNumbering : showDecoration;
    if (nextEffective !== currentEffective) {
      (key === 'headingNumbering' ? onToggleNumbering : onToggleDecoration)();
    }
  };

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
      <ViewPreferenceControl
        label={t('panel.headingNumbering')}
        value={preferences.headingNumbering}
        effectiveValue={showNumbering}
        onChange={(preference) => updatePreference('headingNumbering', preference)}
      />
      <ViewPreferenceControl
        label={t('panel.headingDecoration')}
        value={preferences.headingDecoration}
        effectiveValue={showDecoration}
        onChange={(preference) => updatePreference('headingDecoration', preference)}
      />
    </div>
  );
};
