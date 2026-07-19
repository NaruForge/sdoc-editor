import React, { useEffect, useState } from 'react';
import { Undo2, X } from 'lucide-react';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** 자동으로 사라지기까지의 시간(ms). */
  durationMs?: number;
}

/** 삭제 등 되돌릴 수 있는 작업 직후 잠시 표시되는 하단 토스트. "실행 취소" 버튼을 누르면
 *  onUndo가 호출되고, durationMs가 지나거나 닫기 버튼을 누르면 자동으로 사라진다. */
export const UndoToast: React.FC<UndoToastProps> = ({ message, onUndo, onDismiss, durationMs = 6000 }) => {
  const [remaining, setRemaining] = useState(durationMs);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const left = durationMs - (Date.now() - start);
      if (left <= 0) {
        clearInterval(interval);
        onDismiss();
      } else {
        setRemaining(left);
      }
    }, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <div className="undo-toast">
      <span className="undo-toast-message">{message}</span>
      <button className="undo-toast-action" onClick={onUndo}>
        <Undo2 size={14} />
        실행 취소
      </button>
      <button className="undo-toast-close" onClick={onDismiss} title="닫기">
        <X size={13} />
      </button>
      <div className="undo-toast-progress" style={{ width: `${(remaining / durationMs) * 100}%` }} />
    </div>
  );
};
