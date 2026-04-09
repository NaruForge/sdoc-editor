import React, { useState, useEffect, useCallback } from 'react';

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
}

export const LinkDialog: React.FC<LinkDialogProps> = ({
  defaultUrl = '',
  defaultText = '',
  onConfirm,
  onCancel,
}) => {
  const [url, setUrl] = useState(defaultUrl);
  const [text, setText] = useState(defaultText);
  const [sdocPath, setSdocPath] = useState('');
  const [sdocTargets, setSdocTargets] = useState<ExternalTarget[]>([]);
  const [showTargets, setShowTargets] = useState(false);

  useEffect(() => {
    if (defaultUrl && !defaultText) {
      setText(defaultUrl);
    }
  }, [defaultUrl, defaultText]);

  // Listen for sdocFileBrowseResult from extension
  const handleMessage = useCallback((event: MessageEvent) => {
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

  const handleBrowseSdoc = () => {
    const vscode = (window as any).vscode;
    if (vscode) {
      vscode.postMessage({ type: 'browseSdocFiles' });
    }
  };

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
    if (e.key === 'Escape') {
      if (showTargets) {
        setShowTargets(false);
      } else {
        onCancel();
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Insert Link</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="link-url" className="form-label">URL:</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                id="link-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                className="form-input"
                style={{ flex: 1 }}
                placeholder="https://... or ./other.sdoc#id"
              />
              <button type="button" onClick={handleBrowseSdoc} className="btn-secondary" title="Browse .sdoc files">
                📄
              </button>
            </div>
          </div>

          {showTargets && sdocTargets.length > 0 && (
            <div className="form-group">
              <label className="form-label">Link to a section in {sdocPath}:</label>
              <div className="target-list">
                <div
                  className="target-list__item target-list__item--header"
                  onClick={() => { setUrl(sdocPath); setText(sdocPath.replace(/\.sdoc$/, '').split('/').pop() || sdocPath); setShowTargets(false); }}
                >
                  📄 Document (no specific section)
                </div>
                {sdocTargets.map(t => (
                  <div
                    key={t.id}
                    className="target-list__item"
                    onClick={() => handleSelectTarget(t)}
                  >
                    <span style={{ marginRight: '6px' }}>
                      {t.type === 'heading' ? '§' : t.type === 'figure' ? '🖼' : '▦'}
                    </span>
                    {t.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="link-text" className="form-label">Link Text (optional):</label>
            <input
              id="link-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              className="form-input"
              placeholder="Click here"
            />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="btn-primary"
            >
              Insert
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
