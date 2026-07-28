import React, { forwardRef } from 'react';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  label: string;
  pressed?: boolean;
  danger?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  pressed,
  danger = false,
  className = '',
  children,
  onPointerDown,
  type = 'button',
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={props.title ?? label}
      onPointerDown={(event) => {
        if (event.button === 0) event.preventDefault();
        onPointerDown?.(event);
      }}
      className={[
        'toolbar-button',
        pressed ? 'is-active' : '',
        danger ? 'is-danger' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  );
});
