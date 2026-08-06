import React, { useState, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useEditorI18n } from '../i18n';
import { ModalDialog } from './ModalDialog';

interface ImageNameDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
  defaultName?: string;
}

export const ImageNameDialog: React.FC<ImageNameDialogProps> = ({
  onConfirm,
  onCancel,
  defaultName = ''
}) => {
  const { t } = useEditorI18n();
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.select());
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName) {
      onConfirm(trimmedName);
    }
  };

  return (
    <ModalDialog
      titleId={titleId}
      size="sm"
      initialFocusRef={inputRef}
      onCancel={onCancel}
    >
        <div className="modal-header">
          <h3 id={titleId}>{t('image.nameDialogTitle')}</h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label htmlFor={inputId}>{t('image.enterName')}:</label>
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('image.namePlaceholder')}
                className="form-input"
                aria-describedby={hintId}
              />
              <small id={hintId}>{t('image.nameHint')}</small>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onCancel}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!name.trim()}
            >
              {t('image.insert')}
            </button>
          </div>
        </form>
    </ModalDialog>
  );
};
