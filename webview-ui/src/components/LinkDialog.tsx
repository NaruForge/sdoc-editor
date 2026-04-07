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

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px',
    background: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '13px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    fontSize: '13px',
    fontFamily: 'var(--vscode-font-family)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '6px',
    fontSize: '13px',
    color: 'var(--vscode-descriptionForeground)',
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ minWidth: '400px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Insert Link</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label htmlFor="link-url" style={labelStyle}>URL:</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                id="link-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                style={{ ...inputStyle, flex: 1 }}
                placeholder="https://... or ./other.sdoc#id"
              />
              <button type="button" onClick={handleBrowseSdoc} style={btnStyle} title="Browse .sdoc files">
                📄
              </button>
            </div>
          </div>

          {showTargets && sdocTargets.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>Link to a section in {sdocPath}:</label>
              <div style={{
                maxHeight: '200px',
                overflowY: 'auto',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                background: 'var(--vscode-input-background)',
              }}>
                <div
                  style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid var(--vscode-input-border)' }}
                  onClick={() => { setUrl(sdocPath); setText(sdocPath.replace(/\.sdoc$/, '').split('/').pop() || sdocPath); setShowTargets(false); }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  📄 Document (no specific section)
                </div>
                {sdocTargets.map(t => (
                  <div
                    key={t.id}
                    style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '13px' }}
                    onClick={() => handleSelectTarget(t)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
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

          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="link-text" style={labelStyle}>Link Text (optional):</label>
            <input
              id="link-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              style={inputStyle}
              placeholder="Click here"
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
            <button
              type="submit"
              disabled={!url.trim()}
              style={{
                ...btnStyle,
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                cursor: url.trim() ? 'pointer' : 'not-allowed',
                opacity: url.trim() ? 1 : 0.5,
              }}
            >
              Insert
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
