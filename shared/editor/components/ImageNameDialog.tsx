import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ImageNameDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
  defaultName?: string;
}

export const ImageNameDialog: React.FC<ImageNameDialogProps> = ({
  onConfirm,
  onCancel,
  defaultName = ''
}) => {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input when dialog opens
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName) {
      onConfirm(trimmedName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h3>Image Name</h3>
          <button className="modal-close" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Enter a name for the image:</label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., architecture-diagram"
                className="form-input"
              />
              <small>This will be used as the image filename and alt text</small>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!name.trim()}
            >
              Insert Image
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
