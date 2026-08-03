import React, { useEffect, useId, useRef, useState } from 'react';
import type { PersonalTemplateMetadataInput } from '../../types/messages';

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const useModalFocus = (
  dialogRef: React.RefObject<HTMLElement | null>,
  initialFocusRef: React.RefObject<HTMLElement | null>,
) => {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    queueMicrotask(() => initialFocusRef.current?.focus());
    return () => {
      const target = returnFocusRef.current;
      queueMicrotask(() => target?.isConnected && target.focus());
    };
  }, [initialFocusRef]);

  return (event: React.KeyboardEvent<HTMLElement>, onCancel: () => void): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
    event.preventDefault();
    focusable[next]?.focus();
  };
};

interface TemplateConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const TemplateConfirmDialog: React.FC<TemplateConfirmDialogProps> = ({
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const handleKeyDown = useModalFocus(dialogRef, cancelRef);
  return (
    <div
      className="template-dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="template-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => handleKeyDown(event, onCancel)}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <div className="template-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className={destructive ? 'is-destructive' : 'is-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export interface TemplateMetadataValidation {
  value?: PersonalTemplateMetadataInput;
  errors: {
    name?: string;
    description?: string;
    category?: string;
  };
}

export const validateTemplateMetadata = (
  input: PersonalTemplateMetadataInput,
  labels: { name: string; description: string; category: string },
): TemplateMetadataValidation => {
  const name = input.name.trim();
  const description = input.description?.trim() ?? '';
  const category = input.category?.trim() ?? '';
  const errors: TemplateMetadataValidation['errors'] = {};
  if (name.length < 1 || name.length > 200) errors.name = labels.name;
  if (description.length > 2_000) errors.description = labels.description;
  if (category.length > 100) errors.category = labels.category;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    value: {
      name,
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
    },
    errors,
  };
};

interface TemplateMetadataDialogProps {
  title: string;
  defaults: PersonalTemplateMetadataInput;
  nameLabel: string;
  descriptionLabel: string;
  categoryLabel: string;
  nameError: string;
  descriptionError: string;
  categoryError: string;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: (metadata: PersonalTemplateMetadataInput) => void;
  onCancel: () => void;
}

export const TemplateMetadataDialog: React.FC<TemplateMetadataDialogProps> = ({
  title,
  defaults,
  nameLabel,
  descriptionLabel,
  categoryLabel,
  nameError,
  descriptionError,
  categoryError,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
}) => {
  const [metadata, setMetadata] = useState(defaults);
  const [errors, setErrors] = useState<TemplateMetadataValidation['errors']>({});
  const dialogRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const handleKeyDown = useModalFocus(dialogRef, nameRef);
  const submit = (): void => {
    const result = validateTemplateMetadata(metadata, {
      name: nameError,
      description: descriptionError,
      category: categoryError,
    });
    setErrors(result.errors);
    if (result.value) onSubmit(result.value);
  };
  return (
    <div
      className="template-dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="template-dialog template-metadata-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => handleKeyDown(event, onCancel)}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <label>
          {nameLabel}
          <input
            ref={nameRef}
            value={metadata.name}
            maxLength={201}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => setMetadata({ ...metadata, name: event.currentTarget.value })}
          />
          {errors.name && <span className="template-dialog-error" role="alert">{errors.name}</span>}
        </label>
        <label>
          {descriptionLabel}
          <textarea
            value={metadata.description ?? ''}
            maxLength={2_001}
            aria-invalid={Boolean(errors.description)}
            onChange={(event) => setMetadata({ ...metadata, description: event.currentTarget.value })}
          />
          {errors.description && <span className="template-dialog-error" role="alert">{errors.description}</span>}
        </label>
        <label>
          {categoryLabel}
          <input
            value={metadata.category ?? ''}
            maxLength={101}
            aria-invalid={Boolean(errors.category)}
            onChange={(event) => setMetadata({ ...metadata, category: event.currentTarget.value })}
          />
          {errors.category && <span className="template-dialog-error" role="alert">{errors.category}</span>}
        </label>
        <div className="template-dialog-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="submit" className="is-primary">{submitLabel}</button>
        </div>
      </form>
    </div>
  );
};
