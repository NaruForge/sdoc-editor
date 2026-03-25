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
    // If URL is provided but no text, try to use URL as text
    if (defaultUrl && !defaultText) {
      setText(defaultUrl);
    }
  }, [defaultUrl, defaultText]);

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

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Insert Link</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label 
              htmlFor="link-url" 
              style={{ 
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              URL:
            </label>
            <input
              id="link-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              style={{
                width: '100%',
                padding: '6px 8px',
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '13px',
                fontFamily: 'var(--vscode-font-family)',
              }}
              placeholder="https://example.com"
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label 
              htmlFor="link-text" 
              style={{ 
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              Link Text (optional):
            </label>
            <input
              id="link-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '13px',
                fontFamily: 'var(--vscode-font-family)',
              }}
              placeholder="Click here"
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '6px 14px',
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              style={{
                padding: '6px 14px',
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                border: 'none',
                borderRadius: '2px',
                cursor: url.trim() ? 'pointer' : 'not-allowed',
                fontSize: '13px',
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
