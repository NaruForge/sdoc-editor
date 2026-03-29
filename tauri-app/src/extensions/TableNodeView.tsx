import { useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { Edit2 } from 'lucide-react';

const TableNodeView = ({ node, updateAttributes }: any) => {
  const caption = node.attrs.caption;
  const align = node.attrs.align || 'left';
  const width = node.attrs.width || '100%';
  const [isHovering, setIsHovering] = useState(false);

  const handleCaptionClick = () => {
    const newCaption = window.prompt('Enter table caption:', caption || '');
    if (newCaption !== null) {
      updateAttributes({
        caption: newCaption || null,
      });
    }
  };

  // Count table number (simplified - just use a counter)
  const tableNumber = 1; // In real implementation, count from document

  return (
    <NodeViewWrapper className="table-wrapper">
      <div
        className="table-caption-area"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={handleCaptionClick}
        style={{
          minHeight: '32px',
          padding: '4px 8px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '8px',
          borderRadius: '4px',
          backgroundColor: isHovering ? 'var(--vscode-list-hoverBackground)' : 'transparent',
          transition: 'background-color 0.2s',
        }}
      >
        {caption ? (
          <div style={{
            fontWeight: 'bold',
            fontSize: '0.95em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}>
            <span>Table {tableNumber}: {caption}</span>
            {isHovering && <Edit2 size={14} style={{ opacity: 0.6 }} />}
          </div>
        ) : (
          <div style={{
            color: 'var(--vscode-descriptionForeground)',
            fontStyle: 'italic',
            fontSize: '0.9em',
            opacity: isHovering ? 1 : 0.5,
            transition: 'opacity 0.2s',
          }}>
            Click to add caption...
          </div>
        )}
      </div>

      <div
        style={{
          width: width,
          marginLeft: align === 'center' ? 'auto' : align === 'right' ? 'auto' : '0',
          marginRight: align === 'center' ? 'auto' : align === 'left' ? 'auto' : '0',
          overflow: 'auto',
        }}
      >
        <NodeViewContent<'table'> as="table" />
      </div>
    </NodeViewWrapper>
  );
};

export default TableNodeView;
