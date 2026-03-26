import React, { useEffect, useState, useRef } from 'react';
import { EditorContent } from '@tiptap/react';
import { useTiptapEditor } from '../hooks/useTiptapEditor';
import { useEditorContext } from '../context/EditorContext';
import { useVSCodeMessaging } from '../hooks/useVSCodeMessaging';
import { Toolbar } from './Toolbar';
import { BubbleMenuBar } from './BubbleMenuBar';
import { DocumentHeader } from './DocumentHeader';
import { TableContextMenu } from './TableContextMenu';
import { TablePropertiesModal } from './TablePropertiesModal';
import { ImageNameDialog } from './ImageNameDialog';
import { DrawioNameDialog } from './DrawioNameDialog';
import { DrawioActionDialog } from './DrawioActionDialog';
import { LinkDialog } from './LinkDialog';
import { ImagePropertiesDialog } from './ImagePropertiesDialog';
import { ImageContextMenu } from './ImageContextMenu';
import { MathDialog } from './MathDialog';
import { EditorContextMenu } from './EditorContextMenu';
import { CrossReferenceDialog } from './CrossReferenceDialog';
import { collectTargets } from '../extensions/CrossReference';
import type { RefTarget } from '../extensions/CrossReference';

export const Editor: React.FC = () => {
  const { state, dispatch } = useEditorContext();
  const [showNumbering, setShowNumbering] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showTableProperties, setShowTableProperties] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showDrawioActionDialog, setShowDrawioActionDialog] = useState(false);
  const [showDrawioDialog, setShowDrawioDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [imageProperties, setImageProperties] = useState<{ pos: number; src: string; alt: string; align: string; isDrawio: boolean } | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number; pos: number; src: string; isDrawio: boolean } | null>(null);
  const [mathDialog, setMathDialog] = useState<{ latex: string; isBlock: boolean; pos: number | null } | null>(null);
  const [meta, setMeta] = useState<{ title: string; author: string; version: string; created: string; modified: string }>({ title: '', author: '', version: '', created: '', modified: '' });
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCrossRefDialog, setShowCrossRefDialog] = useState(false);
  const pendingEditRef = useRef(false);
  const setContentRef = useRef<((content: any) => void) | null>(null);
  const initDoneRef = useRef(false);

  // Apply settings to CSS custom properties and global state
  useEffect(() => {
    const { settings } = state;
    // Expose settings globally for NodeViews (CustomImage, CustomTable)
    (window as any).__editorSettings = settings;

    // Apply CSS custom properties for caption prefixes
    const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement;
    if (proseMirrorEl) {
      proseMirrorEl.style.setProperty('--image-caption-prefix', `'${settings.imageCaptionPrefix}'`);
      proseMirrorEl.style.setProperty('--table-caption-prefix', `'${settings.tableCaptionPrefix}'`);
    }

    // Sync heading numbering toggle with settings
    setShowNumbering(settings.headingNumbering);
  }, [state.settings]);

  const { postMessage } = useVSCodeMessaging((message) => {
    switch (message.type) {
      case 'init':
        if (setContentRef.current) {
          setContentRef.current(message.content);
          if (!initDoneRef.current) {
            initDoneRef.current = true;
            dispatch({ type: 'SET_READY', payload: true });
          }
        } else {
          // editor not ready yet, store for later
          dispatch({ type: 'SET_DOC', payload: message.content });
        }
        break;
      case 'update':
        // Skip echo from our own edit
        if (pendingEditRef.current) {
          pendingEditRef.current = false;
          break;
        }
        // External change — apply it
        if (setContentRef.current) {
          setContentRef.current(message.content);
        }
        break;
      case 'settingsChanged':
        dispatch({ type: 'SET_SETTINGS', payload: message.settings });
        break;
      case 'metaUpdate':
        setMeta(prev => ({ ...prev, ...message.meta }));
        break;
      case 'importContent':
        // Imported JSON content (e.g., from Markdown)
        if (editor) {
          editor.commands.setContent(message.content);
          flushUpdate();
        }
        break;
      case 'importHtml':
        // Imported raw HTML — let Tiptap parse it
        if (editor) {
          editor.commands.setContent(message.html);
          flushUpdate();
        }
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
      case 'drawioFileUpdated':
        // draw.io 확장이 파일을 저장했으므로 해당 이미지 src를 캐시 버스팅 URI로 교체
        if (editor && message.relativePath && message.newWebviewUri) {
          const fileName = (message.relativePath as string).split('/').pop()!;
          editor.chain().command(({ tr }) => {
            tr.doc.descendants((node, pos) => {
              if (node.type.name === 'image' && node.attrs.src) {
                const src: string = node.attrs.src;
                if (src.includes(fileName)) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: message.newWebviewUri });
                }
              }
            });
            return true;
          }).run();
          // flushUpdate 미호출: 파일 경로 변경이 아니라 화면 갱신만 필요
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

  const handleExport = (format: 'html' | 'adoc' | 'markdown') => {
    postMessage({ type: 'export', format });
  };

  const handleImport = (format: 'markdown' | 'html') => {
    postMessage({ type: format === 'markdown' ? 'importMarkdown' : 'importHtml' });
  };

  const handleMetaChange = (field: string, value: string) => {
    setMeta(prev => ({ ...prev, [field]: value }));
    postMessage({ type: 'updateMeta', meta: { [field]: value } });
  };

  const handleToggleNumbering = () => {
    setShowNumbering(!showNumbering);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (editor && editor.isActive('table')) {
      // 테이블 안: 테이블 컨텍스트 메뉴
      setContextMenu({ x: event.clientX, y: event.clientY });
    } else {
      // 일반 편집 영역: 삽입 컨텍스트 메뉴
      setEditorContextMenu({ x: event.clientX, y: event.clientY });
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

  const handleInsertMath = () => {
    setMathDialog({ latex: '', isBlock: false, pos: null });
  };

  const handleMathConfirm = (latex: string, isBlock: boolean) => {
    if (!editor) return;

    if (mathDialog?.pos !== null && mathDialog?.pos !== undefined) {
      // Editing existing math node
      const pos = mathDialog.pos;
      editor.chain().focus().command(({ tr }) => {
        const nodeType = isBlock
          ? editor.schema.nodes.mathBlock
          : editor.schema.nodes.mathInline;
        tr.setNodeMarkup(pos, nodeType, { latex });
        return true;
      }).run();
    } else if (isBlock) {
      (editor.chain().focus() as any).insertMathBlock(latex).run();
    } else {
      (editor.chain().focus() as any).insertMathInline(latex).run();
    }

    setMathDialog(null);
    flushUpdate();
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

  const handleImagePropertiesConfirm = (altText: string, align: string) => {
    if (!editor || !imageProperties) return;

    // Update the image node's alt and align attributes
    editor.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(imageProperties.pos, undefined, {
        ...editor.state.doc.nodeAt(imageProperties.pos)?.attrs,
        alt: altText,
        align,
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
        align: node.attrs.align || 'center',
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
    pendingEditRef,
  });

  // Keep setContentRef in sync so message handler can call setContent
  useEffect(() => {
    if (editor && setContent) {
      setContentRef.current = setContent;
      // If init message arrived before editor was ready, apply stored doc now
      if (state.doc && !initDoneRef.current) {
        setContent(state.doc);
        initDoneRef.current = true;
        dispatch({ type: 'SET_READY', payload: true });
      }
    }
  }, [editor, setContent]);

  // Expose flushUpdate to window for NodeView access
  useEffect(() => {
    if (editor) {
      (window as any).__editorFlushUpdate = flushUpdate;
      (window as any).__showImageProperties = (pos: number, src: string, alt: string) => {
        const isDrawio = src.includes('.drawio.svg') || src.includes('/drawio/');
        setImageProperties({ pos, src, alt, align: 'center', isDrawio });
      };
      (window as any).__showImageContextMenu = (x: number, y: number, pos: number, src: string, alt: string) => {
        handleImageContextMenuOpen(x, y, pos, src, alt);
      };
      (window as any).__showMathDialog = (latex: string, isBlock: boolean, pos: number) => {
        setMathDialog({ latex, isBlock, pos });
      };
    }
    return () => {
      delete (window as any).__editorFlushUpdate;
      delete (window as any).__showImageProperties;
      delete (window as any).__showImageContextMenu;
      delete (window as any).__showMathDialog;
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

  // No longer need useEffect([state.doc]) for content sync — handled directly in message handler

  if (!editor) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        Loading editor...
      </div>
    );
  }

  return (
    <>
      <DocumentHeader
        title={meta.title}
        author={meta.author}
        version={meta.version}
        created={meta.created}
        modified={meta.modified}
        onTitleChange={(value) => handleMetaChange('title', value)}
        onAuthorChange={(value) => handleMetaChange('author', value)}
        onVersionChange={(value) => handleMetaChange('version', value)}
      />
      <Toolbar
        editor={editor}
        onViewJson={handleViewJson}
        showNumbering={showNumbering}
        onToggleNumbering={handleToggleNumbering}
        onInsertLink={handleInsertLink}
        onInsertMath={handleInsertMath}
        onInsertCrossRef={() => setShowCrossRefDialog(true)}
        onInsertImage={handleInsertImage}
        onInsertDrawio={handleInsertDrawio}
        onExport={handleExport}
        onImport={handleImport}
      />
      {editor && <BubbleMenuBar editor={editor} />}
      <div onContextMenu={handleContextMenu}>
        <EditorContent
          editor={editor}
          className={`${showNumbering ? 'show-numbering' : 'hide-numbering'} ${state.settings.captionNumbering === 'hierarchical' ? 'hierarchical-numbering' : 'simple-numbering'}`}
        />
      </div>
      {editorContextMenu && (
        <EditorContextMenu
          position={editorContextMenu}
          onInsertImage={handleInsertImage}
          onInsertDrawio={handleInsertDrawio}
          onInsertEquation={handleInsertMath}
          isLinkActive={editor?.isActive('link') ?? false}
          onRemoveLink={() => editor?.chain().focus().unsetLink().run()}
          onClose={() => setEditorContextMenu(null)}
        />
      )}
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
          align={imageProperties.align}
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
      {mathDialog && (
        <MathDialog
          initialLatex={mathDialog.latex}
          isBlock={mathDialog.isBlock}
          onConfirm={handleMathConfirm}
          onCancel={() => setMathDialog(null)}
        />
      )}
      {showCrossRefDialog && editor && (
        <CrossReferenceDialog
          targets={collectTargets(editor)}
          onSelect={(target: RefTarget) => {
            setShowCrossRefDialog(false);
            editor.chain().focus().insertContent([
              {
                type: 'text',
                marks: [{ type: 'link', attrs: { href: `#${target.id}` } }],
                text: target.label,
              },
              {
                type: 'text',
                text: ' ',
              },
            ]).run();
          }}
          onClose={() => setShowCrossRefDialog(false)}
        />
      )}
    </>
  );
};
