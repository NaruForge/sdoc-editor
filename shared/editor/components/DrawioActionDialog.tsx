import React from 'react';
import { FilePlus, FileUp } from 'lucide-react';
import { useEditorI18n } from '../i18n';

interface DrawioActionDialogProps {
  onCreateNew: () => void;
  onImportExisting: () => void;
  onCancel: () => void;
}

export const DrawioActionDialog: React.FC<DrawioActionDialogProps> = ({
  onCreateNew,
  onImportExisting,
  onCancel,
}) => {
  const { t } = useEditorI18n();
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="drawio-action-title" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h3 id="drawio-action-title">{t('drawio.insertTitle')}</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            type="button"
            onClick={onCreateNew}
            className="btn-primary drawio-card"
          >
            <FilePlus size={20} />
            <div>
              <div className="drawio-card__title">{t('drawio.createNew')}</div>
              <div className="drawio-card__desc">{t('drawio.blankCanvas')}</div>
            </div>
          </button>

          <button
            type="button"
            onClick={onImportExisting}
            className="btn-primary drawio-card"
          >
            <FileUp size={20} />
            <div>
              <div className="drawio-card__title">{t('drawio.importExisting')}</div>
              <div className="drawio-card__desc">{t('drawio.selectFile')}</div>
            </div>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
            style={{ marginTop: '8px' }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
