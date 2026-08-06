import React, { useState, useEffect, useId, useRef } from 'react';
import { useEditorI18n } from '../i18n';
import { ModalDialog } from './ModalDialog';

interface DrawioNameDialogProps {
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export const DrawioNameDialog: React.FC<DrawioNameDialogProps> = ({
  defaultName,
  onConfirm,
  onCancel,
}) => {
  const { t } = useEditorI18n();
  const [fileName, setFileName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.select());
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fileName.trim()) {
      onConfirm(fileName.trim());
    }
  };

  return (
    <ModalDialog
      titleId={titleId}
      size="sm"
      initialFocusRef={inputRef}
      onCancel={onCancel}
    >
        <h3 id={titleId}>{t('drawio.createTitle')}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor={inputId} className="form-label">
              {t('drawio.fileName')}:
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="form-input"
              placeholder={t('drawio.namePlaceholder')}
              aria-describedby={hintId}
            />
            <div id={hintId} className="form-hint">
              {t('drawio.savedAs', {
                name: fileName.trim() || t('drawio.namePlaceholder'),
              })}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!fileName.trim()}
              className="btn-primary"
            >
              {t('common.create')}
            </button>
          </div>
        </form>
    </ModalDialog>
  );
};
