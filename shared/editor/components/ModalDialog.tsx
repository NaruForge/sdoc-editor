import React, { useRef } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';

export type ModalDialogSize = 'sm' | 'md' | 'lg';

interface ModalDialogProps {
  titleId: string;
  descriptionId?: string;
  size?: ModalDialogSize;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  overlayClassName?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
  onCancel: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  titleId,
  descriptionId,
  size = 'sm',
  role = 'dialog',
  className,
  overlayClassName,
  initialFocusRef,
  fallbackFocusRef,
  onCancel,
  onKeyDown,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleModalKeyDown = useModalFocus(
    dialogRef,
    initialFocusRef,
    onCancel,
    fallbackFocusRef,
  );

  return (
    <div
      className={['modal-overlay', overlayClassName].filter(Boolean).join(' ')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={[
          'modal-content',
          `modal-content--${size}`,
          className,
        ].filter(Boolean).join(' ')}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          onKeyDown?.(event);
          if (!event.defaultPrevented) handleModalKeyDown(event);
        }}
      >
        {children}
      </div>
    </div>
  );
};
