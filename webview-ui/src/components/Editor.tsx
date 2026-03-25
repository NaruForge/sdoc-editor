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
import { DrawioNameDialog } from './DrawioNameDialog';
import { DrawioActionDialog } from './DrawioActionDialog';
import { LinkDialog } from './LinkDialog';
import { ImagePropertiesDialog } from './ImagePropertiesDialog';
import { ImageContextMenu } from './ImageContextMenu';

export const Editor: React.FC = () => {
  const { state, dispatch } = useEditorContext();
  const [showNumbering, setShowNumbering] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showTableProperties, setShowTableProperties] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showDrawioActionDialog, setShowDrawioActionDialog] = useState(false);
  const [showDrawioDialog, setShowDrawioDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [imageProperties, setImageProperties] = useState<{ pos: number; src: string; alt: string; isDrawio: boolean } | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number; pos: number; src: string; isDrawio: boolean } | null>(null);

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
      case 'drawioCreated':
        // Draw.io file was created, insert it as an image
        if (editor && message.webviewUri) {
          editor.chain().focus().setImage({ 
            src: message.webviewUri, 
            alt: message.fileName || 'diagram',
            title: message.fileName || 'diagram'
          }).run();
          flushUpdate();
        }
        break;
      case 'imageInserted':
        // Existing image was inserted, add it to editor
        if (editor && message.webviewUri) {
          editor.chain().focus().setImage({ 
            src: message.webviewUri, 
            alt: message.fileName || 'image'
          }).run();
          flushUpdate();
        }
        break;
      case 'imageReplaced':
        // Image was replaced, update the node at the given position
        if (editor && message.webviewUri && typeof message.pos === 'number') {
          editor.chain().focus().command(({ tr }) => {
            const node = tr.doc.nodeAt(message.pos);
            if (node && node.type.name === 'image') {
              tr.setNodeMarkup(message.pos, undefined, {
                ...node.attrs,
                src: message.webviewUri,
              });
            }
            return true;
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

  const handleInsertDrawio = () => {
    setShowDrawioActionDialog(true);
  };

  const handleDrawioCreateNew = () => {
    setShowDrawioActionDialog(false);
    setShowDrawioDialog(true);
  };

  const handleDrawioImportExisting = () => {
    setShowDrawioActionDialog(false);
    // Send message to VS Code to open file picker for .drawio files
    postMessage({
      type: 'importDrawio',
    });
  };

  const handleDrawioNameConfirm = (fileName: string) => {
    // Send message to VS Code to create draw.io file
    postMessage({
      type: 'createDrawio',
      fileName: fileName,
    });
    setShowDrawioDialog(false);
  };

  const handleInsertImage = () => {
    // Send message to VS Code to open file picker
    postMessage({
      type: 'insertExistingImage',
    });
  };

  const handleInsertLink = () => {
    setShowLinkDialog(true);
  };

  const handleLinkConfirm = (url: string, text: string) => {
    if (!editor) return;

    // If there's selected text, replace it with the link
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    if (hasSelection) {
      // Replace selected text with link
      editor.chain().focus()
        .deleteSelection()
        .insertContent({
          type: 'text',
          marks: [{ type: 'link', attrs: { href: url } }],
          text: text,
        })
        .run();
    } else {
      // Insert new text with link
      editor.chain().focus().insertContent({
        type: 'text',
        marks: [{ type: 'link', attrs: { href: url } }],
        text: text,
      }).run();
    }

    setShowLinkDialog(false);
    flushUpdate();
  };

  const handleImagePropertiesConfirm = (altText: string) => {
    if (!editor || !imageProperties) return;

    // Update the image node's alt attribute
    editor.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(imageProperties.pos, undefined, {
        ...editor.state.doc.nodeAt(imageProperties.pos)?.attrs,
        alt: altText,
      });
      return true;
    }).run();

    setImageProperties(null);
    flushUpdate();
  };

  const handleImageReplace = () => {
    if (!imageProperties) return;
    
    // Close the properties dialog
    setImageProperties(null);
    
    // Send message to VS Code to open file picker
    postMessage({
      type: 'replaceImage',
      pos: imageProperties.pos,
    });
  };

  const handleImageContextMenuOpen = (x: number, y: number, pos: number, src: string, _alt: string) => {
    const isDrawio = src.includes('.drawio.svg') || src.includes('/drawio/');
    setImageContextMenu({ x, y, pos, src, isDrawio });
  };

  const handleImageContextMenuProperties = () => {
    if (!imageContextMenu || !editor) return;
    
    const node = editor.state.doc.nodeAt(imageContextMenu.pos);
    if (node) {
      setImageProperties({
        pos: imageContextMenu.pos,
        src: imageContextMenu.src,
        alt: node.attrs.alt || '',
        isDrawio: imageContextMenu.isDrawio,
      });
    }
    setImageContextMenu(null);
  };

  const handleImageContextMenuReplace = () => {
    if (!imageContextMenu) return;
    
    postMessage({
      type: 'replaceImage',
      pos: imageContextMenu.pos,
    });
    setImageContextMenu(null);
  };

  const handleImageContextMenuCopyPath = () => {
    if (!imageContextMenu) return;
    
    // Extract relative path from src
    const match = imageContextMenu.src.match(/((?:images|drawio)\/[^?#]+)/);
    const path = match ? './' + match[1] : imageContextMenu.src;
    
    navigator.clipboard.writeText(path).then(() => {
      // Show a brief feedback (could use a toast notification if available)
      console.log('Path copied to clipboard:', path);
    });
    setImageContextMenu(null);
  };

  const handleImageContextMenuDelete = () => {
    if (!imageContextMenu || !editor) return;
    
    // Delete the image node
    editor.chain().focus().command(({ tr }) => {
      tr.delete(imageContextMenu.pos, imageContextMenu.pos + 1);
      return true;
    }).run();
    
    setImageContextMenu(null);
    flushUpdate();
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
      (window as any).__showImageProperties = (pos: number, src: string, alt: string) => {
        const isDrawio = src.includes('.drawio.svg') || src.includes('/drawio/');
        setImageProperties({ pos, src, alt, isDrawio });
      };
      (window as any).__showImageContextMenu = (x: number, y: number, pos: number, src: string, alt: string) => {
        handleImageContextMenuOpen(x, y, pos, src, alt);
      };
    }
    return () => {
      delete (window as any).__editorFlushUpdate;
      delete (window as any).__showImageProperties;
      delete (window as any).__showImageContextMenu;
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
        onInsertLink={handleInsertLink}
        onInsertImage={handleInsertImage}
        onInsertDrawio={handleInsertDrawio}
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
      {showDrawioActionDialog && (
        <DrawioActionDialog
          onCreateNew={handleDrawioCreateNew}
          onImportExisting={handleDrawioImportExisting}
          onCancel={() => setShowDrawioActionDialog(false)}
        />
      )}
      {showDrawioDialog && (
        <DrawioNameDialog
          defaultName={`diagram-${Date.now()}`}
          onConfirm={handleDrawioNameConfirm}
          onCancel={() => setShowDrawioDialog(false)}
        />
      )}
      {showLinkDialog && editor && (
        <LinkDialog
          onConfirm={(url, text) => handleLinkConfirm(url, text)}
          onCancel={() => setShowLinkDialog(false)}
          defaultText={editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            ' '
          )}
        />
      )}
      {imageProperties && (
        <ImagePropertiesDialog
          src={imageProperties.src}
          alt={imageProperties.alt}
          onConfirm={handleImagePropertiesConfirm}
          onReplace={handleImageReplace}
          onCancel={() => setImageProperties(null)}
          isDrawio={imageProperties.isDrawio}
        />
      )}
      {imageContextMenu && (
        <ImageContextMenu
          position={{ x: imageContextMenu.x, y: imageContextMenu.y }}
          onClose={() => setImageContextMenu(null)}
          onOpenProperties={handleImageContextMenuProperties}
          onReplaceImage={handleImageContextMenuReplace}
          onCopyPath={handleImageContextMenuCopyPath}
          onDelete={handleImageContextMenuDelete}
          isDrawio={imageContextMenu.isDrawio}
        />
      )}
    </>
  );
};
