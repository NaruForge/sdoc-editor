import React from 'react';
import type { DocumentSettings } from '@shared/types';
import {
  getCaptionPreset,
  resolveDocumentSettingsSnapshot,
} from '@shared/settingsResolver';
import { formatCaptionLabel } from '@shared/converter/utils';
import { useEditorContext } from '../context/EditorContext';
import type { UiLanguagePreference } from '../i18n';
import { useEditorI18n } from '../i18n';
import {
  createDefaultViewPreferences,
  type DesignPanelAdapter,
} from '../designSettings';
import {
  DocumentSettingsPanel,
  type CssTarget,
} from './DocumentSettingsPanel';
import { ViewControlPanel } from './ViewControlPanel';

export interface DesignPanelProps {
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  uiLanguagePreference: UiLanguagePreference;
  onUiLanguagePreferenceChange: (preference: UiLanguagePreference) => void;
  onUpdateDocSettings: (settings: Partial<DocumentSettings> | null) => void;
  onSelectCssFile?: (target: CssTarget) => void;
  onClearCssFile?: (target: CssTarget) => void;
  adapter?: DesignPanelAdapter;
}

export function buildDesignCompactPreview(
  settings: Pick<DocumentSettings, 'headingNumbering' | 'headingStartNumber' | 'captionStyle'>,
  caption: string,
): { headingOne: string; headingTwo: string; caption: string } {
  const preset = getCaptionPreset(settings.captionStyle ?? 'modern');
  const start = settings.headingStartNumber ?? 1;
  return {
    headingOne: settings.headingNumbering ? String(start) : '',
    headingTwo: settings.headingNumbering ? `${start}.1` : '',
    caption: formatCaptionLabel(preset.figurePrefix, '1', caption, preset.separator),
  };
}

export const DesignPanel: React.FC<DesignPanelProps> = ({
  onToggleNumbering,
  onToggleDecoration,
  uiLanguagePreference,
  onUiLanguagePreferenceChange,
  onUpdateDocSettings,
  onSelectCssFile,
  onClearCssFile,
  adapter,
}) => {
  const { t } = useEditorI18n();
  const { state } = useEditorContext();
  const [localViewPreferences, setLocalViewPreferences] = React.useState(
    createDefaultViewPreferences,
  );
  const viewPreferences = adapter?.viewPreferences ?? localViewPreferences;
  const snapshot = adapter?.settingsSnapshot ?? resolveDocumentSettingsSnapshot({
    context: 'editor',
    documentSettings: state.docSettings ?? undefined,
    temporaryView: viewPreferences,
  });
  const changeViewPreferences = adapter?.onViewPreferencesChange ?? setLocalViewPreferences;
  const effectiveNumbering = snapshot.values.headingNumbering;
  const effectiveDecoration = snapshot.values.headingDecoration;
  const preview = buildDesignCompactPreview(snapshot.values, t('settings.previewCaption'));

  return (
    <div className="design-panel">
      <ViewControlPanel
        showNumbering={effectiveNumbering}
        onToggleNumbering={onToggleNumbering}
        showDecoration={effectiveDecoration}
        onToggleDecoration={onToggleDecoration}
        uiLanguagePreference={uiLanguagePreference}
        onUiLanguagePreferenceChange={onUiLanguagePreferenceChange}
        viewPreferences={viewPreferences}
        onViewPreferencesChange={changeViewPreferences}
        controlledEffectiveValues={Boolean(adapter)}
        documentValues={{
          headingNumbering: snapshot.entries.headingNumbering.source === 'temporary-view'
            ? state.settings.headingNumbering
            : snapshot.values.headingNumbering,
          headingDecoration: snapshot.entries.headingDecoration.source === 'temporary-view'
            ? state.settings.headingDecoration
            : snapshot.values.headingDecoration,
        }}
      />
      <div
        className={`design-compact-preview${effectiveDecoration ? ' has-decoration' : ''}`}
        aria-label={t('settings.compactPreview')}
      >
        <div className="design-compact-preview-label">{t('settings.compactPreview')}</div>
        <div
          className="design-compact-preview-h1"
          style={{ color: snapshot.values.headingH1Color }}
        >
          {preview.headingOne ? `${preview.headingOne} ` : ''}{t('settings.previewHeadingOne')}
        </div>
        <div
          className="design-compact-preview-h2"
          style={{ color: snapshot.values.headingH2Color }}
        >
          {preview.headingTwo ? `${preview.headingTwo} ` : ''}{t('settings.previewHeadingTwo')}
        </div>
        <div className="design-compact-preview-caption">
          {preview.caption}
        </div>
      </div>
      <DocumentSettingsPanel
        exportMode="settings"
        onUpdateSettings={onUpdateDocSettings}
        onSelectCssFile={onSelectCssFile}
        onClearCssFile={onClearCssFile}
        settingsSnapshot={snapshot}
        syncState={adapter?.settingsSyncState}
        onRetrySync={adapter?.onRetrySettingsSync}
      />
    </div>
  );
};
