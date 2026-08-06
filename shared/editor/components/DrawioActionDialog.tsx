import React, { useId } from 'react';
import { FilePlus, FileUp } from 'lucide-react';
import { useEditorI18n } from '../i18n';
import { ModalDialog } from './ModalDialog';

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
  const titleId = useId();

  return (
    <ModalDialog titleId={titleId} size="sm" onCancel={onCancel}>
        <h3 id={titleId}>{t('drawio.insertTitle')}</h3>

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
    </ModalDialog>
  );
};
