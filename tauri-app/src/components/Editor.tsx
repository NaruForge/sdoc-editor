import React, { useEffect, useState, useRef, useCallback } from 'react';
import { EditorContent } from '@tiptap/react';
import { useTiptapEditor } from '../hooks/useTiptapEditor';
import { useEditorContext } from '../context/EditorContext';
import { useTauriMessaging } from '../hooks/useTauriMessaging';
import { type TauriAdapter, resolveAssetUrl } from '../adapters/tauriMessaging';
import { convertMarkdownToJson } from '@shared/converter/markdownToJson';
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
import { DiagramDialog } from './DiagramDialog';
import { EditorContextMenu } from './EditorContextMenu';
import { CrossReferenceDialog } from './CrossReferenceDialog';
import { SidePanel } from './SidePanel';
import { collectTargets } from '../extensions/CrossReference';
import { CROSSREF_RESYNC_META } from '../extensions/CrossReference';
import type { RefTarget } from '../extensions/CrossReference';
import { preprocessImportedHtml } from '../utils/preprocessImportedHtml';
import type { DocumentSettings } from '@shared/types';

/**
 * Convert relative image paths (./images/*, ./drawio/*) in a doc tree to asset URLs.
 */
async function convertImagePaths(doc: any): Promise<any> {
  if (!doc || typeof doc !== 'object') return doc;
  const cloned = Array.isArray(doc) ? [...doc] : { ...doc };
  if (cloned.type === 'image' && cloned.attrs?.src && cloned.attrs.src.startsWith('./')) {
    try {
      cloned.attrs = { ...cloned.attrs, src: await resolveAssetUrl(cloned.attrs.src) };
    } catch { /* keep original */ }
  }
  if (cloned.content && Array.isArray(cloned.content)) {
    cloned.content = await Promise.all(cloned.content.map((c: any) => convertImagePaths(c)));
  }
  return cloned;
}

interface EditorProps {
  adapter: TauriAdapter;
  initialDoc?: any;
  initialMeta?: any;
  onJsonView?: () => void;
}

export const Editor: React.FC<EditorProps> = ({ adapter, initialDoc, initialMeta, onJsonView }) => {
  const { state, dispatch } = useEditorContext();
  const [showNumbering, setShowNumbering] = useState(true);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<'toc' | 'settings'>('toc');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showTableProperties, setShowTableProperties] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showDrawioActionDialog, setShowDrawioActionDialog] = useState(false);
  const [showDrawioDialog, setShowDrawioDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [imageProperties, setImageProperties] = useState<{ pos: number; src: string; alt: string; align: string; isDrawio: boolean } | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number; pos: number; src: string; isDrawio: boolean } | null>(null);
  const [mathDialog, setMathDialog] = useState<{ latex: string; isBlock: boolean; pos: number | null } | null>(null);
  const [diagramDialog, setDiagramDialog] = useState<{ code: string; language: string; pos: number | null } | null>(null);
  const [meta, setMeta] = useState<{ title: string; author: string; version: string; created: string; modified: string }>(
    initialMeta || { title: '', author: '', version: '', created: '', modified: '' }
  );
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCrossRefDialog, setShowCrossRefDialog] = useState(false);
  const pendingEditRef = useRef(false);
  const setContentRef = useRef<((content: any) => void) | null>(null);
  const initDoneRef = useRef(false);

  useEffect(() => {
    const { settings } = state;
    (window as any).__editorSettings = settings;
    const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement;
    if (proseMirrorEl) {
      proseMirrorEl.style.setProperty('--image-caption-prefix', `'${settings.imageCaptionPrefix}'`);
      proseMirrorEl.style.setProperty('--table-caption-prefix', `'${settings.tableCaptionPrefix}'`);
      proseMirrorEl.style.setProperty('--heading-h1-color', settings.headingH1Color);
      proseMirrorEl.style.setProperty('--heading-h2-color', settings.headingH2Color);
      proseMirrorEl.style.setProperty('--heading-h3-color', settings.headingH3Color);
    }
    setShowNumbering(settings.headingNumbering);
  }, [state.settings]);

  // Trigger CrossRef label re-sync when caption prefix or numbering settings change
  const prevPrefixRef = useRef({ img: '', tbl: '', eqMode: '', capMode: '' });
  useEffect(() => {
    const { imageCaptionPrefix, tableCaptionPrefix, equationNumbering, captionNumbering } = state.settings;
    const prev = prevPrefixRef.current;
    const changed = prev.img !== imageCaptionPrefix || prev.tbl !== tableCaptionPrefix
      || prev.eqMode !== equationNumbering || prev.capMode !== captionNumbering;
    prevPrefixRef.current = { img: imageCaptionPrefix, tbl: tableCaptionPrefix, eqMode: equationNumbering, capMode: captionNumbering };
    if (changed && editor) {
      const { tr } = editor.state;
      tr.setMeta(CROSSREF_RESYNC_META, true);
      editor.view.dispatch(tr);
    }
  }, [state.settings, editor]);

  const { postMessage } = useTauriMessaging(adapter, (message) => {
    switch (message.type) {
      case 'settingsChanged':
        dispatch({ type: 'SET_SETTINGS', payload: message.settings });
        break;
      case 'importMarkdownText':
        if (editor) {
          const converted = convertMarkdownToJson(message.text);
          editor.commands.setContent(converted);
          flushUpdate();
        }
        break;
      case 'importHtml':
        if (editor) {
          const cleaned = preprocessImportedHtml(message.html);
          editor.commands.setContent(cleaned);
          flushUpdate();
        }
        break;
      case 'imageSaved':
        if (editor && message.webviewUri) {
          editor.chain().focus().setImage({ src: message.webviewUri, alt: message.imageName || '' }).run();
          flushUpdate();
        }
        break;
      case 'drawioCreated':
        if (editor && message.webviewUri) {
          editor.chain().focus().setImage({ src: message.webviewUri, alt: message.fileName || 'diagram', title: message.fileName || 'diagram' }).run();
          flushUpdate();
        }
        break;
      case 'imageInserted':
        if (editor && message.webviewUri) {
          editor.chain().focus().setImage({ src: message.webviewUri, alt: message.fileName || 'image' }).run();
          flushUpdate();
        }
        break;
      case 'drawioFileUpdated':
        if (editor && message.relativePath) {
          const fileName = (message.relativePath as string).split('/').pop()!;
          const timestamp = message.timestamp || Date.now();
          resolveAssetUrl(message.relativePath).then(assetUrl => {
            const newUrl = `${assetUrl}?t=${timestamp}`;
            editor.chain().command(({ tr }) => {
              tr.doc.descendants((node, pos) => {
                if (node.type.name === 'image' && node.attrs.src?.includes(fileName)) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newUrl });
                }
              });
              return true;
            }).run();
          });
        }
        break;
      case 'imageReplaced':
        if (editor && message.webviewUri && typeof message.pos === 'number') {
          editor.chain().focus().command(({ tr }) => {
            const node = tr.doc.nodeAt(message.pos);
            if (node && node.type.name === 'image') {
              tr.setNodeMarkup(message.pos, undefined, { ...node.attrs, src: message.webviewUri });
            }
            return true;
          }).run();
          flushUpdate();
        }
        break;
      case 'showJsonViewer':
        onJsonView?.();
        break;
    }
  });

  const handleViewJson = () => { postMessage({ type: 'viewJson' }); };
  const handleExport = async (format: 'html' | 'adoc' | 'markdown' | 'pdf') => {
    if (!editor) return;
    const { save: saveDlg } = await import('@tauri-apps/plugin-dialog');
    const { convertJsonToHtml } = await import('@shared/converter/jsonToHtml');
    const { convertJsonToMarkdown } = await import('@shared/converter/jsonToMarkdown');
    const { convertJsonToAdoc } = await import('@shared/converter/jsonToAdoc');
    const { invoke } = await import('@tauri-apps/api/core');

    const doc = editor.getJSON() as any;
    const settings = state.settings;
    const exportSettings = {
      imageCaptionPrefix: settings.imageCaptionPrefix,
      tableCaptionPrefix: settings.tableCaptionPrefix,
      captionNumbering: settings.captionNumbering as 'simple' | 'hierarchical',
      exportImagePath: settings.exportImagePath as 'relative' | 'absolute',
    };
    const currentMeta = { ...meta };

    let content: string;
    let ext: string;
    let filterName: string;
    switch (format) {
      case 'html':
        content = convertJsonToHtml(doc, {
          companyName: (await invoke('get_settings') as any).themeCompanyName,
          primaryColor: (await invoke('get_settings') as any).themePrimaryColor,
          accentColor: (await invoke('get_settings') as any).themeAccentColor,
          fontFamily: (await invoke('get_settings') as any).themeFontFamily,
          customStyles: (await invoke('get_settings') as any).themeCustomStyles,
        }, exportSettings, currentMeta);
        ext = 'html';
        filterName = 'HTML';
        break;
      case 'markdown':
        content = convertJsonToMarkdown(doc, exportSettings, currentMeta);
        ext = 'md';
        filterName = 'Markdown';
        break;
      case 'adoc':
        content = convertJsonToAdoc(doc, exportSettings, currentMeta);
        ext = 'adoc';
        filterName = 'AsciiDoc';
        break;
    }

    const path = await saveDlg({
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (path) {
      await invoke('write_export_file', { path, content });
    }
  };
  const handleImport = (format: 'markdown' | 'html') => {
    postMessage({ type: format === 'markdown' ? 'importMarkdown' : 'importHtml' });
  };
  const handleMetaChange = (field: string, value: string) => {
    setMeta(prev => ({ ...prev, [field]: value }));
    if (editor) {
      postMessage({ type: 'updateMeta', meta: { [field]: value }, content: editor.getJSON() });
    }
  };
  const handleToggleNumbering = () => { setShowNumbering(!showNumbering); };
  const handleToggleDecoration = () => {
    dispatch({ type: 'SET_SETTINGS', payload: { headingDecoration: !state.settings.headingDecoration } });
  };

  const handleToggleToc = useCallback(() => {
    if (showSidePanel && sidePanelTab === 'toc') {
      setShowSidePanel(false);
    } else {
      setSidePanelTab('toc');
      setShowSidePanel(true);
    }
  }, [showSidePanel, sidePanelTab]);

  const handleToggleSettings = useCallback(() => {
    if (showSidePanel && sidePanelTab === 'settings') {
      setShowSidePanel(false);
    } else {
      setSidePanelTab('settings');
      setShowSidePanel(true);
    }
  }, [showSidePanel, sidePanelTab]);

  const handleUpdateDocSettings = useCallback((_settings: Partial<DocumentSettings> | null) => {
    // Tauri: doc settings would be saved via invoke — for now, update local state
    dispatch({ type: 'SET_DOC_SETTINGS', payload: _settings });
  }, [dispatch]);
  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (editor && editor.isActive('table')) {
      setContextMenu({ x: event.clientX, y: event.clientY });
    } else {
      setEditorContextMenu({ x: event.clientX, y: event.clientY });
    }
  };
  const handlePaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
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
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      const extension = pendingImage.blob.type.split('/')[1] || 'png';
      postMessage({ type: 'saveImage', imageName: name, imageData: base64, extension });
      setPendingImage(null);
    };
    reader.readAsDataURL(pendingImage.blob);
  };
  const handleInsertDrawio = () => { setShowDrawioActionDialog(true); };
  const handleDrawioCreateNew = () => { setShowDrawioActionDialog(false); setShowDrawioDialog(true); };
  const handleDrawioImportExisting = () => { setShowDrawioActionDialog(false); postMessage({ type: 'importDrawio' }); };
  const handleDrawioNameConfirm = (fileName: string) => { postMessage({ type: 'createDrawio', fileName }); setShowDrawioDialog(false); };
  const handleInsertImage = () => { postMessage({ type: 'insertExistingImage' }); };
  const handleInsertLink = () => { setShowLinkDialog(true); };
  const handleInsertMath = () => { setMathDialog({ latex: '', isBlock: false, pos: null }); };
  const handleInsertDiagram = () => { setDiagramDialog({ code: '', language: 'mermaid', pos: null }); };
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
    setDiagramDialog(null);
    flushUpdate();
  };
  const handleMathConfirm = (latex: string, isBlock: boolean) => {
    if (!editor) return;
    if (mathDialog?.pos !== null && mathDialog?.pos !== undefined) {
      const pos = mathDialog.pos;
      const currentNode = editor.state.doc.nodeAt(pos);
      const currentIsBlock = currentNode?.type.name === 'mathBlock';

      if (currentIsBlock === isBlock) {
        editor.chain().focus().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { latex });
          return true;
        }).run();
      } else if (isBlock) {
        editor.chain().focus().command(({ tr }) => {
          const node = tr.doc.nodeAt(pos);
          if (!node) return false;
          const $pos = tr.doc.resolve(pos);
          const mathBlockType = editor.schema.nodes.mathBlock;
          if ($pos.parent.childCount === 1 && $pos.parent.type.name === 'paragraph') {
            tr.replaceWith($pos.before($pos.depth), $pos.after($pos.depth), mathBlockType.create({ latex }));
          } else {
            const parentEnd = $pos.after($pos.depth);
            tr.delete(pos, pos + node.nodeSize);
            tr.insert(tr.mapping.map(parentEnd), mathBlockType.create({ latex }));
          }
          return true;
        }).run();
      } else {
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
      (editor.chain().focus() as any).insertMathBlock(latex).run();
    } else {
      (editor.chain().focus() as any).insertMathInline(latex).run();
    }
    setMathDialog(null);
    flushUpdate();
  };
  const handleLinkConfirm = (url: string, text: string) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      editor.chain().focus().deleteSelection().insertContent({ type: 'text', marks: [{ type: 'link', attrs: { href: url } }], text }).run();
    } else {
      editor.chain().focus().insertContent({ type: 'text', marks: [{ type: 'link', attrs: { href: url } }], text }).run();
    }
    setShowLinkDialog(false);
    flushUpdate();
  };
  const handleImagePropertiesConfirm = (altText: string, align: string) => {
    if (!editor || !imageProperties) return;
    editor.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(imageProperties.pos, undefined, { ...editor.state.doc.nodeAt(imageProperties.pos)?.attrs, alt: altText, align });
      return true;
    }).run();
    setImageProperties(null);
    flushUpdate();
  };
  const handleImageReplace = () => {
    if (!imageProperties) return;
    setImageProperties(null);
    postMessage({ type: 'replaceImage', pos: imageProperties.pos });
  };
  const handleImageContextMenuOpen = (x: number, y: number, pos: number, src: string, _alt: string) => {
    const isDrawio = src.includes('.drawio.svg') || src.includes('/drawio/');
    setImageContextMenu({ x, y, pos, src, isDrawio });
  };
  const handleImageContextMenuProperties = () => {
    if (!imageContextMenu || !editor) return;
    const node = editor.state.doc.nodeAt(imageContextMenu.pos);
    if (node) {
      setImageProperties({ pos: imageContextMenu.pos, src: imageContextMenu.src, alt: node.attrs.alt || '', align: node.attrs.align || 'center', isDrawio: imageContextMenu.isDrawio });
    }
    setImageContextMenu(null);
  };
  const handleImageContextMenuReplace = () => {
    if (!imageContextMenu) return;
    postMessage({ type: 'replaceImage', pos: imageContextMenu.pos });
    setImageContextMenu(null);
  };
  const handleImageContextMenuCopyPath = () => {
    if (!imageContextMenu) return;
    const match = imageContextMenu.src.match(/((?:images|drawio)\/[^?#]+)/);
    const path = match ? './' + match[1] : imageContextMenu.src;
    navigator.clipboard.writeText(path).then(() => console.log('Path copied:', path));
    setImageContextMenu(null);
  };
  const handleImageContextMenuDelete = () => {
    if (!imageContextMenu || !editor) return;
    editor.chain().focus().command(({ tr }) => { tr.delete(imageContextMenu.pos, imageContextMenu.pos + 1); return true; }).run();
    setImageContextMenu(null);
    flushUpdate();
  };

  const { editor, setContent, flushUpdate } = useTiptapEditor({
    onUpdate: (content) => { postMessage({ type: 'edit', content }); },
    pendingEditRef,
  });

  // Initialize editor with document
  useEffect(() => {
    if (editor && setContent && initialDoc && !initDoneRef.current) {
      convertImagePaths(initialDoc).then(converted => {
        setContent(converted);
        setContentRef.current = setContent;
        initDoneRef.current = true;
        dispatch({ type: 'SET_READY', payload: true });
      });
    }
  }, [editor, setContent, initialDoc]);

  // Expose global functions for NodeViews
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
      (window as any).__showDiagramDialog = (code: string, language: string, pos: number) => {
        setDiagramDialog({ code, language, pos });
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

  useEffect(() => {
    if (!editor) return;
    const editorElement = editor.view.dom;
    editorElement.addEventListener('paste', handlePaste as any);
    return () => { editorElement.removeEventListener('paste', handlePaste as any); };
  }, [editor]);

  if (!editor) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading editor...</div>;
  }

  return (
    <>
      <DocumentHeader
        author={meta.author} version={meta.version} created={meta.created} modified={meta.modified}
        onAuthorChange={(value) => handleMetaChange('author', value)}
        onVersionChange={(value) => handleMetaChange('version', value)}
      />
      <Toolbar
        editor={editor} onViewJson={handleViewJson} showNumbering={showNumbering} onToggleNumbering={handleToggleNumbering}
        showDecoration={state.settings.headingDecoration} onToggleDecoration={handleToggleDecoration}
        showToc={showSidePanel && sidePanelTab === 'toc'} onToggleToc={handleToggleToc}
        showSettings={showSidePanel && sidePanelTab === 'settings'} onToggleSettings={handleToggleSettings}
        onInsertLink={handleInsertLink} onInsertMath={handleInsertMath}
        onInsertDiagram={handleInsertDiagram}
        onInsertCrossRef={() => setShowCrossRefDialog(true)} onInsertImage={handleInsertImage}
        onInsertDrawio={handleInsertDrawio} onExport={handleExport} onImport={handleImport}
      />
      {editor && <BubbleMenuBar editor={editor} />}
      <div className={`editor-body-layout${showSidePanel ? ' editor-body-with-toc' : ''}`}>
        {showSidePanel && (
          <SidePanel
            activeTab={sidePanelTab}
            onTabChange={(tab) => setSidePanelTab(tab)}
            editor={editor}
            showNumbering={showNumbering}
            onUpdateDocSettings={handleUpdateDocSettings}
          />
        )}
        <div className="editor-content-area" onContextMenu={handleContextMenu}>
          <div className="editor-title-area">
            <input className="editor-title-input" value={meta.title}
              onChange={(e) => handleMetaChange('title', e.target.value)} placeholder="문서 제목을 입력하세요" />
          </div>
          <EditorContent editor={editor}
            className={`${showNumbering ? 'show-numbering' : 'hide-numbering'} ${state.settings.headingDecoration ? 'show-heading-decoration' : ''} ${state.settings.captionNumbering === 'hierarchical' ? 'hierarchical-numbering' : 'simple-numbering'}`}
          />
        </div>
      </div>
      {editorContextMenu && <EditorContextMenu position={editorContextMenu} onInsertImage={handleInsertImage} onInsertDrawio={handleInsertDrawio} onInsertEquation={handleInsertMath} isLinkActive={editor?.isActive('link') ?? false} onRemoveLink={() => editor?.chain().focus().unsetLink().run()} onClose={() => setEditorContextMenu(null)} />}
      {contextMenu && editor && <TableContextMenu editor={editor} position={contextMenu} onClose={() => setContextMenu(null)} onOpenProperties={() => { setContextMenu(null); setShowTableProperties(true); }} />}
      {showTableProperties && editor && <TablePropertiesModal editor={editor} onClose={() => setShowTableProperties(false)} />}
      {pendingImage && <ImageNameDialog defaultName={`image-${Date.now()}`} onConfirm={handleImageNameConfirm} onCancel={() => setPendingImage(null)} />}
      {showDrawioActionDialog && <DrawioActionDialog onCreateNew={handleDrawioCreateNew} onImportExisting={handleDrawioImportExisting} onCancel={() => setShowDrawioActionDialog(false)} />}
      {showDrawioDialog && <DrawioNameDialog defaultName={`diagram-${Date.now()}`} onConfirm={handleDrawioNameConfirm} onCancel={() => setShowDrawioDialog(false)} />}
      {showLinkDialog && editor && <LinkDialog onConfirm={handleLinkConfirm} onCancel={() => setShowLinkDialog(false)} defaultText={editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')} />}
      {imageProperties && <ImagePropertiesDialog src={imageProperties.src} alt={imageProperties.alt} align={imageProperties.align} onConfirm={handleImagePropertiesConfirm} onReplace={handleImageReplace} onCancel={() => setImageProperties(null)} isDrawio={imageProperties.isDrawio} />}
      {imageContextMenu && <ImageContextMenu position={{ x: imageContextMenu.x, y: imageContextMenu.y }} onClose={() => setImageContextMenu(null)} onOpenProperties={handleImageContextMenuProperties} onReplaceImage={handleImageContextMenuReplace} onCopyPath={handleImageContextMenuCopyPath} onDelete={handleImageContextMenuDelete} isDrawio={imageContextMenu.isDrawio} />}
      {mathDialog && <MathDialog initialLatex={mathDialog.latex} isBlock={mathDialog.isBlock} onConfirm={handleMathConfirm} onCancel={() => setMathDialog(null)} />}
      {diagramDialog && <DiagramDialog initialCode={diagramDialog.code} initialLanguage={diagramDialog.language} pos={diagramDialog.pos} onConfirm={handleDiagramConfirm} onCancel={() => setDiagramDialog(null)} />}
      {showCrossRefDialog && editor && <CrossReferenceDialog targets={collectTargets(editor)} onSelect={(target: RefTarget) => { setShowCrossRefDialog(false); editor.chain().focus().insertContent([{ type: 'text', marks: [{ type: 'link', attrs: { href: `#${target.id}` } }], text: target.label }, { type: 'text', text: ' ' }]).run(); }} onClose={() => setShowCrossRefDialog(false)} />}
    </>
  );
};
