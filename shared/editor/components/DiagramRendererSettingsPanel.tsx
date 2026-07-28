import React, { useEffect, useState } from 'react';
import type { DiagramRendererSettings } from '../../diagramRenderer';

interface DiagramRendererSettingsPanelProps {
  settings: DiagramRendererSettings;
  onChange: (settings: DiagramRendererSettings) => void;
  onTest?: (settings: DiagramRendererSettings) => Promise<void>;
}

export const DiagramRendererSettingsPanel: React.FC<DiagramRendererSettingsPanelProps> = ({
  settings,
  onChange,
  onTest,
}) => {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [testState, setTestState] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle');
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
        External diagram rendering
      </div>
      <p className="side-panel-section-desc">
        PlantUML, D2, and Graphviz use Kroki. When enabled, diagram source is sent
        to the configured server. Mermaid stays local.
      </p>
      <label className="settings-row">
        <span className="settings-label">Enable Kroki rendering</span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => onChange({ ...settings, enabled: event.target.checked })}
        />
      </label>
      <label className="settings-stacked-row">
        <span className="settings-label">Kroki endpoint</span>
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
        <span className="settings-label">Allow private-network endpoints</span>
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
          disabled={testState === 'running'}
          onClick={() => {
            setTestState('running');
            void onTest({ ...settings, endpoint: endpoint.trim() })
              .then(() => setTestState('succeeded'))
              .catch(() => setTestState('failed'));
          }}
        >
          {testState === 'running' ? 'Testing…' : 'Test connection'}
        </button>
      )}
      {testState === 'succeeded' && (
        <p className="settings-hint" role="status">Connection succeeded.</p>
      )}
      {testState === 'failed' && (
        <p className="settings-hint" role="alert">Connection failed. Check the endpoint and network.</p>
      )}
      <p className="settings-hint">
        Rendering failures keep the language and source and export a source-only fallback.
      </p>
    </section>
  );
};
