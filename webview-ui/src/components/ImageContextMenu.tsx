import React, { useEffect } from 'react';
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
