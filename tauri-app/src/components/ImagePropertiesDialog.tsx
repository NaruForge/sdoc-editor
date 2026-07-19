import React, { useState, useEffect } from 'react';

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
    if (relativePathOverride) {
      return relativePathOverride.split('/').pop() || 'Unknown';
    }
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
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Image Properties</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Filename:</label>
            <div className="form-readonly">{filename}</div>
          </div>

          <div className="form-group">
            <label className="form-label">Path:</label>
            <div className="form-readonly">{path}</div>
          </div>

          <div className="form-group">
            <label className="form-label">Alignment:</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAlignValue(a)}
                  className={`align-btn ${alignValue === a ? 'align-btn--active' : ''}`}
                >
                  {a === 'left' ? '← Left' : a === 'center' ? '↔ Center' : 'Right →'}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="image-alt" className="form-label">Alt Text:</label>
            <input
              id="image-alt"
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe this image..."
              autoFocus
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
                Replace Image...
              </button>
            )}
            <div className="modal-actions" style={{ marginLeft: isDrawio ? 'auto' : '0' }}>
              <button type="button" onClick={onCancel} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                OK
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
