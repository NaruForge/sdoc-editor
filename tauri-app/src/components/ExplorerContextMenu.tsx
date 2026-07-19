import React, { useEffect, useRef } from 'react';
import { FilePlus, FolderPlus, Pencil, FolderOpen, Copy, RefreshCw, Trash2, Undo2 } from 'lucide-react';

export interface ExplorerContextMenuTarget {
  /** 우클릭된 경로. 루트(작업 폴더 빈 공간)일 경우 workspaceFolder 경로. */
  path: string;
  kind: 'folder' | 'file';
  /** 작업 폴더 루트(빈 공간)에서의 우클릭인지 여부. 루트는 이름 변경을 지원하지 않는다. */
  isRoot: boolean;
}

interface ExplorerContextMenuProps {
  position: { x: number; y: number };
  target: ExplorerContextMenuTarget;
  onClose: () => void;
  onCreateHere: (folderPath: string) => void;
  onCreateFolderHere: (folderPath: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onUndoDelete?: () => void;
  /** 되돌릴 수 있는 삭제 내역이 있는지 여부. false면 "삭제 취소" 항목이 비활성화된다. */
  hasDeletionHistory?: boolean;
  onRevealInFileExplorer: (path: string) => void;
  onCopyPath: (path: string) => void;
  onRefresh: () => void;
}

export const ExplorerContextMenu: React.FC<ExplorerContextMenuProps> = ({
  position,
  target,
  onClose,
  onCreateHere,
  onCreateFolderHere,
  onRename,
  onDelete,
  onUndoDelete,
  hasDeletionHistory = false,
  onRevealInFileExplorer,
  onCopyPath,
  onRefresh,
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

  const MenuItem: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }> = ({
    icon,
    label,
    onClick,
    disabled = false,
  }) => (
    <button
      className="context-menu-item"
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick();
        onClose();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const folderForCreate = target.kind === 'folder' ? target.path : target.path.split(/[\\/]/).slice(0, -1).join('/');

  return (
    <div
      ref={menuRef}
      className="table-context-menu"
      style={{ position: 'fixed', left: `${position.x}px`, top: `${position.y}px`, zIndex: 1000 }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem icon={<FilePlus size={14} />} label="새 문서" onClick={() => onCreateHere(folderForCreate)} />
      <MenuItem icon={<FolderPlus size={14} />} label="새 폴더" onClick={() => onCreateFolderHere(folderForCreate)} />
      {!target.isRoot && (
        <>
          <div className="context-menu-separator" />
          <MenuItem icon={<Pencil size={14} />} label="이름 바꾸기" onClick={onRename} />
          <MenuItem icon={<Trash2 size={14} />} label="삭제" onClick={onDelete} />
        </>
      )}
      <div className="context-menu-separator" />
      <MenuItem
        icon={<Undo2 size={14} />}
        label="삭제 취소"
        onClick={() => onUndoDelete?.()}
        disabled={!hasDeletionHistory}
      />
      <div className="context-menu-separator" />
      <MenuItem icon={<FolderOpen size={14} />} label="파일 탐색기에서 보기" onClick={() => onRevealInFileExplorer(target.path)} />
      <MenuItem icon={<Copy size={14} />} label="경로 복사" onClick={() => onCopyPath(target.path)} />
      <div className="context-menu-separator" />
      <MenuItem icon={<RefreshCw size={14} />} label="새로고침" onClick={onRefresh} />
    </div>
  );
};
