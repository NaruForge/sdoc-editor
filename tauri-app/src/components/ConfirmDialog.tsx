import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 위험한 동작(삭제 등)임을 나타내는 빨간색 확인 버튼 스타일. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 재사용 가능한 확인 모달. `window.confirm`은 Tauri WebView에서 실제 사용자 입력을 기다리지
 * 않고 즉시 반환되는 경우가 있어(클릭 전에 이미 후속 로직이 실행되는 버그의 원인), 반드시
 * 이 컴포넌트처럼 React state와 버튼 클릭에 바인딩된 콜백을 사용해야 한다.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-content--md" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {danger && <AlertTriangle size={18} />}
          {title}
        </h3>
        <p style={{ lineHeight: 1.5, whiteSpace: 'pre-line' }}>{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel} className="btn-secondary" autoFocus>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={danger ? 'btn-danger' : 'btn-primary'}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
