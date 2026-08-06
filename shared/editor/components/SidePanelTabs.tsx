import React from 'react';
import type {
  NavigatePanelTab,
  PublishPanelTab,
  SidePanelSelection,
} from '../activityState';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';
import {
  getSidePanelTabId,
  SIDE_PANEL_TAB_CONTENT_ID,
  type TabbedSidePanelSelection,
} from './SidePanelTabPanel';

interface SidePanelTabsProps {
  selection: TabbedSidePanelSelection;
  onSelectionChange: (selection: SidePanelSelection) => void;
}

type TabDefinition<T extends string> = {
  id: T;
  labelKey: EditorTranslationKey;
};

export type SidePanelTabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function nextSidePanelTabIndex(
  currentIndex: number,
  key: SidePanelTabNavigationKey,
  tabCount: number,
): number {
  if (tabCount <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  if (currentIndex < 0) return key === 'ArrowLeft' ? tabCount - 1 : 0;
  if (key === 'ArrowRight') return (currentIndex + 1 + tabCount) % tabCount;
  return (currentIndex - 1 + tabCount) % tabCount;
}

const NAVIGATE_TABS: readonly TabDefinition<NavigatePanelTab>[] = [
  { id: 'toc', labelKey: 'panel.contents' },
  { id: 'figures', labelKey: 'panel.figures' },
  { id: 'tables', labelKey: 'panel.tables' },
];
const PUBLISH_TABS: readonly TabDefinition<PublishPanelTab>[] = [
  { id: 'export', labelKey: 'panel.export' },
  { id: 'import', labelKey: 'panel.import' },
];

export const SidePanelTabs: React.FC<SidePanelTabsProps> = ({
  selection,
  onSelectionChange,
}) => {
  const { t } = useEditorI18n();
  const definitions = selection.destination === 'navigate'
    ? NAVIGATE_TABS
    : PUBLISH_TABS;

  const selectTab = (id: NavigatePanelTab | PublishPanelTab): void => {
    onSelectionChange({
      destination: selection.destination,
      tab: id,
    } as SidePanelSelection);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    const nextIndex = nextSidePanelTabIndex(
      currentIndex,
      event.key as SidePanelTabNavigationKey,
      tabs.length,
    );
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextDefinition = definitions[nextIndex];
    if (!nextDefinition) return;
    selectTab(nextDefinition.id);
    tabs[nextIndex]?.focus();
  };

  return (
    <div
      className="side-panel-tabs"
      role="tablist"
      aria-label={t('panel.documentPanels')}
      aria-orientation="horizontal"
    >
      {definitions.map(({ id, labelKey }) => {
        const selected = selection.tab === id;
        return (
          <button
            key={id}
            id={getSidePanelTabId({
              destination: selection.destination,
              tab: id,
            } as TabbedSidePanelSelection)}
            type="button"
            role="tab"
            className={`side-panel-tab${selected ? ' active' : ''}`}
            aria-selected={selected}
            aria-controls={SIDE_PANEL_TAB_CONTENT_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => selectTab(id)}
            onKeyDown={handleKeyDown}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
};
