import React, { useState, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { X } from 'lucide-react';

interface TablePropertiesModalProps {
  editor: Editor;
  onClose: () => void;
}

export const TablePropertiesModal: React.FC<TablePropertiesModalProps> = ({
  editor,
  onClose
}) => {
  const [caption, setCaption] = useState('');
  const [align, setAlign] = useState('left');
  const [width, setWidth] = useState('100%');

  useEffect(() => {
    // Get current table attributes
    const attrs = editor.getAttributes('table');

    setCaption(attrs.caption || '');
    setAlign(attrs.align || 'left');
    setWidth(attrs.width || '100%');
  }, [editor]);

  const handleSave = () => {
    editor.chain().focus().updateAttributes('table', {
      caption: caption || null,
      align: align,
      width: width,
    }).run();

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Table Properties</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>Caption (Title):</label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="e.g., User Statistics"
              className="form-input"
            />
            <small>Used for table numbering (Table 1, Table 2, etc.)</small>
          </div>

          <div className="form-group">
            <label>Alignment:</label>
            <select
              value={align}
              onChange={(e) => setAlign(e.target.value)}
              className="form-select"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>

          <div className="form-group">
            <label>Width:</label>
            <select
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="form-select"
            >
              <option value="100%">Full Width (100%)</option>
              <option value="75%">75%</option>
              <option value="50%">50%</option>
              <option value="auto">Auto</option>
            </select>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
