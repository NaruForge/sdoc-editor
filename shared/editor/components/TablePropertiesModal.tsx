import React, { useState, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { X } from 'lucide-react';
import { useEditorI18n } from '../i18n';

interface TablePropertiesModalProps {
  editor: Editor;
  onClose: () => void;
}

export const TablePropertiesModal: React.FC<TablePropertiesModalProps> = ({
  editor,
  onClose
}) => {
  const { t } = useEditorI18n();
  const [caption, setCaption] = useState('');
  const [align, setAlign] = useState('left');
  const [width, setWidth] = useState('100%');

  useEffect(() => {
    // Get current table attributes
    const attrs = editor.getAttributes('table');

    setCaption(attrs.caption || '');
    setAlign(attrs.align || 'left');
    setWidth(attrs.width || '100%');
  }, [editor]);

  const handleSave = () => {
    editor.chain().focus().updateAttributes('table', {
      caption: caption || null,
      align: align,
      width: width,
    }).run();

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="table-properties-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="table-properties-title">{t('table.propertiesTitle')}</h3>
          <button type="button" className="modal-close" aria-label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>{t('table.captionTitle')}:</label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={t('table.captionExample')}
              className="form-input"
            />
            <small>{t('table.captionNumberingHint')}</small>
          </div>

          <div className="form-group">
            <label>{t('table.alignment')}:</label>
            <select
              value={align}
              onChange={(e) => setAlign(e.target.value)}
              className="form-select"
            >
              <option value="left">{t('toolbar.alignLeft')}</option>
              <option value="center">{t('toolbar.alignCenter')}</option>
              <option value="right">{t('toolbar.alignRight')}</option>
            </select>
          </div>

          <div className="form-group">
            <label>{t('table.width')}:</label>
            <select
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="form-select"
            >
              <option value="100%">{t('table.fullWidth')}</option>
              <option value="75%">75%</option>
              <option value="50%">50%</option>
              <option value="auto">{t('table.autoWidth')}</option>
            </select>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={handleSave}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};
