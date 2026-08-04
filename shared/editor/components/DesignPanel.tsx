import React from 'react';
import type { DocumentSettings } from '@shared/types';
import type { UiLanguagePreference } from '../i18n';
import {
  DocumentSettingsPanel,
  type CssTarget,
} from './DocumentSettingsPanel';
import { ViewControlPanel } from './ViewControlPanel';

interface DesignPanelProps {
  showNumbering: boolean;
  onToggleNumbering: () => void;
  showDecoration: boolean;
  onToggleDecoration: () => void;
  uiLanguagePreference: UiLanguagePreference;
  onUiLanguagePreferenceChange: (preference: UiLanguagePreference) => void;
  onUpdateDocSettings: (settings: Partial<DocumentSettings> | null) => void;
  onSelectCssFile?: (target: CssTarget) => void;
  onClearCssFile?: (target: CssTarget) => void;
}

export const DesignPanel: React.FC<DesignPanelProps> = ({
  showNumbering,
  onToggleNumbering,
  showDecoration,
  onToggleDecoration,
  uiLanguagePreference,
  onUiLanguagePreferenceChange,
  onUpdateDocSettings,
  onSelectCssFile,
  onClearCssFile,
}) => (
  <div className="design-panel">
    <ViewControlPanel
      showNumbering={showNumbering}
      onToggleNumbering={onToggleNumbering}
      showDecoration={showDecoration}
      onToggleDecoration={onToggleDecoration}
      uiLanguagePreference={uiLanguagePreference}
      onUiLanguagePreferenceChange={onUiLanguagePreferenceChange}
    />
    <DocumentSettingsPanel
      exportMode="settings"
      onUpdateSettings={onUpdateDocSettings}
      onSelectCssFile={onSelectCssFile}
      onClearCssFile={onClearCssFile}
    />
  </div>
);
