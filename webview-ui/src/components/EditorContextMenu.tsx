import React, { useEffect, useRef, useState } from 'react';
import {
  Image, Box, Sigma, Unlink, Link2, Table2, Code, GitGraph,
  MessageSquareWarning, Hash, ChevronRight, Minus,
} from 'lucide-react';
import { Editor as TiptapEditor } from '@tiptap/react';

type CalloutVariant = 'note' | 'info' | 'tip' | 'warning' | 'danger';

const CALLOUT_ITEMS: { variant: CalloutVariant; icon: string; label: string }[] = [
  { variant: 'note', icon: '📝', label: 'Note' },
  { variant: 'info', icon: 'ℹ️', label: 'Info' },
  { variant: 'tip', icon: '💡', label: 'Tip' },
  { variant: 'warning', icon: '⚠️', label: 'Warning' },
  { variant: 'danger', icon: '🚨', label: 'Danger' },
];

const TABLE_PRESETS = [3, 5, 7, 10];

interface EditorContextMenuProps {
  position: { x: number; y: number };
  editor: TiptapEditor;
  onInsertImage: () => void;
  onInsertDrawio: () => void;
  onInsertEquation: () => void;
  onInsertTable: (rows: number, cols: number) => void;
  onInsertLink?: () => void;
  onInsertDiagram?: () => void;
  onInsertCrossRef?: () => void;
  onRemoveLink?: () => void;
  isLinkActive?: boolean;
  onClose: () => void;
}

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  position,
  editor,
  onInsertImage,
  onInsertDrawio,
  onInsertEquation,
  onInsertTable,
  onInsertLink,
  onInsertDiagram,
  onInsertCrossRef,
  onRemoveLink,
  isLinkActive,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [subMenu, setSubMenu] = useState<'table' | 'callout' | null>(null);
  const [customRows, setCustomRows] = useState('3');
  const [customCols, setCustomCols] = useState('3');
  const [showCustomSize, setShowCustomSize] = useState(false);

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

  const handleItem = (fn: () => void) => {
    onClose();
    fn();
  };

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: position.y,
    left: position.x,
    zIndex: 1000,
    background: 'var(--vscode-menu-background, #252526)',
    border: '1px solid var(--vscode-menu-border, #454545)',
    borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    minWidth: '200px',
    padding: '4px 0',
    fontSize: '13px',
    color: 'var(--vscode-menu-foreground, #cccccc)',
  };

  const itemBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 12px',
    cursor: 'pointer',
    userSelect: 'none',
    background: 'transparent',
    width: '100%',
    border: 'none',
    color: 'inherit',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    textAlign: 'left',
    position: 'relative',
  };

  const separator = (
    <div style={{ height: '1px', background: 'var(--vscode-menu-separatorBackground, #454545)', margin: '4px 0' }} />
  );

  const sectionLabel = (label: string) => (
    <div style={{ padding: '2px 12px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--vscode-descriptionForeground, #888)', userSelect: 'none' }}>
      {label}
    </div>
  );

  const Item: React.FC<{
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    hasArrow?: boolean;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  }> = ({ icon, label, onClick, hasArrow, onMouseEnter, onMouseLeave }) => (
    <div
      style={itemBase}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--vscode-menu-selectionBackground, #094771)';
        e.currentTarget.style.color = 'var(--vscode-menu-selectionForeground, #fff)';
        onMouseEnter?.();
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'inherit';
        onMouseLeave?.();
      }}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {hasArrow && <ChevronRight size={12} style={{ opacity: 0.7 }} />}
    </div>
  );

  // Submenu flyout positioned to the right of the main menu
  const SubMenuFlyout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x + (menuRef.current?.offsetWidth ?? 200) + 2,
        zIndex: 1001,
        background: 'var(--vscode-menu-background, #252526)',
        border: '1px solid var(--vscode-menu-border, #454545)',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        minWidth: '160px',
        padding: '4px 0',
        fontSize: '13px',
        color: 'var(--vscode-menu-foreground, #cccccc)',
      }}
    >
      {children}
    </div>
  );

  return (
    <>
      <div ref={menuRef} style={menuStyle}>
        {/* ── 편집 영역 ── */}
        {isLinkActive && onRemoveLink && (
          <>
            {sectionLabel('편집')}
            <Item
              icon={<Unlink size={14} />}
              label="링크 제거"
              onClick={() => handleItem(onRemoveLink)}
            />
            {separator}
          </>
        )}

        {/* ── 삽입 영역 ── */}
        {sectionLabel('삽입')}

        {/* 표 — 서브메뉴 */}
        <Item
          icon={<Table2 size={14} />}
          label="표"
          hasArrow
          onClick={() => setSubMenu(subMenu === 'table' ? null : 'table')}
          onMouseEnter={() => { setSubMenu('table'); setShowCustomSize(false); }}
        />

        {onInsertLink && (
          <Item
            icon={<Link2 size={14} />}
            label="링크"
            onClick={() => handleItem(onInsertLink)}
            onMouseEnter={() => setSubMenu(null)}
          />
        )}

        <Item
          icon={<Image size={14} />}
          label="이미지"
          onClick={() => handleItem(onInsertImage)}
          onMouseEnter={() => setSubMenu(null)}
        />
        <Item
          icon={<Box size={14} />}
          label="Draw.io 다이어그램"
          onClick={() => handleItem(onInsertDrawio)}
          onMouseEnter={() => setSubMenu(null)}
        />
        <Item
          icon={<Sigma size={14} />}
          label="수식"
          onClick={() => handleItem(onInsertEquation)}
          onMouseEnter={() => setSubMenu(null)}
        />
        <Item
          icon={<Code size={14} />}
          label="코드 블록"
          onClick={() => handleItem(() => editor.chain().focus().toggleCodeBlock().run())}
          onMouseEnter={() => setSubMenu(null)}
        />
        {onInsertDiagram && (
          <Item
            icon={<GitGraph size={14} />}
            label="다이어그램 (Mermaid)"
            onClick={() => handleItem(onInsertDiagram)}
            onMouseEnter={() => setSubMenu(null)}
          />
        )}

        {/* 콜아웃 — 서브메뉴 */}
        <Item
          icon={<MessageSquareWarning size={14} />}
          label="콜아웃"
          hasArrow
          onClick={() => setSubMenu(subMenu === 'callout' ? null : 'callout')}
          onMouseEnter={() => setSubMenu('callout')}
        />

        <Item
          icon={<Minus size={14} />}
          label="수평선"
          onClick={() => handleItem(() => editor.chain().focus().setHorizontalRule().run())}
          onMouseEnter={() => setSubMenu(null)}
        />

        {onInsertCrossRef && (
          <Item
            icon={<Hash size={14} />}
            label="교차 참조"
            onClick={() => handleItem(onInsertCrossRef)}
            onMouseEnter={() => setSubMenu(null)}
          />
        )}

        {/* 표 서브메뉴 — menuRef 내부에 포함시켜 handleClickOutside 오동작 방지 */}
        {subMenu === 'table' && (
          <SubMenuFlyout>
            <div style={{ padding: '2px 10px 4px', fontSize: '11px', color: 'var(--vscode-descriptionForeground, #888)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              크기 선택
            </div>
            {TABLE_PRESETS.map(size => (
              <Item
                key={size}
                icon={<Table2 size={13} />}
                label={`${size} × ${size}`}
                onClick={() => { onInsertTable(size, size); onClose(); }}
              />
            ))}
            <Item
              icon={<Table2 size={13} />}
              label="사용자 정의..."
              onClick={() => setShowCustomSize(v => !v)}
            />
            {showCustomSize && (
              <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number" min="1" max="50"
                    value={customRows}
                    onChange={e => setCustomRows(e.target.value)}
                    style={{ width: '44px', padding: '3px 6px', fontSize: '12px', background: 'var(--vscode-input-background)', border: '1px solid var(--vscode-input-border)', color: 'var(--vscode-input-foreground)', borderRadius: '3px' }}
                    placeholder="행"
                    onClick={e => e.stopPropagation()}
                  />
                  <span style={{ fontSize: '12px' }}>×</span>
                  <input
                    type="number" min="1" max="50"
                    value={customCols}
                    onChange={e => setCustomCols(e.target.value)}
                    style={{ width: '44px', padding: '3px 6px', fontSize: '12px', background: 'var(--vscode-input-background)', border: '1px solid var(--vscode-input-border)', color: 'var(--vscode-input-foreground)', borderRadius: '3px' }}
                    placeholder="열"
                    onClick={e => e.stopPropagation()}
                  />
                </div>
                <div
                  style={{ ...itemBase, justifyContent: 'center', fontWeight: 600, fontSize: '12px', padding: '4px 6px' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--vscode-menu-selectionBackground, #094771)'; e.currentTarget.style.color = 'var(--vscode-menu-selectionForeground, #fff)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'inherit'; }}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    const r = parseInt(customRows), c = parseInt(customCols);
                    if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && r <= 50 && c <= 50) {
                      onInsertTable(r, c);
                      onClose();
                    }
                  }}
                >
                  삽입
                </div>
              </div>
            )}
          </SubMenuFlyout>
        )}

        {/* 콜아웃 서브메뉴 — menuRef 내부에 포함시켜 handleClickOutside 오동작 방지 */}
        {subMenu === 'callout' && (
          <SubMenuFlyout>
            {CALLOUT_ITEMS.map(({ variant, icon, label }) => (
              <Item
                key={variant}
                icon={<span style={{ fontSize: '13px', lineHeight: 1 }}>{icon}</span>}
                label={label}
                onClick={() => handleItem(() =>
                  editor.chain().focus().insertContent({ type: 'callout', attrs: { variant }, content: [{ type: 'paragraph' }] }).run()
                )}
              />
            ))}
          </SubMenuFlyout>
        )}
      </div>
    </>
  );
};
