import React, { useState, useEffect, useRef } from 'react';
import { useEditorI18n } from '../i18n';

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

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fileName.trim()) {
      onConfirm(fileName.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="drawio-name-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="drawio-name-title">{t('drawio.createTitle')}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="drawio-name" className="form-label">
              {t('drawio.fileName')}:
            </label>
            <input
              ref={inputRef}
              id="drawio-name"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="form-input"
              placeholder="diagram-name"
            />
            <div className="form-hint">
              {t('drawio.savedAs', { name: fileName.trim() || 'diagram-name' })}
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
      </div>
    </div>
  );
};
