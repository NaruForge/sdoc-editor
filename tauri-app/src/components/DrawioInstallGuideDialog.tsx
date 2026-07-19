import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';

interface DrawioInstallGuideDialogProps {
  onClose: () => void;
}

const DRAWIO_DOWNLOAD_URL = 'https://www.drawio.com/';

export const DrawioInstallGuideDialog: React.FC<DrawioInstallGuideDialogProps> = ({ onClose }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={20} />
          Draw.io Desktop App Not Found
        </h3>

        <p style={{ marginTop: '8px', lineHeight: 1.5 }}>
          The diagram file was saved, but it could not be opened because the draw.io desktop
          application is not installed (or could not be launched).
        </p>
        <p style={{ lineHeight: 1.5 }}>
          Please install draw.io desktop, then double-click the diagram again to edit it.
        </p>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            type="button"
            onClick={() => open(DRAWIO_DOWNLOAD_URL)}
            className="btn-primary"
            style={{ flex: 1 }}
          >
            Download draw.io
          </button>
          <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
