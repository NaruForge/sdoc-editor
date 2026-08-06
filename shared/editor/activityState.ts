export type ActivityDestination = 'navigate' | 'design' | 'templates' | 'publish';

export type NavigatePanelTab = 'toc' | 'figures' | 'tables';
export type PublishPanelTab = 'export' | 'import';

export type SidePanelSelection =
  | { destination: 'navigate'; tab: NavigatePanelTab }
  | { destination: 'design' }
  | { destination: 'templates' }
  | { destination: 'publish'; tab: PublishPanelTab };

export interface ActivityCapabilities {
  showTemplates?: boolean;
}

export interface ActivitySessionState {
  selection: SidePanelSelection | null;
  lastChildTabs: {
    navigate: NavigatePanelTab;
    publish: PublishPanelTab;
  };
}

const DEFAULT_CHILD_TABS: ActivitySessionState['lastChildTabs'] = {
  navigate: 'toc',
  publish: 'export',
};

const isSelectionAvailable = (
  selection: SidePanelSelection,
  capabilities: ActivityCapabilities,
): boolean => {
  if (selection.destination === 'templates') return capabilities.showTemplates === true;
  return true;
};

export function createActivitySessionState(
  selection: SidePanelSelection | null = null,
  capabilities: ActivityCapabilities = {},
): ActivitySessionState {
  const availableSelection = selection && isSelectionAvailable(selection, capabilities)
    ? selection
    : null;
  const lastChildTabs = { ...DEFAULT_CHILD_TABS };
  if (availableSelection?.destination === 'navigate') {
    lastChildTabs.navigate = availableSelection.tab;
  } else if (availableSelection?.destination === 'publish') {
    lastChildTabs.publish = availableSelection.tab;
  }
  return { selection: availableSelection, lastChildTabs };
}

export function selectSidePanel(
  state: ActivitySessionState,
  selection: SidePanelSelection | null,
  capabilities: ActivityCapabilities = {},
): ActivitySessionState {
  if (selection === null) return { ...state, selection: null };
  if (!isSelectionAvailable(selection, capabilities)) return state;
  if (selection.destination === 'design'
    || selection.destination === 'templates') {
    return { ...state, selection };
  }
  return {
    selection,
    lastChildTabs: {
      ...state.lastChildTabs,
      [selection.destination]: selection.tab,
    },
  };
}

export function transitionActivityDestination(
  state: ActivitySessionState,
  destination: ActivityDestination,
  capabilities: ActivityCapabilities = {},
): ActivitySessionState {
  if (state.selection?.destination === destination) {
    return { ...state, selection: null };
  }

  if (destination === 'templates') {
    return capabilities.showTemplates === true
      ? { ...state, selection: { destination: 'templates' } }
      : state;
  }

  if (destination === 'navigate') {
    return selectSidePanel(
      state,
      { destination, tab: state.lastChildTabs.navigate },
      capabilities,
    );
  }
  if (destination === 'design') {
    return selectSidePanel(state, { destination }, capabilities);
  }
  return selectSidePanel(
    state,
    { destination, tab: state.lastChildTabs.publish },
    capabilities,
  );
}
