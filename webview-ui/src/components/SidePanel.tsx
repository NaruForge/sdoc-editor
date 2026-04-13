import React from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { TableOfContents } from './TableOfContents';
import { DocumentSettingsPanel } from './DocumentSettingsPanel';
import type { DocumentSettings } from '@shared/types';

export type SidePanelTab = 'toc' | 'settings';

interface SidePanelProps {
  activeTab: SidePanelTab;
  onTabChange: (tab: SidePanelTab) => void;
  editor: TiptapEditor | null;
  showNumbering: boolean;
  onUpdateDocSettings: (settings: Partial<DocumentSettings> | null) => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  activeTab,
  onTabChange,
  editor,
  showNumbering,
  onUpdateDocSettings,
}) => {
  return (
    <div className="side-panel">
      <div className="side-panel-tabs">
        <button
          className={`side-panel-tab ${activeTab === 'toc' ? 'active' : ''}`}
          onClick={() => onTabChange('toc')}
          title="목차"
        >
          📑 목차
        </button>
        <button
          className={`side-panel-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
          title="문서 설정"
        >
          ⚙️ 설정
        </button>
      </div>
      <div className="side-panel-content">
        {activeTab === 'toc' && (
          <TableOfContents editor={editor} showNumbering={showNumbering} />
        )}
        {activeTab === 'settings' && (
          <DocumentSettingsPanel onUpdateSettings={onUpdateDocSettings} />
        )}
      </div>
    </div>
  );
};
