import React from 'react';
import { ListOrdered as NumberIcon, BookOpen, Settings, FolderOpen, Image, Table2, Files, LayoutTemplate } from 'lucide-react';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';
export type ActivityTab = 'explorer' | 'view' | 'toc' | 'lof' | 'lot' | 'settings' | 'file' | 'template';

interface ActivityBarProps {
  activeTab: ActivityTab | null;
  onTabClick: (tab: ActivityTab) => void;
  showExplorer?: boolean;
  showTemplates?: boolean;
}

const TABS: { id: ActivityTab; icon: React.ReactNode; labelKey: EditorTranslationKey }[] = [
  { id: 'explorer', icon: <Files size={18} />, labelKey: 'panel.explorer' },
  { id: 'view', icon: <NumberIcon size={18} />, labelKey: 'panel.view' },
  { id: 'toc', icon: <BookOpen size={18} />, labelKey: 'panel.contents' },
  { id: 'lof', icon: <Image size={18} />, labelKey: 'panel.figures' },
  { id: 'lot', icon: <Table2 size={18} />, labelKey: 'panel.tables' },
  { id: 'settings', icon: <Settings size={18} />, labelKey: 'panel.settings' },
  { id: 'file', icon: <FolderOpen size={18} />, labelKey: 'panel.files' },
  { id: 'template', icon: <LayoutTemplate size={18} />, labelKey: 'panel.templates' },
];

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeTab,
  onTabClick,
  showExplorer = false,
  showTemplates = false,
}) => {
  const { t } = useEditorI18n();
  return (
  <nav className="activity-bar" aria-label={t('panel.documentPanels')}>
    {TABS.filter(({ id }) => (showExplorer || id !== 'explorer')
      && (showTemplates || id !== 'template')).map(({ id, icon, labelKey }) => {
      const isActive = activeTab === id;
      const label = t(labelKey);
      return (
        <button
          key={id}
          id={`activity-tab-${id}`}
          type="button"
          className={`activity-bar-icon${isActive ? ' is-active' : ''}`}
          title={label}
          aria-label={label}
          aria-pressed={isActive}
          aria-controls={isActive ? 'editor-side-panel' : undefined}
          aria-expanded={isActive}
          onClick={() => onTabClick(id)}
        >
          <span aria-hidden="true">{icon}</span>
          <span className="activity-bar-label">{label}</span>
        </button>
      );
    })}
  </nav>
  );
};
