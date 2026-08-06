import React, { useId, useRef, useState } from 'react';
import type { PersonalTemplateMetadataInput } from '../../types/messages';
import { ModalDialog } from './ModalDialog';

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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalDialog
      titleId={titleId}
      descriptionId={descriptionId}
      role="alertdialog"
      size="sm"
      className="template-dialog"
      overlayClassName="template-dialog-scrim"
      initialFocusRef={cancelRef}
      onCancel={onCancel}
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
    </ModalDialog>
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
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const nameId = useId();
  const nameErrorId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();
  const categoryId = useId();
  const categoryErrorId = useId();
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
    <ModalDialog
      titleId={titleId}
      size="md"
      className="template-dialog"
      overlayClassName="template-dialog-scrim"
      initialFocusRef={nameRef}
      onCancel={onCancel}
    >
      <form
        className="template-metadata-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <label htmlFor={nameId}>
          {nameLabel}
          <input
            ref={nameRef}
            id={nameId}
            value={metadata.name}
            maxLength={201}
            aria-invalid={Boolean(errors.name)}
            aria-errormessage={errors.name ? nameErrorId : undefined}
            onChange={(event) => setMetadata({ ...metadata, name: event.currentTarget.value })}
          />
          {errors.name && <span id={nameErrorId} className="template-dialog-error" role="alert">{errors.name}</span>}
        </label>
        <label htmlFor={descriptionId}>
          {descriptionLabel}
          <textarea
            id={descriptionId}
            value={metadata.description ?? ''}
            maxLength={2_001}
            aria-invalid={Boolean(errors.description)}
            aria-errormessage={errors.description ? descriptionErrorId : undefined}
            onChange={(event) => setMetadata({ ...metadata, description: event.currentTarget.value })}
          />
          {errors.description && <span id={descriptionErrorId} className="template-dialog-error" role="alert">{errors.description}</span>}
        </label>
        <label htmlFor={categoryId}>
          {categoryLabel}
          <input
            id={categoryId}
            value={metadata.category ?? ''}
            maxLength={101}
            aria-invalid={Boolean(errors.category)}
            aria-errormessage={errors.category ? categoryErrorId : undefined}
            onChange={(event) => setMetadata({ ...metadata, category: event.currentTarget.value })}
          />
          {errors.category && <span id={categoryErrorId} className="template-dialog-error" role="alert">{errors.category}</span>}
        </label>
        <div className="template-dialog-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="submit" className="is-primary">{submitLabel}</button>
        </div>
      </form>
    </ModalDialog>
  );
};
