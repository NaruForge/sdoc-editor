import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useEditorI18n } from '../i18n';

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

  useEffect(() => {
    // Focus input when dialog opens
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName) {
      onConfirm(trimmedName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-name-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h3 id="image-name-title">{t('image.nameDialogTitle')}</h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>{t('image.enterName')}:</label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., architecture-diagram"
                className="form-input"
              />
              <small>{t('image.nameHint')}</small>
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
      </div>
    </div>
  );
};
