import React, { useEffect, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { useTiptapEditor } from '../hooks/useTiptapEditor';
import { useEditorContext } from '../context/EditorContext';
import { useVSCodeMessaging } from '../hooks/useVSCodeMessaging';
import { Toolbar } from './Toolbar';
import { BubbleMenuBar } from './BubbleMenuBar';
import { TableContextMenu } from './TableContextMenu';
import { TablePropertiesModal } from './TablePropertiesModal';
import { ImageNameDialog } from './ImageNameDialog';

export const Editor: React.FC = () => {
  const { state, dispatch } = useEditorContext();
  const [showNumbering, setShowNumbering] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showTableProperties, setShowTableProperties] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ blob: Blob; dataUrl: string } | null>(null);

  const { postMessage } = useVSCodeMessaging((message) => {
    switch (message.type) {
      case 'init':
      case 'update':
        dispatch({ type: 'SET_DOC', payload: message.content });
        break;
      case 'imageSaved':
        // Image was saved, insert it with the webview URI for display
        if (editor && message.webviewUri) {
          editor.chain().focus().setImage({ 
            src: message.webviewUri, 
            alt: message.imageName || '' 
          }).run();
          flushUpdate();
        }
        break;
    }
  });

  const handleViewJson = () => {
    postMessage({ type: 'viewJson' });
  };

  const handleToggleNumbering = () => {
    setShowNumbering(!showNumbering);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    // Check if we're in a table
    if (editor && editor.isActive('table')) {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    }
  };

  const handlePaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    // Look for image in clipboard
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          // Read as data URL for preview
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            setPendingImage({ blob, dataUrl });
          };
          reader.readAsDataURL(blob);
        }
        break;
      }
    }
  };

  const handleImageNameConfirm = async (name: string) => {
    if (!pendingImage) return;

    // Convert blob to base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      const extension = pendingImage.blob.type.split('/')[1] || 'png';
      
      // Send to VS Code to save
      postMessage({
        type: 'saveImage',
        imageName: name,
        imageData: base64,
        extension: extension,
      });
      
      setPendingImage(null);
    };
    reader.readAsDataURL(pendingImage.blob);
  };

  const { editor, setContent, flushUpdate } = useTiptapEditor({
    onUpdate: (content) => {
      postMessage({ type: 'edit', content });
    },
  });

  // Expose flushUpdate to window for NodeView access
  useEffect(() => {
    if (editor) {
      (window as any).__editorFlushUpdate = flushUpdate;
    }
    return () => {
      delete (window as any).__editorFlushUpdate;
    };
  }, [editor, flushUpdate]);

  // Add paste event listener for clipboard images
  useEffect(() => {
    if (!editor) return;
    
    const editorElement = editor.view.dom;
    editorElement.addEventListener('paste', handlePaste as any);
    
    return () => {
      editorElement.removeEventListener('paste', handlePaste as any);
    };
  }, [editor]);

  // Update editor content when document changes
  useEffect(() => {
    if (state.doc && editor) {
      setContent(state.doc);
      
      if (!state.isReady) {
        dispatch({ type: 'SET_READY', payload: true });
      }
    }
  }, [state.doc, editor]);

  if (!editor) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        Loading editor...
      </div>
    );
  }

  return (
    <>
      <Toolbar 
        editor={editor} 
        onViewJson={handleViewJson}
        showNumbering={showNumbering}
        onToggleNumbering={handleToggleNumbering}
      />
      {editor && <BubbleMenuBar editor={editor} />}
      <div onContextMenu={handleContextMenu}>
        <EditorContent 
          editor={editor} 
          className={showNumbering ? 'show-numbering' : 'hide-numbering'}
        />
      </div>
      {contextMenu && editor && (
        <TableContextMenu
          editor={editor}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenProperties={() => {
            setContextMenu(null);
            setShowTableProperties(true);
          }}
        />
      )}
      {showTableProperties && editor && (
        <TablePropertiesModal
          editor={editor}
          onClose={() => setShowTableProperties(false)}
        />
      )}
      {pendingImage && (
        <ImageNameDialog
          defaultName={`image-${Date.now()}`}
          onConfirm={handleImageNameConfirm}
          onCancel={() => setPendingImage(null)}
        />
      )}
    </>
  );
};
