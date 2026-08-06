import React, { useState, useEffect, useId, useRef } from 'react';
import { useEditorI18n } from '../i18n';
import { ModalDialog } from './ModalDialog';

interface ImagePropertiesDialogProps {
  src: string;
  alt: string;
  align?: string;
  onConfirm: (alt: string, align: string) => void;
  onReplace: () => void;
  onCancel: () => void;
  isDrawio?: boolean;
  /** Document-relative path (e.g. "./drawio/diagram-1.drawio.svg"), when known. Overrides the
   *  best-effort regex extraction from `src`, which can be wrong for percent-encoded asset URLs. */
  path?: string;
}

export const ImagePropertiesDialog: React.FC<ImagePropertiesDialogProps> = ({
  src,
  alt,
  align = 'center',
  onConfirm,
  onReplace,
  onCancel,
  isDrawio = false,
  path: relativePathOverride,
}) => {
  const { t } = useEditorI18n();
  const [altText, setAltText] = useState(alt);
  const [alignValue, setAlignValue] = useState(align);
  const altInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const filenameLabelId = useId();
  const pathLabelId = useId();
  const alignmentLabelId = useId();
  const altInputId = useId();

  useEffect(() => {
    setAltText(alt);
    setAlignValue(align);
  }, [alt, align]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(altText.trim(), alignValue);
  };

  // Extract filename from src
  const getFilename = (srcPath: string) => {
    if (relativePathOverride) {
      return relativePathOverride.split('/').pop() || t('common.unknown');
    }
    // Handle webview URIs for both images and drawio
    const match = srcPath.match(/(?:images|drawio)\/([^?#]+)/);
    if (match) {
      return match[1];
    }
    // Fallback to simple extraction
    const parts = srcPath.split('/');
    return parts[parts.length - 1] || t('common.unknown');
  };

  // Extract relative path
  const getPath = (srcPath: string) => {
    if (relativePathOverride) {
      return relativePathOverride;
    }
    const match = srcPath.match(/((?:images|drawio)\/[^?#]+)/);
    if (match) {
      return './' + match[1];
    }
    return srcPath;
  };

  const filename = getFilename(src);
  const path = getPath(src);

  return (
    <ModalDialog
      titleId={titleId}
      size="md"
      initialFocusRef={altInputRef}
      onCancel={onCancel}
    >
        <h3 id={titleId}>{t('image.properties')}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <div id={filenameLabelId} className="form-label">{t('image.filename')}:</div>
            <div className="form-readonly" aria-labelledby={filenameLabelId}>{filename}</div>
          </div>

          <div className="form-group">
            <div id={pathLabelId} className="form-label">{t('image.path')}:</div>
            <div className="form-readonly" aria-labelledby={pathLabelId}>{path}</div>
          </div>

          <div className="form-group">
            <div id={alignmentLabelId} className="form-label">{t('image.alignment')}:</div>
            <div role="group" aria-labelledby={alignmentLabelId} style={{ display: 'flex', gap: '6px' }}>
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAlignValue(a)}
                  className={`align-btn ${alignValue === a ? 'align-btn--active' : ''}`}
                  aria-pressed={alignValue === a}
                >
                  {a === 'left' ? t('image.alignLeftShort') : a === 'center' ? t('image.alignCenterShort') : t('image.alignRightShort')}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor={altInputId} className="form-label">{t('image.altText')}:</label>
            <input
              ref={altInputRef}
              id={altInputId}
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder={t('image.altTextPlaceholder')}
              className="form-input"
            />
          </div>

          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            {!isDrawio && (
              <button
                type="button"
                onClick={onReplace}
                className="btn-secondary"
                style={{ flex: '1' }}
              >
                {t('image.replace')}
              </button>
            )}
            <div className="modal-actions" style={{ marginLeft: isDrawio ? 'auto' : '0' }}>
              <button type="button" onClick={onCancel} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn-primary">
                {t('common.ok')}
              </button>
            </div>
          </div>
        </form>
    </ModalDialog>
  );
};
