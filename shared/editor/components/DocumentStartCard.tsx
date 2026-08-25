import React from 'react';
import { useEditorI18n } from '../i18n';

interface DocumentStartCardProps {
  onStartEmpty: () => void;
  onCreateFromTemplate: () => void;
  onOpenExisting: () => void;
}

export const DocumentStartCard: React.FC<DocumentStartCardProps> = ({
  onStartEmpty,
  onCreateFromTemplate,
  onOpenExisting,
}) => {
  const { t } = useEditorI18n();
  return (
    <section className="document-start-card" aria-labelledby="document-start-title">
      <h2 id="document-start-title">{t('template.startTitle')}</h2>
      <p>{t('template.startDescription')}</p>
      <div className="document-start-actions">
        <button type="button" className="is-primary" onClick={onCreateFromTemplate}>
          {t('template.startFromTemplate')}
        </button>
        <button type="button" onClick={onStartEmpty}>{t('template.startEmpty')}</button>
        <button type="button" onClick={onOpenExisting}>{t('template.openExisting')}</button>
      </div>
      <p className="document-start-limits">{t('template.limitsNotice')}</p>
    </section>
  );
};
