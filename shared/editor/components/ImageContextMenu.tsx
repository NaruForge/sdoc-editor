import React, { useEffect, useRef } from 'react';
import {
  Settings,
  RefreshCw,
  Copy,
  Trash2
} from 'lucide-react';
import { useEditorI18n } from '../i18n';
import { Menu } from './ui/Menu';

interface ImageContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onOpenProperties: () => void;
  onReplaceImage: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  isDrawio: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export const ImageContextMenu: React.FC<ImageContextMenuProps> = ({
  position,
  onClose,
  onOpenProperties,
  onReplaceImage,
  onCopyPath,
  onDelete,
  isDrawio,
  returnFocusRef,
}) => {
  const { t } = useEditorI18n();
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
      }}
      onClick={(e) => {
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
      label={t('context.imageActions')}
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
        label={t('context.imageProperties')}
        onClick={onOpenProperties}
      />
      {!isDrawio && (
        <MenuItem
          icon={<RefreshCw size={14} />}
          label={t('context.replaceImage')}
          onClick={onReplaceImage}
        />
      )}
      <MenuItem
        icon={<Copy size={14} />}
        label={t('context.copyImagePath')}
        onClick={onCopyPath}
      />
      <div role="separator" className="context-menu-separator" />
      <MenuItem
        icon={<Trash2 size={14} />}
        label={t('context.deleteImage')}
        onClick={onDelete}
        danger
      />
    </Menu>
  );
};
