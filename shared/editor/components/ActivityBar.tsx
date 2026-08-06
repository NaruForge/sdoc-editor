import React from 'react';
import {
  Compass,
  LayoutTemplate,
  Palette,
  Send,
} from 'lucide-react';
import type { ActivityDestination } from '../activityState';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

export type { ActivityDestination, SidePanelSelection } from '../activityState';

interface ActivityBarProps {
  activeDestination: ActivityDestination | null;
  onDestinationClick: (destination: ActivityDestination) => void;
  showTemplates?: boolean;
}

const DESTINATIONS: ReadonlyArray<{
  id: ActivityDestination;
  icon: React.ReactNode;
  labelKey: EditorTranslationKey;
}> = [
  { id: 'navigate', icon: <Compass size={18} />, labelKey: 'activity.navigate' },
  { id: 'design', icon: <Palette size={18} />, labelKey: 'activity.design' },
  { id: 'templates', icon: <LayoutTemplate size={18} />, labelKey: 'activity.templates' },
  { id: 'publish', icon: <Send size={18} />, labelKey: 'activity.publish' },
];

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeDestination,
  onDestinationClick,
  showTemplates = false,
}) => {
  const { t } = useEditorI18n();
  return (
  <nav className="activity-bar" aria-label={t('activity.documentActivities')}>
    {DESTINATIONS.filter(({ id }) => showTemplates || id !== 'templates').map(({
      id,
      icon,
      labelKey,
    }) => {
      const isActive = activeDestination === id;
      const label = t(labelKey);
      return (
        <button
          key={id}
          id={`activity-destination-${id}`}
          type="button"
          className={`activity-bar-icon${isActive ? ' is-active' : ''}`}
          title={label}
          aria-label={label}
          aria-pressed={isActive}
          aria-controls={isActive ? 'editor-side-panel' : undefined}
          aria-expanded={isActive}
          onClick={() => onDestinationClick(id)}
        >
          <span aria-hidden="true">{icon}</span>
          <span className="activity-bar-label">{label}</span>
        </button>
      );
    })}
  </nav>
  );
};
