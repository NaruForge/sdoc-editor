import React, { useEffect, useRef } from 'react';
import {
  Settings,
  RefreshCw,
  Copy,
  Trash2
} from 'lucide-react';

interface ImageContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onOpenProperties: () => void;
  onReplaceImage: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  isDrawio: boolean;
}

export const ImageContextMenu: React.FC<ImageContextMenuProps> = ({
  position,
  onClose,
  onOpenProperties,
  onReplaceImage,
  onCopyPath,
  onDelete,
  isDrawio
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = () => onClose();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('click', handleClickOutside);
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

  const MenuItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    danger?: boolean;
  }> = ({ icon, label, onClick, danger }) => (
    <button
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
    <div
      ref={menuRef}
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
        label="Image Properties..."
        onClick={onOpenProperties}
      />
      {!isDrawio && (
        <MenuItem
          icon={<RefreshCw size={14} />}
          label="Replace Image..."
          onClick={onReplaceImage}
        />
      )}
      <MenuItem
        icon={<Copy size={14} />}
        label="Copy Path"
        onClick={onCopyPath}
      />
      <div className="context-menu-separator" />
      <MenuItem
        icon={<Trash2 size={14} />}
        label="Delete Image"
        onClick={onDelete}
        danger
      />
    </div>
  );
};
