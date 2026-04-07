import React, { useState, useEffect } from 'react';

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

  useEffect(() => {
    if (defaultUrl && !defaultText) {
      setText(defaultUrl);
    }
  }, [defaultUrl, defaultText]);

  const handleBrowseSdoc = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'Sdoc Files', extensions: ['sdoc'] }],
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || selected;
        setUrl(`./${fileName}`);
        setText(fileName.replace(/\.sdoc$/, ''));
      }
    } catch { /* dialog cancelled */ }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onConfirm(url.trim(), text.trim() || url.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
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
