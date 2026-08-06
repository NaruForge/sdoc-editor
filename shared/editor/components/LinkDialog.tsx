import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import type { SdocFileBrowseResultMessage } from '../../types/messages';
import { useEditorI18n } from '../i18n';
import { ModalDialog } from './ModalDialog';

interface ExternalTarget {
  id: string;
  type: string;
  label: string;
}

interface LinkDialogProps {
  defaultUrl?: string;
  defaultText?: string;
  onConfirm: (url: string, text: string) => void;
  onCancel: () => void;
  onBrowseSdoc?: () => void;
}

export const LinkDialog: React.FC<LinkDialogProps> = ({
  defaultUrl = '',
  defaultText = '',
  onConfirm,
  onCancel,
  onBrowseSdoc,
}) => {
  const { t } = useEditorI18n();
  const [url, setUrl] = useState(defaultUrl);
  const [text, setText] = useState(defaultText);
  const [sdocPath, setSdocPath] = useState('');
  const [sdocTargets, setSdocTargets] = useState<ExternalTarget[]>([]);
  const [showTargets, setShowTargets] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const urlInputId = useId();
  const textInputId = useId();
  const targetsLabelId = useId();

  useEffect(() => {
    if (defaultUrl && !defaultText) {
      setText(defaultUrl);
    }
  }, [defaultUrl, defaultText]);

  // Listen for sdocFileBrowseResult from extension
  const handleMessage = useCallback((event: MessageEvent<SdocFileBrowseResultMessage>) => {
    const msg = event.data;
    if (msg.type === 'sdocFileBrowseResult') {
      setSdocPath(msg.path);
      setSdocTargets(msg.targets || []);
      setUrl(msg.path);
      setText(msg.fileName?.replace(/\.sdoc$/, '') || msg.path);
      if (msg.targets?.length > 0) {
        setShowTargets(true);
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const handleSelectTarget = (target: ExternalTarget) => {
    const fullUrl = `${sdocPath}#${target.id}`;
    setUrl(fullUrl);
    setText(target.label);
    setShowTargets(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onConfirm(url.trim(), text.trim() || url.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && showTargets) {
      e.preventDefault();
      setShowTargets(false);
    }
  };

  return (
    <ModalDialog
      titleId={titleId}
      size="md"
      initialFocusRef={urlInputRef}
      onCancel={onCancel}
      onKeyDown={handleKeyDown}
    >
        <h3 id={titleId}>{t('link.insertTitle')}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor={urlInputId} className="form-label">URL:</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                ref={urlInputRef}
                id={urlInputId}
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="form-input"
                style={{ flex: 1 }}
                placeholder={t('link.urlPlaceholder')}
              />
              {onBrowseSdoc && (
                <button type="button" onClick={onBrowseSdoc} className="btn-secondary" title={t('link.browseSdoc')} aria-label={t('link.browseSdoc')}>
                  📄
                </button>
              )}
            </div>
          </div>

          {showTargets && sdocTargets.length > 0 && (
            <div className="form-group">
              <div id={targetsLabelId} className="form-label">{t('link.sectionIn', { path: sdocPath })}:</div>
              <div className="target-list" role="group" aria-labelledby={targetsLabelId}>
                <button
                  type="button"
                  className="target-list__item target-list__item--header"
                  onClick={() => { setUrl(sdocPath); setText(sdocPath.replace(/\.sdoc$/, '').split('/').pop() || sdocPath); setShowTargets(false); }}
                >
                  📄 {t('link.wholeDocument')}
                </button>
                {sdocTargets.map(t => (
                  <button
                    type="button"
                    key={t.id}
                    className="target-list__item"
                    onClick={() => handleSelectTarget(t)}
                  >
                    <span style={{ marginRight: '6px' }}>
                      {t.type === 'heading' ? '§' : t.type === 'figure' ? '🖼' : '▦'}
                    </span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor={textInputId} className="form-label">{t('link.textOptional')}:</label>
            <input
              id={textInputId}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="form-input"
              placeholder={t('link.textPlaceholder')}
            />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="btn-primary"
            >
              {t('common.insert')}
            </button>
          </div>
        </form>
    </ModalDialog>
  );
};
