import React, { useEffect, useRef } from 'react';
import { Image, Box, Sigma, Unlink } from 'lucide-react';

interface EditorContextMenuProps {
  position: { x: number; y: number };
  onInsertImage: () => void;
  onInsertDrawio: () => void;
  onInsertEquation: () => void;
  onRemoveLink?: () => void;
  isLinkActive?: boolean;
  onClose: () => void;
}

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  position,
  onInsertImage,
  onInsertDrawio,
  onInsertEquation,
  onRemoveLink,
  isLinkActive,
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

  // Adjust position so the menu doesn't overflow the viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${Math.max(4, position.y - rect.height)}px`;
    }
    if (rect.right > vw) {
      menuRef.current.style.left = `${Math.max(4, vw - rect.width - 4)}px`;
    }
  }, [position]);

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
      {isLinkActive && onRemoveLink && (
        <>
          <div
            style={itemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--vscode-menu-selectionBackground, #094771)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onMouseDown={e => e.preventDefault()}
            onClick={() => handleItem(onRemoveLink)}
          >
            <Unlink size={14} />
            <span>Remove Link</span>
          </div>
          <div style={{ height: '1px', background: 'var(--vscode-menu-separatorBackground, #454545)', margin: '4px 0' }} />
        </>
      )}
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
