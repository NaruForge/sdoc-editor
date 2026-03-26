import React, { useEffect, useRef } from 'react';
import { Image, Box, Sigma } from 'lucide-react';

interface EditorContextMenuProps {
  position: { x: number; y: number };
  onInsertImage: () => void;
  onInsertDrawio: () => void;
  onInsertEquation: () => void;
  onClose: () => void;
}

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  position,
  onInsertImage,
  onInsertDrawio,
  onInsertEquation,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // 메뉴가 화면 밖으로 나가지 않도록 위치 조정
  const style: React.CSSProperties = {
    position: 'fixed',
    top: position.y,
    left: position.x,
    zIndex: 1000,
    background: 'var(--vscode-menu-background, #252526)',
    border: '1px solid var(--vscode-menu-border, #454545)',
    borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    minWidth: '180px',
    padding: '4px 0',
    fontSize: '13px',
    color: 'var(--vscode-menu-foreground, #cccccc)',
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    cursor: 'pointer',
    userSelect: 'none',
  };

  const handleItem = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div ref={menuRef} style={style}>
      <div
        style={itemStyle}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--vscode-menu-selectionBackground, #094771)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onMouseDown={e => e.preventDefault()}
        onClick={() => handleItem(onInsertImage)}
      >
        <Image size={14} />
        <span>Insert Image</span>
      </div>
      <div
        style={itemStyle}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--vscode-menu-selectionBackground, #094771)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onMouseDown={e => e.preventDefault()}
        onClick={() => handleItem(onInsertDrawio)}
      >
        <Box size={14} />
        <span>Insert Draw.io</span>
      </div>
      <div
        style={itemStyle}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--vscode-menu-selectionBackground, #094771)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onMouseDown={e => e.preventDefault()}
        onClick={() => handleItem(onInsertEquation)}
      >
        <Sigma size={14} />
        <span>Insert Equation</span>
      </div>
    </div>
  );
};
