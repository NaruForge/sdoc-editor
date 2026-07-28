import React, { useEffect, useRef, useState } from 'react';
import {
  Image, Box, Sigma, Unlink, Link2, Table2, Code, GitGraph,
  MessageSquareWarning, Hash, ChevronRight, Minus,
} from 'lucide-react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { useEditorI18n } from '../i18n';
import { Menu } from './ui/Menu';

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
  returnFocusRef?: React.RefObject<HTMLElement | null>;
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
  returnFocusRef,
}) => {
  const { t } = useEditorI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const tableTriggerRef = useRef<HTMLButtonElement>(null);
  const tableSubmenuRef = useRef<HTMLDivElement>(null);
  const calloutTriggerRef = useRef<HTMLButtonElement>(null);
  const calloutSubmenuRef = useRef<HTMLDivElement>(null);
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
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
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
    <div
      role="separator"
      style={{ height: '1px', background: 'var(--vscode-menu-separatorBackground, #454545)', margin: '4px 0' }}
    />
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
    expanded?: boolean;
    buttonRef?: React.Ref<HTMLButtonElement>;
    onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  }> = ({
    icon,
    label,
    onClick,
    hasArrow,
    expanded,
    buttonRef,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
  }) => (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-haspopup={hasArrow ? 'menu' : undefined}
      aria-expanded={hasArrow ? expanded : undefined}
      style={itemBase}
      onKeyDown={onKeyDown}
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
    </button>
  );

  // Submenu flyout positioned to the right of the main menu
  const SubMenuFlyout: React.FC<{
    label: string;
    menuRef: React.Ref<HTMLDivElement>;
    onEscape: () => void;
    children: React.ReactNode;
  }> = ({ label, menuRef: flyoutRef, onEscape, children }) => (
    <Menu
      ref={flyoutRef}
      label={label}
      onEscape={onEscape}
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
    </Menu>
  );

  return (
    <>
      <Menu
        ref={menuRef}
        style={menuStyle}
        label={t('context.insert')}
        autoFocus
        onClose={onClose}
        returnFocusRef={returnFocusRef}
      >
        {/* ── 편집 영역 ── */}
        {isLinkActive && onRemoveLink && (
          <>
            {sectionLabel(t('context.edit'))}
            <Item
              icon={<Unlink size={14} />}
              label={t('context.removeLink')}
              onClick={() => handleItem(onRemoveLink)}
            />
            {separator}
          </>
        )}

        {/* ── 삽입 영역 ── */}
        {sectionLabel(t('context.insert'))}

        {/* 표 — 서브메뉴 */}
        <Item
          buttonRef={tableTriggerRef}
          icon={<Table2 size={14} />}
          label={t('toolbar.table')}
          hasArrow
          expanded={subMenu === 'table'}
          onClick={() => setSubMenu(subMenu === 'table' ? null : 'table')}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight') return;
            event.preventDefault();
            setSubMenu('table');
            setShowCustomSize(false);
            requestAnimationFrame(() => {
              tableSubmenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
            });
          }}
          onMouseEnter={() => { setSubMenu('table'); setShowCustomSize(false); }}
        />

        {onInsertLink && (
          <Item
            icon={<Link2 size={14} />}
            label={t('context.link')}
            onClick={() => handleItem(onInsertLink)}
            onMouseEnter={() => setSubMenu(null)}
          />
        )}

        <Item
          icon={<Image size={14} />}
          label={t('toolbar.image')}
          onClick={() => handleItem(onInsertImage)}
          onMouseEnter={() => setSubMenu(null)}
        />
        <Item
          icon={<Box size={14} />}
          label={t('context.drawio')}
          onClick={() => handleItem(onInsertDrawio)}
          onMouseEnter={() => setSubMenu(null)}
        />
        <Item
          icon={<Sigma size={14} />}
          label={t('toolbar.math')}
          onClick={() => handleItem(onInsertEquation)}
          onMouseEnter={() => setSubMenu(null)}
        />
        <Item
          icon={<Code size={14} />}
          label={t('toolbar.codeBlock')}
          onClick={() => handleItem(() => editor.chain().focus().toggleCodeBlock().run())}
          onMouseEnter={() => setSubMenu(null)}
        />
        {onInsertDiagram && (
          <Item
            icon={<GitGraph size={14} />}
            label={t('context.mermaid')}
            onClick={() => handleItem(onInsertDiagram)}
            onMouseEnter={() => setSubMenu(null)}
          />
        )}

        {/* 콜아웃 — 서브메뉴 */}
        <Item
          buttonRef={calloutTriggerRef}
          icon={<MessageSquareWarning size={14} />}
          label={t('toolbar.callout')}
          hasArrow
          expanded={subMenu === 'callout'}
          onClick={() => setSubMenu(subMenu === 'callout' ? null : 'callout')}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight') return;
            event.preventDefault();
            setSubMenu('callout');
            requestAnimationFrame(() => {
              calloutSubmenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
            });
          }}
          onMouseEnter={() => setSubMenu('callout')}
        />

        <Item
          icon={<Minus size={14} />}
          label={t('toolbar.horizontalRule')}
          onClick={() => handleItem(() => editor.chain().focus().setHorizontalRule().run())}
          onMouseEnter={() => setSubMenu(null)}
        />

        {onInsertCrossRef && (
          <Item
            icon={<Hash size={14} />}
            label={t('toolbar.crossReference')}
            onClick={() => handleItem(onInsertCrossRef)}
            onMouseEnter={() => setSubMenu(null)}
          />
        )}

        {/* 표 서브메뉴 — menuRef 내부에 포함시켜 handleClickOutside 오동작 방지 */}
        {subMenu === 'table' && (
          <SubMenuFlyout
            label={t('toolbar.table')}
            menuRef={tableSubmenuRef}
            onEscape={() => {
              setSubMenu(null);
              setShowCustomSize(false);
              tableTriggerRef.current?.focus();
            }}
          >
            <div style={{ padding: '2px 10px 4px', fontSize: '11px', color: 'var(--vscode-descriptionForeground, #888)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {t('context.tableSize')}
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
              label={t('context.customSize')}
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
                    placeholder={t('context.rowsPlaceholder')}
                    aria-label={t('toolbar.rows')}
                    onClick={e => e.stopPropagation()}
                  />
                  <span style={{ fontSize: '12px' }}>×</span>
                  <input
                    type="number" min="1" max="50"
                    value={customCols}
                    onChange={e => setCustomCols(e.target.value)}
                    style={{ width: '44px', padding: '3px 6px', fontSize: '12px', background: 'var(--vscode-input-background)', border: '1px solid var(--vscode-input-border)', color: 'var(--vscode-input-foreground)', borderRadius: '3px' }}
                    placeholder={t('context.columnsPlaceholder')}
                    aria-label={t('toolbar.columns')}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
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
                  {t('common.insert')}
                </button>
              </div>
            )}
          </SubMenuFlyout>
        )}

        {/* 콜아웃 서브메뉴 — menuRef 내부에 포함시켜 handleClickOutside 오동작 방지 */}
        {subMenu === 'callout' && (
          <SubMenuFlyout
            label={t('toolbar.callout')}
            menuRef={calloutSubmenuRef}
            onEscape={() => {
              setSubMenu(null);
              calloutTriggerRef.current?.focus();
            }}
          >
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
      </Menu>
    </>
  );
};
