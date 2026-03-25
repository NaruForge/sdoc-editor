import React, { useState, useEffect, useRef } from 'react';

interface DrawioNameDialogProps {
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export const DrawioNameDialog: React.FC<DrawioNameDialogProps> = ({
  defaultName,
  onConfirm,
  onCancel,
}) => {
  const [fileName, setFileName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fileName.trim()) {
      onConfirm(fileName.trim());
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
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Create Draw.io Diagram</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label 
              htmlFor="drawio-name" 
              style={{ 
                display: 'block',
                marginBottom: '8px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              File name (without extension):
            </label>
            <input
              ref={inputRef}
              id="drawio-name"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
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
              placeholder="diagram-name"
            />
            <div style={{ 
              marginTop: '4px',
              fontSize: '11px',
              color: 'var(--vscode-descriptionForeground)'
            }}>
              Will be saved as: {fileName.trim() || 'diagram-name'}.drawio.svg
            </div>
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
              disabled={!fileName.trim()}
              style={{
                padding: '6px 14px',
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                border: 'none',
                borderRadius: '2px',
                cursor: fileName.trim() ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                opacity: fileName.trim() ? 1 : 0.5,
              }}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
