import React from 'react';
import {
  Compass,
  Files,
  Palette,
  Send,
} from 'lucide-react';
import type { ActivityDestination } from '../activityState';

export type { ActivityDestination, SidePanelSelection } from '../activityState';

interface ActivityBarProps {
  activeDestination: ActivityDestination | null;
  onDestinationClick: (destination: ActivityDestination) => void;
  showWorkspace?: boolean;
}

const DESTINATIONS: ReadonlyArray<{
  id: ActivityDestination;
  icon: React.ReactNode;
  label: string;
}> = [
  { id: 'workspace', icon: <Files size={18} />, label: 'Workspace' },
  { id: 'navigate', icon: <Compass size={18} />, label: 'Navigate' },
  { id: 'design', icon: <Palette size={18} />, label: 'Design' },
  { id: 'publish', icon: <Send size={18} />, label: 'Publish' },
];

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeDestination,
  onDestinationClick,
  showWorkspace = false,
}) => (
  <nav className="activity-bar" aria-label="Document activities">
    {DESTINATIONS.filter(({ id }) => showWorkspace || id !== 'workspace').map(({
      id,
      icon,
      label,
    }) => {
      const isActive = activeDestination === id;
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
