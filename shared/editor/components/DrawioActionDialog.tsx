import React from 'react';
import { FilePlus, FileUp } from 'lucide-react';

interface DrawioActionDialogProps {
  onCreateNew: () => void;
  onImportExisting: () => void;
  onCancel: () => void;
}

export const DrawioActionDialog: React.FC<DrawioActionDialogProps> = ({
  onCreateNew,
  onImportExisting,
  onCancel,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h3>Insert Draw.io Diagram</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={onCreateNew}
            className="btn-primary drawio-card"
          >
            <FilePlus size={20} />
            <div>
              <div className="drawio-card__title">Create New Diagram</div>
              <div className="drawio-card__desc">Start with a blank canvas</div>
            </div>
          </button>

          <button
            onClick={onImportExisting}
            className="btn-primary drawio-card"
          >
            <FileUp size={20} />
            <div>
              <div className="drawio-card__title">Import Existing Diagram</div>
              <div className="drawio-card__desc">Select a .drawio.svg file</div>
            </div>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
            style={{ marginTop: '8px' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
