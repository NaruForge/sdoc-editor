import React, { useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import {
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Settings,
  Hash,
  ToggleLeft,
} from 'lucide-react';
import { Menu } from './ui/Menu';

interface TableContextMenuProps {
  editor: Editor;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenProperties: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export const TableContextMenu: React.FC<TableContextMenuProps> = ({
  editor,
  position,
  onClose,
  onOpenProperties,
  returnFocusRef,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = () => onClose();

    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
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

  const MenuItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    danger?: boolean;
  }> = ({ icon, label, onClick, danger }) => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`context-menu-item ${danger ? 'danger' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
        onClose();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <Menu
      ref={menuRef}
      label="Table actions"
      autoFocus
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      className="table-context-menu"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 1000
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        icon={<Settings size={14} />}
        label="Table Properties..."
        onClick={() => {
          onOpenProperties();
        }}
      />
      <MenuItem
        icon={<Hash size={14} />}
        label="Edit Caption (click above table)"
        onClick={() => {
          // Caption is now edited inline via click on the caption area above the table
          // This menu item just reminds the user
        }}
      />
      <MenuItem
        icon={<ToggleLeft size={14} />}
        label="Toggle Header Row"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      />
      <div role="separator" className="context-menu-separator" />
      <MenuItem
        icon={<ArrowUpToLine size={14} />}
        label="Add Row Above"
        onClick={() => editor.chain().focus().addRowBefore().run()}
      />
      <MenuItem
        icon={<ArrowDownToLine size={14} />}
        label="Add Row Below"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      />
      <div role="separator" className="context-menu-separator" />
      <MenuItem
        icon={<ArrowLeftToLine size={14} />}
        label="Add Column Before"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      />
      <MenuItem
        icon={<ArrowRightToLine size={14} />}
        label="Add Column After"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      />
      <div role="separator" className="context-menu-separator" />
      <MenuItem
        icon={<Trash2 size={14} />}
        label="Delete Row"
        onClick={() => editor.chain().focus().deleteRow().run()}
        danger
      />
      <MenuItem
        icon={<Trash2 size={14} />}
        label="Delete Column"
        onClick={() => editor.chain().focus().deleteColumn().run()}
        danger
      />
      <MenuItem
        icon={<Trash2 size={14} />}
        label="Delete Table"
        onClick={() => editor.chain().focus().deleteTable().run()}
        danger
      />
    </Menu>
  );
};
