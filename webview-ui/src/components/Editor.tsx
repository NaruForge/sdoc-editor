import React, { useEffect, useState, useRef, useCallback } from 'react';
import { EditorContent, type JSONContent } from '@tiptap/react';
import { useTiptapEditor } from '../hooks/useTiptapEditor';
import { useEditorContext } from '../context/EditorContext';
import { useEditorMessages, type MetaState } from '../hooks/useEditorMessages';
import { useDialogState } from '../hooks/useDialogState';
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
import { DiagramDialog } from './DiagramDialog';
import { ActivityBar } from './ActivityBar';
import { SidePanel, type ActivityTab } from './SidePanel';
import { ZoomBar } from './ZoomBar';
import { collectTargets } from '../extensions/CrossReference';
import { CROSSREF_RESYNC_META } from '../extensions/CrossReference';
import type { RefTarget } from '../extensions/CrossReference';
import type { DocumentSettings } from '@shared/types';

export const Editor: React.FC = () => {
  const { state, dispatch } = useEditorContext();
  const [showNumbering, setShowNumbering] = useState(true);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<ActivityTab>('toc');
  const [zoom, setZoom] = useState<number>(() => {
    const saved = localStorage.getItem('sdoc-editor-zoom');
    return saved ? parseInt(saved, 10) : 100;
  });
  const [meta, setMeta] = useState<MetaState>({ title: '', author: '', version: '', created: '', modified: '' });
  const { dialogs, dialogDispatch, openTableContextMenu, openEditorContextMenu } = useDialogState();
  const pendingEditRef = useRef(0);
  const setContentRef = useRef<((content: JSONContent) => void) | null>(null);
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
      proseMirrorEl.style.setProperty('--caption-separator', `'${settings.captionSeparator}'`);
      proseMirrorEl.dataset.tableNumberStyle = settings.tableNumberStyle;
      proseMirrorEl.style.setProperty('--heading-h1-color', settings.headingH1Color);
      proseMirrorEl.style.setProperty('--heading-h2-color', settings.headingH2Color);
      proseMirrorEl.style.setProperty('--heading-h3-color', settings.headingH3Color);
      proseMirrorEl.style.setProperty('--font-weight-body', String(settings.fontWeightBody));
      proseMirrorEl.style.setProperty('--font-weight-bold', String(settings.fontWeightBold));
      proseMirrorEl.style.setProperty('--font-weight-h1', String(settings.fontWeightH1));
      proseMirrorEl.style.setProperty('--font-weight-h2', String(settings.fontWeightH2));
      proseMirrorEl.style.setProperty('--font-weight-h3', String(settings.fontWeightH3));
    }
    // Set font-weight vars on root so editor-title-input (outside ProseMirror) can inherit them
    document.documentElement.style.setProperty('--font-weight-h1', String(settings.fontWeightH1));

    // Sync heading numbering toggle with settings
    setShowNumbering(settings.headingNumbering);
  }, [state.settings]);

  // postMessageRef bridges the circular dependency: useTiptapEditor → postMessage → useEditorMessages
  const postMessageRef = useRef<(msg: Record<string, unknown>) => void>(() => {});

  const { editor, setContent, flushUpdate } = useTiptapEditor({
    onUpdate: (content, saveRequested) => {
      postMessageRef.current({ type: 'edit', content, saveRequested });
    },
    pendingEditRef,
  });

  // Trigger CrossRef label re-sync when caption settings change
  const prevPrefixRef = useRef({ style: '', eqMode: '', capMode: '', includeCaption: false });
  useEffect(() => {
    const { captionStyle, equationNumbering, captionNumbering, crossRefIncludeCaption } = state.settings;
    const prev = prevPrefixRef.current;
    const changed = prev.style !== captionStyle || prev.eqMode !== equationNumbering
      || prev.capMode !== captionNumbering || prev.includeCaption !== crossRefIncludeCaption;
    prevPrefixRef.current = { style: captionStyle, eqMode: equationNumbering, capMode: captionNumbering, includeCaption: crossRefIncludeCaption };
    if (changed && editor) {
      const { tr } = editor.state;
      tr.setMeta(CROSSREF_RESYNC_META, true);
      editor.view.dispatch(tr);
    }
  }, [state.settings, editor]);

  const { postMessage, handleViewJson, handleExport, handleImport, handleMetaChange, isExporting } = useEditorMessages({
    editor,
    flushUpdate,
    setContentRef,
    initDoneRef,
    pendingEditRef,
    setMeta,
  });
  postMessageRef.current = postMessage;

  const handleToggleNumbering = () => {
    setShowNumbering(!showNumbering);
  };

  const handleToggleDecoration = () => {
    dispatch({ type: 'SET_SETTINGS', payload: { headingDecoration: !state.settings.headingDecoration } });
  };

  const handleActivityTabClick = useCallback((tab: ActivityTab) => {
    if (showSidePanel && sidePanelTab === tab) {
      setShowSidePanel(false);
    } else {
      setSidePanelTab(tab);
      setShowSidePanel(true);
    }
  }, [showSidePanel, sidePanelTab]);

  const handleZoomChange = useCallback((value: number) => {
    const clamped = Math.min(200, Math.max(60, value));
    setZoom(clamped);
    localStorage.setItem('sdoc-editor-zoom', String(clamped));
  }, []);

  const handleUpdateDocSettings = useCallback((settings: Partial<DocumentSettings> | null) => {
    postMessage({ type: 'updateDocSettings', settings });
  }, [postMessage]);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (editor && editor.isActive('table')) {
      openTableContextMenu(event.clientX, event.clientY);
    } else {
      openEditorContextMenu(event.clientX, event.clientY);
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
            dialogDispatch({ type: 'SET_PENDING_IMAGE', payload: { blob, dataUrl } });
          };
          reader.readAsDataURL(blob);
        }
        break;
      }
    }
  };

  const handleImageNameConfirm = async (name: string) => {
    if (!dialogs.pendingImage) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      const extension = dialogs.pendingImage!.blob.type.split('/')[1] || 'png';

      postMessage({
        type: 'saveImage',
        imageName: name,
        imageData: base64,
        extension: extension,
      });

      dialogDispatch({ type: 'SET_PENDING_IMAGE', payload: null });
    };
    reader.readAsDataURL(dialogs.pendingImage.blob);
  };

  const handleInsertDrawio = () => {
    dialogDispatch({ type: 'OPEN_DRAWIO_ACTION_DIALOG' });
  };

  const handleDrawioCreateNew = () => {
    dialogDispatch({ type: 'OPEN_DRAWIO_DIALOG' });
  };

  const handleDrawioImportExisting = () => {
    dialogDispatch({ type: 'CLOSE_DRAWIO_ACTION_DIALOG' });
    postMessage({ type: 'importDrawio' });
  };

  const handleDrawioNameConfirm = (fileName: string) => {
    postMessage({ type: 'createDrawio', fileName });
    dialogDispatch({ type: 'CLOSE_DRAWIO_DIALOG' });
  };

  const handleInsertImage = () => {
    // Send message to VS Code to open file picker
    postMessage({
      type: 'insertExistingImage',
    });
  };

  const handleInsertLink = () => {
    dialogDispatch({ type: 'OPEN_LINK_DIALOG' });
  };

  const handleInsertMath = () => {
    dialogDispatch({ type: 'SET_MATH_DIALOG', payload: { latex: '', isBlock: false, pos: null } });
  };

  const handleInsertDiagram = () => {
    dialogDispatch({ type: 'SET_DIAGRAM_DIALOG', payload: { code: '', language: 'mermaid', pos: null } });
  };

  const handleDiagramConfirm = (code: string, language: string, pos: number | null) => {
    if (!editor) return;
    if (pos !== null) {
      editor.chain().focus().command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { language, code });
        return true;
      }).run();
    } else {
      (editor.chain().focus() as any).insertDiagram(language, code).run();
    }
    dialogDispatch({ type: 'SET_DIAGRAM_DIALOG', payload: null });
    flushUpdate();
  };

  const handleMathConfirm = (latex: string, isBlock: boolean) => {
    if (!editor) return;

    if (dialogs.mathDialog?.pos !== null && dialogs.mathDialog?.pos !== undefined) {
      const pos = dialogs.mathDialog.pos;
      const currentNode = editor.state.doc.nodeAt(pos);
      const currentIsBlock = currentNode?.type.name === 'mathBlock';

      if (currentIsBlock === isBlock) {
        // Same type — update attributes only
        editor.chain().focus().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { latex });
          return true;
        }).run();
      } else if (isBlock) {
        // Inline → Block: delete inline, insert block
        editor.chain().focus().command(({ tr }) => {
          const node = tr.doc.nodeAt(pos);
          if (!node) return false;
          const $pos = tr.doc.resolve(pos);
          const mathBlockType = editor.schema.nodes.mathBlock;
          if ($pos.parent.childCount === 1 && $pos.parent.type.name === 'paragraph') {
            // Sole child of paragraph — replace entire paragraph with block
            tr.replaceWith($pos.before($pos.depth), $pos.after($pos.depth), mathBlockType.create({ latex }));
          } else {
            // Has siblings — delete inline, insert block after paragraph
            const parentEnd = $pos.after($pos.depth);
            tr.delete(pos, pos + node.nodeSize);
            tr.insert(tr.mapping.map(parentEnd), mathBlockType.create({ latex }));
          }
          return true;
        }).run();
      } else {
        // Block → Inline: replace block with paragraph containing inline
        editor.chain().focus().command(({ tr }) => {
          const node = tr.doc.nodeAt(pos);
          if (!node) return false;
          const mathInlineType = editor.schema.nodes.mathInline;
          const paragraphType = editor.schema.nodes.paragraph;
          tr.replaceWith(pos, pos + node.nodeSize,
            paragraphType.create(null, mathInlineType.create({ latex }))
          );
          return true;
        }).run();
      }
    } else if (isBlock) {
      (editor.chain().focus() as unknown as Record<string, (l: string) => { run: () => void }>).insertMathBlock(latex).run();
    } else {
      (editor.chain().focus() as unknown as Record<string, (l: string) => { run: () => void }>).insertMathInline(latex).run();
    }

    dialogDispatch({ type: 'SET_MATH_DIALOG', payload: null });
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

    dialogDispatch({ type: 'CLOSE_LINK_DIALOG' });
    flushUpdate();
  };

  const handleImagePropertiesConfirm = (altText: string, align: string) => {
    if (!editor || !dialogs.imageProperties) return;

    editor.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(dialogs.imageProperties!.pos, undefined, {
        ...editor.state.doc.nodeAt(dialogs.imageProperties!.pos)?.attrs,
        alt: altText,
        align,
      });
      return true;
    }).run();

    dialogDispatch({ type: 'SET_IMAGE_PROPERTIES', payload: null });
    flushUpdate();
  };

  const handleImageReplace = () => {
    if (!dialogs.imageProperties) return;

    const pos = dialogs.imageProperties.pos;
    dialogDispatch({ type: 'SET_IMAGE_PROPERTIES', payload: null });

    postMessage({ type: 'replaceImage', pos });
  };

  const handleImageContextMenuOpen = (x: number, y: number, pos: number, src: string, _alt: string) => {
    const isDrawio = src.includes('.drawio.svg') || src.includes('/drawio/');
    dialogDispatch({ type: 'SET_IMAGE_CONTEXT_MENU', payload: { x, y, pos, src, isDrawio } });
  };

  const handleImageContextMenuProperties = () => {
    if (!dialogs.imageContextMenu || !editor) return;

    const node = editor.state.doc.nodeAt(dialogs.imageContextMenu.pos);
    if (node) {
      dialogDispatch({ type: 'SET_IMAGE_PROPERTIES', payload: {
        pos: dialogs.imageContextMenu.pos,
        src: dialogs.imageContextMenu.src,
        alt: node.attrs.alt || '',
        align: node.attrs.align || 'center',
        isDrawio: dialogs.imageContextMenu.isDrawio,
      } });
    }
    dialogDispatch({ type: 'SET_IMAGE_CONTEXT_MENU', payload: null });
  };

  const handleImageContextMenuReplace = () => {
    if (!dialogs.imageContextMenu) return;

    postMessage({ type: 'replaceImage', pos: dialogs.imageContextMenu.pos });
    dialogDispatch({ type: 'SET_IMAGE_CONTEXT_MENU', payload: null });
  };

  const handleImageContextMenuCopyPath = () => {
    if (!dialogs.imageContextMenu) return;

    const match = dialogs.imageContextMenu.src.match(/((?:images|drawio)\/[^?#]+)/);
    const filePath = match ? './' + match[1] : dialogs.imageContextMenu.src;
    navigator.clipboard.writeText(filePath);
    dialogDispatch({ type: 'SET_IMAGE_CONTEXT_MENU', payload: null });
  };

  const handleImageContextMenuDelete = () => {
    if (!dialogs.imageContextMenu || !editor) return;

    editor.chain().focus().command(({ tr }) => {
      tr.delete(dialogs.imageContextMenu!.pos, dialogs.imageContextMenu!.pos + 1);
      return true;
    }).run();

    dialogDispatch({ type: 'SET_IMAGE_CONTEXT_MENU', payload: null });
    flushUpdate();
  };

  // Keep setContentRef in sync so message handler can call setContent
  useEffect(() => {
    if (editor && setContent) {
      setContentRef.current = setContent;
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
        dialogDispatch({ type: 'SET_IMAGE_PROPERTIES', payload: { pos, src, alt, align: 'center', isDrawio } });
      };
      (window as any).__showImageContextMenu = (x: number, y: number, pos: number, src: string, alt: string) => {
        handleImageContextMenuOpen(x, y, pos, src, alt);
      };
      (window as any).__showMathDialog = (latex: string, isBlock: boolean, pos: number) => {
        dialogDispatch({ type: 'SET_MATH_DIALOG', payload: { latex, isBlock, pos } });
      };
      (window as any).__showDiagramDialog = (code: string, language: string, pos: number) => {
        dialogDispatch({ type: 'SET_DIAGRAM_DIALOG', payload: { code, language, pos } });
      };
    }
    return () => {
      delete (window as any).__editorFlushUpdate;
      delete (window as any).__showImageProperties;
      delete (window as any).__showImageContextMenu;
      delete (window as any).__showMathDialog;
      delete (window as any).__showDiagramDialog;
    };
  }, [editor, flushUpdate]);

  // Add paste event listener for clipboard images
  useEffect(() => {
    if (!editor) return;

    const editorElement = editor.view.dom;
    editorElement.addEventListener('paste', handlePaste as unknown as EventListener);

    return () => {
      editorElement.removeEventListener('paste', handlePaste as unknown as EventListener);
    };
  }, [editor]);

  // Mouse back/forward button (Button3 = back, Button4 = forward) → cursor history navigation
  useEffect(() => {
    if (!editor) return;

    const scrollCursorIntoView = () => {
      // Fallback: manually scroll .editor-scroll-area so the cursor is visible.
      // ProseMirror's built-in scrollIntoView may not find the custom scroll container
      // when a CSS zoom wrapper is present.
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const scrollArea = document.querySelector('.editor-scroll-area') as HTMLElement | null;
        if (!scrollArea) return;
        const areaRect = scrollArea.getBoundingClientRect();
        const margin = 80;
        if (rect.bottom > areaRect.bottom - margin) {
          scrollArea.scrollTop += rect.bottom - areaRect.bottom + margin;
        } else if (rect.top < areaRect.top + margin) {
          scrollArea.scrollTop -= areaRect.top - rect.top + margin;
        }
      });
    };

    const handleMouseNav = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.button === 3) {
        editor.commands.navigateBack();
      } else {
        editor.commands.navigateForward();
      }
      scrollCursorIntoView();
    };

    // capture: true — catch before VS Code's own navigation handler
    document.addEventListener('mousedown', handleMouseNav, { capture: true });
    return () => {
      document.removeEventListener('mousedown', handleMouseNav, { capture: true });
    };
  }, [editor]);

  if (!editor) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        Loading editor...
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <DocumentHeader
        author={meta.author}
        version={meta.version}
        created={meta.created}
        modified={meta.modified}
        onAuthorChange={(value) => handleMetaChange('author', value)}
        onVersionChange={(value) => handleMetaChange('version', value)}
      />
      <Toolbar
        editor={editor}
        onInsertLink={handleInsertLink}
        onInsertMath={handleInsertMath}
        onInsertDiagram={handleInsertDiagram}
        onInsertCrossRef={() => dialogDispatch({ type: 'OPEN_CROSSREF_DIALOG' })}
        onInsertImage={handleInsertImage}
        onInsertDrawio={handleInsertDrawio}
      />
      {editor && <BubbleMenuBar editor={editor} />}
      <div className={`editor-body-layout${showSidePanel ? ' editor-body-with-toc' : ''}`}>
        <ActivityBar
          activeTab={showSidePanel ? sidePanelTab : null}
          onTabClick={handleActivityTabClick}
        />
        {showSidePanel && (
          <SidePanel
            activeTab={sidePanelTab}
            editor={editor}
            showNumbering={showNumbering}
            onToggleNumbering={handleToggleNumbering}
            showDecoration={state.settings.headingDecoration}
            onToggleDecoration={handleToggleDecoration}
            onUpdateDocSettings={handleUpdateDocSettings}
            onViewJson={handleViewJson}
            onExport={handleExport}
            onImport={handleImport}
            isExporting={isExporting}
          />
        )}
        <div className="editor-content-area" onContextMenu={handleContextMenu}>
          <div className="editor-scroll-area">
            <div style={{ zoom: zoom / 100 }}>
              <div className="editor-title-area">
                <input
                  className="editor-title-input"
                  value={meta.title}
                  onChange={(e) => handleMetaChange('title', e.target.value)}
                  placeholder="문서 제목을 입력하세요"
                />
              </div>
              <EditorContent
                editor={editor}
                className={`${showNumbering ? 'show-numbering' : 'hide-numbering'} ${state.settings.headingDecoration ? 'show-heading-decoration' : ''} ${state.settings.captionNumbering === 'hierarchical' ? 'hierarchical-numbering' : 'sequential-numbering'}`}
              />
            </div>
          </div>
          <ZoomBar zoom={zoom} onZoomChange={handleZoomChange} />
        </div>
      </div>
      {dialogs.editorContextMenu && editor && (
        <EditorContextMenu
          position={dialogs.editorContextMenu}
          editor={editor}
          onInsertImage={handleInsertImage}
          onInsertDrawio={handleInsertDrawio}
          onInsertEquation={handleInsertMath}
          onInsertTable={(rows, cols) => {
            dialogDispatch({ type: 'CLOSE_EDITOR_CONTEXT_MENU' });
            editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
          }}
          onInsertLink={handleInsertLink}
          onInsertDiagram={handleInsertDiagram}
          onInsertCrossRef={() => { dialogDispatch({ type: 'CLOSE_EDITOR_CONTEXT_MENU' }); dialogDispatch({ type: 'OPEN_CROSSREF_DIALOG' }); }}
          isLinkActive={editor.isActive('link')}
          onRemoveLink={() => editor.chain().focus().unsetLink().run()}
          onClose={() => dialogDispatch({ type: 'CLOSE_EDITOR_CONTEXT_MENU' })}
        />
      )}
      {dialogs.contextMenu && editor && (
        <TableContextMenu
          editor={editor}
          position={dialogs.contextMenu}
          onClose={() => dialogDispatch({ type: 'CLOSE_TABLE_CONTEXT_MENU' })}
          onOpenProperties={() => {
            dialogDispatch({ type: 'CLOSE_TABLE_CONTEXT_MENU' });
            dialogDispatch({ type: 'OPEN_TABLE_PROPERTIES' });
          }}
        />
      )}
      {dialogs.showTableProperties && editor && (
        <TablePropertiesModal
          editor={editor}
          onClose={() => dialogDispatch({ type: 'CLOSE_TABLE_PROPERTIES' })}
        />
      )}
      {dialogs.pendingImage && (
        <ImageNameDialog
          defaultName={`image-${Date.now()}`}
          onConfirm={handleImageNameConfirm}
          onCancel={() => dialogDispatch({ type: 'SET_PENDING_IMAGE', payload: null })}
        />
      )}
      {dialogs.showDrawioActionDialog && (
        <DrawioActionDialog
          onCreateNew={handleDrawioCreateNew}
          onImportExisting={handleDrawioImportExisting}
          onCancel={() => dialogDispatch({ type: 'CLOSE_DRAWIO_ACTION_DIALOG' })}
        />
      )}
      {dialogs.showDrawioDialog && (
        <DrawioNameDialog
          defaultName={`diagram-${Date.now()}`}
          onConfirm={handleDrawioNameConfirm}
          onCancel={() => dialogDispatch({ type: 'CLOSE_DRAWIO_DIALOG' })}
        />
      )}
      {dialogs.showLinkDialog && editor && (
        <LinkDialog
          onConfirm={(url, text) => handleLinkConfirm(url, text)}
          onCancel={() => dialogDispatch({ type: 'CLOSE_LINK_DIALOG' })}
          defaultText={editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            ' '
          )}
        />
      )}
      {dialogs.imageProperties && (
        <ImagePropertiesDialog
          src={dialogs.imageProperties.src}
          alt={dialogs.imageProperties.alt}
          align={dialogs.imageProperties.align}
          onConfirm={handleImagePropertiesConfirm}
          onReplace={handleImageReplace}
          onCancel={() => dialogDispatch({ type: 'SET_IMAGE_PROPERTIES', payload: null })}
          isDrawio={dialogs.imageProperties.isDrawio}
        />
      )}
      {dialogs.imageContextMenu && (
        <ImageContextMenu
          position={{ x: dialogs.imageContextMenu.x, y: dialogs.imageContextMenu.y }}
          onClose={() => dialogDispatch({ type: 'SET_IMAGE_CONTEXT_MENU', payload: null })}
          onOpenProperties={handleImageContextMenuProperties}
          onReplaceImage={handleImageContextMenuReplace}
          onCopyPath={handleImageContextMenuCopyPath}
          onDelete={handleImageContextMenuDelete}
          isDrawio={dialogs.imageContextMenu.isDrawio}
        />
      )}
      {dialogs.mathDialog && (
        <MathDialog
          initialLatex={dialogs.mathDialog.latex}
          isBlock={dialogs.mathDialog.isBlock}
          onConfirm={handleMathConfirm}
          onCancel={() => dialogDispatch({ type: 'SET_MATH_DIALOG', payload: null })}
        />
      )}
      {dialogs.diagramDialog && (
        <DiagramDialog
          initialCode={dialogs.diagramDialog.code}
          initialLanguage={dialogs.diagramDialog.language}
          pos={dialogs.diagramDialog.pos}
          onConfirm={handleDiagramConfirm}
          onCancel={() => dialogDispatch({ type: 'SET_DIAGRAM_DIALOG', payload: null })}
        />
      )}
      {dialogs.showCrossRefDialog && editor && (
        <CrossReferenceDialog
          targets={collectTargets(editor)}
          onSelect={(target: RefTarget) => {
            dialogDispatch({ type: 'CLOSE_CROSSREF_DIALOG' });
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
          onClose={() => dialogDispatch({ type: 'CLOSE_CROSSREF_DIALOG' })}
        />
      )}
    </div>
  );
};
