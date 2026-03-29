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
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Insert Draw.io Diagram</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={onCreateNew}
            className="btn-primary"
            style={{
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <FilePlus size={20} />
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Create New Diagram</div>
              <div style={{ fontSize: '12px', opacity: 0.8 }}>Start with a blank canvas</div>
            </div>
          </button>

          <button
            onClick={onImportExisting}
            className="btn-primary"
            style={{
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <FileUp size={20} />
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Import Existing Diagram</div>
              <div style={{ fontSize: '12px', opacity: 0.8 }}>Select a .drawio.svg file</div>
            </div>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontSize: '13px',
              marginTop: '8px',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
