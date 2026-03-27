import React, { useState, useEffect } from 'react';

interface ImagePropertiesDialogProps {
  src: string;
  alt: string;
  align?: string;
  onConfirm: (alt: string, align: string) => void;
  onReplace: () => void;
  onCancel: () => void;
  isDrawio?: boolean;
}

export const ImagePropertiesDialog: React.FC<ImagePropertiesDialogProps> = ({
  src,
  alt,
  align = 'center',
  onConfirm,
  onReplace,
  onCancel,
  isDrawio = false,
}) => {
  const [altText, setAltText] = useState(alt);
  const [alignValue, setAlignValue] = useState(align);

  useEffect(() => {
    setAltText(alt);
    setAlignValue(align);
  }, [alt, align]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(altText.trim(), alignValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  // Extract filename from src
  const getFilename = (srcPath: string) => {
    // Handle webview URIs for both images and drawio
    const match = srcPath.match(/(?:images|drawio)\/([^?#]+)/);
    if (match) {
      return match[1];
    }
    // Fallback to simple extraction
    const parts = srcPath.split('/');
    return parts[parts.length - 1] || 'Unknown';
  };

  // Extract relative path
  const getPath = (srcPath: string) => {
    const match = srcPath.match(/((?:images|drawio)\/[^?#]+)/);
    if (match) {
      return './' + match[1];
    }
    return srcPath;
  };

  const filename = getFilename(src);
  const path = getPath(src);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Image Properties</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label 
              style={{ 
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              Filename:
            </label>
            <div 
              style={{ 
                padding: '6px 8px',
                backgroundColor: 'var(--vscode-input-background)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '13px',
                color: 'var(--vscode-input-foreground)',
                fontFamily: 'var(--vscode-editor-font-family)',
                wordBreak: 'break-all'
              }}
            >
              {filename}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label 
              style={{ 
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              Path:
            </label>
            <div 
              style={{ 
                padding: '6px 8px',
                backgroundColor: 'var(--vscode-input-background)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '13px',
                color: 'var(--vscode-input-foreground)',
                fontFamily: 'var(--vscode-editor-font-family)',
                wordBreak: 'break-all'
              }}
            >
              {path}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              Alignment:
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAlignValue(a)}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    background: alignValue === a
                      ? 'var(--vscode-button-background)'
                      : 'var(--vscode-input-background)',
                    color: alignValue === a
                      ? 'var(--vscode-button-foreground)'
                      : 'var(--vscode-input-foreground)',
                  }}
                >
                  {a === 'left' ? '← Left' : a === 'center' ? '↔ Center' : 'Right →'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="image-alt"
              style={{ 
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              Alt Text:
            </label>
            <input
              id="image-alt"
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe this image..."
              autoFocus
              style={{
                width: '100%',
                padding: '6px 8px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '13px',
                outline: 'none',
                fontFamily: 'var(--vscode-font-family)',
              }}
            />
          </div>

          <div 
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              gap: '8px'
            }}
          >
            {!isDrawio && (
              <button
                type="button"
                onClick={onReplace}
                className="btn-secondary"
                style={{
                  flex: '1',
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Replace Image...
              </button>
            )}
            <div style={{ display: 'flex', gap: '8px', marginLeft: isDrawio ? 'auto' : '0' }}>
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary"
                style={{
                  padding: '6px 12px',
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
                className="btn-primary"
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
