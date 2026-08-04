import React from 'react';
import type { SidePanelSelection } from '../activityState';
import { SidePanelTabPanel, isTabbedSidePanelSelection } from './SidePanelTabPanel';
import { SidePanelTabs } from './SidePanelTabs';

interface SidePanelBodyProps {
  selection: SidePanelSelection;
  onSelectionChange: (selection: SidePanelSelection) => void;
  children: React.ReactNode;
}

export const SidePanelBody: React.FC<SidePanelBodyProps> = ({
  selection,
  onSelectionChange,
  children,
}) => (
  <>
    {isTabbedSidePanelSelection(selection) && (
      <SidePanelTabs
        selection={selection}
        onSelectionChange={onSelectionChange}
      />
    )}
    <SidePanelTabPanel selection={selection}>{children}</SidePanelTabPanel>
  </>
);
