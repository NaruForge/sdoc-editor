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
        <h3>Create Draw.io Diagram</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="drawio-name" className="form-label">
              File name (without extension):
            </label>
            <input
              ref={inputRef}
              id="drawio-name"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="form-input"
              placeholder="diagram-name"
            />
            <div className="form-hint">
              Will be saved as: {fileName.trim() || 'diagram-name'}.drawio.svg
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!fileName.trim()}
              className="btn-primary"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
