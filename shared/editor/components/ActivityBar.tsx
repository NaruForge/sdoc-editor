import React from 'react';
import { ListOrdered as NumberIcon, BookOpen, Settings, FolderOpen, Image, Table2, Files, LayoutTemplate } from 'lucide-react';
export type ActivityTab = 'explorer' | 'view' | 'toc' | 'lof' | 'lot' | 'settings' | 'file' | 'template';

interface ActivityBarProps {
  activeTab: ActivityTab | null;
  onTabClick: (tab: ActivityTab) => void;
  showExplorer?: boolean;
  showTemplates?: boolean;
}

const TABS: { id: ActivityTab; icon: React.ReactNode; title: string; label: string }[] = [
  { id: 'explorer', icon: <Files size={18} />, title: '폴더 탐색기', label: '탐색' },
  { id: 'view', icon: <NumberIcon size={18} />, title: '뷰 컨트롤 (번호/장식)', label: '뷰' },
  { id: 'toc', icon: <BookOpen size={18} />, title: '목차 (TOC)', label: '목차' },
  { id: 'lof', icon: <Image size={18} />, title: '그림 목록 (LOF)', label: '그림' },
  { id: 'lot', icon: <Table2 size={18} />, title: '표 목록 (LOT)', label: '표' },
  { id: 'settings', icon: <Settings size={18} />, title: '문서 설정', label: '설정' },
  { id: 'file', icon: <FolderOpen size={18} />, title: '파일 작업 (내보내기/가져오기)', label: '파일' },
  { id: 'template', icon: <LayoutTemplate size={18} />, title: '문서 템플릿', label: '템플릿' },
];

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeTab,
  onTabClick,
  showExplorer = false,
  showTemplates = false,
}) => (
  <nav className="activity-bar" aria-label="문서 패널">
    {TABS.filter(({ id }) => (showExplorer || id !== 'explorer')
      && (showTemplates || id !== 'template')).map(({ id, icon, title, label }) => {
      const isActive = activeTab === id;
      return (
        <button
          key={id}
          className={`activity-bar-icon${isActive ? ' is-active' : ''}`}
          title={title}
          aria-label={title}
          aria-pressed={isActive}
          onClick={() => onTabClick(id)}
        >
          {icon}
          <span className="activity-bar-label">{label}</span>
        </button>
      );
    })}
  </nav>
);
