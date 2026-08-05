import React, { useEffect, useState } from 'react';
import type {
  DiagramRendererSettings,
  ResolvedDiagramRendererConsent,
} from '../../diagramRenderer';
import { useEditorI18n } from '../i18n';
import { DiagramRendererConsentPanel } from './DiagramRendererConsentPanel';

interface DiagramRendererSettingsPanelProps {
  settings: DiagramRendererSettings;
  onChange: (settings: DiagramRendererSettings) => void;
  onResolveConsent?: (
    consent: ResolvedDiagramRendererConsent,
  ) => Promise<void>;
  onTest?: (settings: DiagramRendererSettings) => Promise<void>;
  showUndecidedConsent?: boolean;
}

export const DiagramRendererSettingsPanel: React.FC<DiagramRendererSettingsPanelProps> = ({
  settings,
  onChange,
  onResolveConsent,
  onTest,
  showUndecidedConsent = true,
}) => {
  const { t } = useEditorI18n();
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [testState, setTestState] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle');
  const [consentUpdateState, setConsentUpdateState] =
    useState<'idle' | 'running' | 'failed'>('idle');
  useEffect(() => setEndpoint(settings.endpoint), [settings.endpoint]);

  const commitEndpoint = () => {
    const trimmed = endpoint.trim();
    if (trimmed && trimmed !== settings.endpoint) {
      onChange({ ...settings, endpoint: trimmed });
    }
  };

  return (
    <section className="diagram-renderer-settings" aria-labelledby="diagram-renderer-title">
      <div id="diagram-renderer-title" className="side-panel-section-title">
        {t('diagram.settingsTitle')}
      </div>
      <p className="side-panel-section-desc">
        {t('diagram.settingsDescription')}
      </p>
      {settings.consent === 'undecided' ? (
        showUndecidedConsent && onResolveConsent ? (
          <div className="diagram-renderer-settings__consent">
            <DiagramRendererConsentPanel
              settings={settings}
              onDecision={onResolveConsent}
            />
          </div>
        ) : null
      ) : (
        <label className="settings-row">
          <span className="settings-label">{t('diagram.settingsEnable')}</span>
          <input
            type="checkbox"
            checked={settings.consent === 'granted'}
            disabled={!onResolveConsent || consentUpdateState === 'running'}
            onChange={(event) => {
              if (!onResolveConsent) return;
              setConsentUpdateState('running');
              void onResolveConsent(event.target.checked ? 'granted' : 'declined')
                .then(() => setConsentUpdateState('idle'))
                .catch(() => setConsentUpdateState('failed'));
            }}
          />
        </label>
      )}
      {consentUpdateState === 'running' && (
        <p className="settings-hint" role="status">{t('diagram.consentSaving')}</p>
      )}
      {consentUpdateState === 'failed' && (
        <p className="settings-hint" role="alert">{t('diagram.consentFailure')}</p>
      )}
      <label className="settings-stacked-row">
        <span className="settings-label">{t('diagram.settingsEndpoint')}</span>
        <input
          className="settings-text-input settings-path-input"
          value={endpoint}
          inputMode="url"
          spellCheck={false}
          onChange={(event) => setEndpoint(event.target.value)}
          onBlur={commitEndpoint}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setEndpoint(settings.endpoint);
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <label className="settings-row">
        <span className="settings-label">{t('diagram.settingsPrivateNetwork')}</span>
        <input
          type="checkbox"
          checked={settings.allowPrivateNetwork}
          onChange={(event) => onChange({
            ...settings,
            allowPrivateNetwork: event.target.checked,
          })}
        />
      </label>
      {onTest && (
        <button
          type="button"
          className="settings-reset-btn"
          disabled={testState === 'running' || settings.consent !== 'granted'}
          onClick={() => {
            setTestState('running');
            void onTest({ ...settings, endpoint: endpoint.trim() })
              .then(() => setTestState('succeeded'))
              .catch(() => setTestState('failed'));
          }}
        >
          {testState === 'running' ? t('diagram.settingsTesting') : t('diagram.settingsTest')}
        </button>
      )}
      {testState === 'succeeded' && (
        <p className="settings-hint" role="status">{t('diagram.settingsTestSucceeded')}</p>
      )}
      {testState === 'failed' && (
        <p className="settings-hint" role="alert">{t('diagram.settingsTestFailed')}</p>
      )}
      <p className="settings-hint">
        {t('diagram.settingsFailureFallback')}
      </p>
    </section>
  );
};
