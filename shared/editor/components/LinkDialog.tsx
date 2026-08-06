import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import type { SdocFileBrowseResultMessage } from '../../types/messages';
import { normalizeSafeLinkUrl } from '../../document/linkUrl';
import { useEditorI18n } from '../i18n';
import { ModalDialog } from './ModalDialog';

interface ExternalTarget {
  id: string;
  type: string;
  label: string;
}

export interface LinkDialogProps {
  mode?: 'insert' | 'edit';
  defaultUrl?: string;
  defaultText?: string;
  mixedFormatting?: boolean;
  onConfirm: (url: string, text: string) => void;
  onCancel: () => void;
  onBrowseSdoc?: () => void;
  onOpen?: () => void;
  onCopy?: () => void | Promise<boolean>;
  onRemove?: () => void;
}

export const LinkDialog: React.FC<LinkDialogProps> = ({
  mode = 'insert',
  defaultUrl = '',
  defaultText = '',
  mixedFormatting = false,
  onConfirm,
  onCancel,
  onBrowseSdoc,
  onOpen,
  onCopy,
  onRemove,
}) => {
  const { t } = useEditorI18n();
  const [url, setUrl] = useState(defaultUrl);
  const [text, setText] = useState(defaultText);
  const [sdocPath, setSdocPath] = useState('');
  const [sdocTargets, setSdocTargets] = useState<ExternalTarget[]>([]);
  const [showTargets, setShowTargets] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const urlInputId = useId();
  const textInputId = useId();
  const targetsLabelId = useId();
  const warningId = useId();
  const urlErrorId = useId();

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
    const normalized = normalizeSafeLinkUrl(url);
    if (!normalized.ok) {
      setUrlError(t('link.unsafeUrl'));
      return;
    }
    setUrlError('');
    onConfirm(normalized.url, text.trim() || normalized.url);
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
        <h3 id={titleId}>{mode === 'edit' ? t('link.editTitle') : t('link.insertTitle')}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor={urlInputId} className="form-label">{t('link.url')}:</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                ref={urlInputRef}
                id={urlInputId}
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
                className="form-input"
                style={{ flex: 1 }}
                placeholder={t('link.urlPlaceholder')}
                aria-invalid={urlError ? 'true' : undefined}
                aria-describedby={urlError ? urlErrorId : undefined}
              />
              {onBrowseSdoc && (
                <button type="button" onClick={onBrowseSdoc} className="btn-secondary" title={t('link.browseSdoc')} aria-label={t('link.browseSdoc')}>
                  📄
                </button>
              )}
            </div>
            {urlError && <p id={urlErrorId} role="alert">{urlError}</p>}
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
              aria-describedby={mixedFormatting ? warningId : undefined}
            />
          </div>
          {mixedFormatting && (
            <p id={warningId} role="status">
              {t('link.mixedFormatting')}
            </p>
          )}
          <div className="modal-actions">
            {mode === 'edit' && onOpen && (
              <button type="button" onClick={onOpen} className="btn-secondary">{t('link.open')}</button>
            )}
            {mode === 'edit' && onCopy && (
              <button type="button" onClick={() => {
                void Promise.resolve(onCopy()).then((copied) => {
                  setCopyStatus(copied === false ? t('link.copyFailed') : t('link.copySuccess'));
                });
              }} className="btn-secondary">{t('link.copy')}</button>
            )}
            {mode === 'edit' && onRemove && (
              <button type="button" onClick={onRemove} className="btn-secondary">{t('link.remove')}</button>
            )}
            <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="btn-primary"
            >
              {mode === 'edit' ? t('common.save') : t('common.insert')}
            </button>
          </div>
          {copyStatus && <p role="status">{copyStatus}</p>}
        </form>
    </ModalDialog>
  );
};
