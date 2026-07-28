import React from 'react';
import type {
  DesignPanelTab,
  NavigatePanelTab,
  PublishPanelTab,
  SidePanelSelection,
} from '../activityState';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

interface SidePanelTabsProps {
  selection: Exclude<SidePanelSelection, { destination: 'workspace' }>;
  showTemplates?: boolean;
  onSelectionChange: (selection: SidePanelSelection) => void;
}

type TabDefinition<T extends string> = {
  id: T;
  labelKey: EditorTranslationKey;
};

const NAVIGATE_TABS: readonly TabDefinition<NavigatePanelTab>[] = [
  { id: 'toc', labelKey: 'panel.contents' },
  { id: 'figures', labelKey: 'panel.figures' },
  { id: 'tables', labelKey: 'panel.tables' },
];
const DESIGN_TABS: readonly TabDefinition<DesignPanelTab>[] = [
  { id: 'view', labelKey: 'panel.view' },
  { id: 'document', labelKey: 'panel.settings' },
];
const PUBLISH_TABS: readonly TabDefinition<PublishPanelTab>[] = [
  { id: 'export', labelKey: 'panel.export' },
  { id: 'import', labelKey: 'panel.import' },
  { id: 'templates', labelKey: 'panel.templates' },
];

export const SidePanelTabs: React.FC<SidePanelTabsProps> = ({
  selection,
  showTemplates = false,
  onSelectionChange,
}) => {
  const { t } = useEditorI18n();
  const definitions = selection.destination === 'navigate'
    ? NAVIGATE_TABS
    : selection.destination === 'design'
      ? DESIGN_TABS
      : PUBLISH_TABS.filter(({ id }) => showTemplates || id !== 'templates');

  return (
    <div className="side-panel-tabs" role="tablist" aria-label={t('panel.documentPanels')}>
      {definitions.map(({ id, labelKey }) => {
        const selected = selection.tab === id;
        return (
          <button
            key={id}
            id={`side-panel-tab-${selection.destination}-${id}`}
            type="button"
            role="tab"
            className={`side-panel-tab${selected ? ' active' : ''}`}
            aria-selected={selected}
            aria-controls="side-panel-tab-content"
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelectionChange({
              destination: selection.destination,
              tab: id,
            } as SidePanelSelection)}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
};
