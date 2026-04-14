import React from 'react';
import { ListOrdered as NumberIcon, BookOpen, Settings, FolderOpen } from 'lucide-react';
import type { ActivityTab } from './SidePanel';

interface ActivityBarProps {
  activeTab: ActivityTab | null;
  onTabClick: (tab: ActivityTab) => void;
}

const TABS: { id: ActivityTab; icon: React.ReactNode; title: string }[] = [
  { id: 'view', icon: <NumberIcon size={18} />, title: '뷰 컨트롤 (번호/장식)' },
  { id: 'toc', icon: <BookOpen size={18} />, title: '목차 (TOC)' },
  { id: 'settings', icon: <Settings size={18} />, title: '문서 설정' },
  { id: 'file', icon: <FolderOpen size={18} />, title: '파일 작업 (내보내기/가져오기)' },
];

export const ActivityBar: React.FC<ActivityBarProps> = ({ activeTab, onTabClick }) => (
  <div className="activity-bar">
    {TABS.map(({ id, icon, title }) => (
      <button
        key={id}
        className={`activity-bar-icon${activeTab === id ? ' is-active' : ''}`}
        title={title}
        onClick={() => onTabClick(id)}
      >
        {icon}
      </button>
    ))}
  </div>
);
