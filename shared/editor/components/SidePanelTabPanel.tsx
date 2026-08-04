import React from 'react';
import type { SidePanelSelection } from '../activityState';

export type TabbedSidePanelSelection = Exclude<
  SidePanelSelection,
  { destination: 'workspace' | 'templates' }
>;

export const SIDE_PANEL_TAB_CONTENT_ID = 'side-panel-tab-content';

export const getSidePanelTabId = (selection: TabbedSidePanelSelection): string => (
  `side-panel-tab-${selection.destination}-${selection.tab}`
);

export const isTabbedSidePanelSelection = (
  selection: SidePanelSelection,
): selection is TabbedSidePanelSelection => (
  selection.destination === 'navigate'
  || selection.destination === 'design'
  || selection.destination === 'publish'
);

interface SidePanelTabPanelProps {
  selection: SidePanelSelection;
  children: React.ReactNode;
}

export const SidePanelTabPanel: React.FC<SidePanelTabPanelProps> = ({
  selection,
  children,
}) => {
  if (!isTabbedSidePanelSelection(selection)) {
    return <>{children}</>;
  }

  return (
    <div
      id={SIDE_PANEL_TAB_CONTENT_ID}
      role="tabpanel"
      aria-labelledby={getSidePanelTabId(selection)}
    >
      {children}
    </div>
  );
};
