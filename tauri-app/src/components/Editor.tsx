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
import { DrawioInstallGuideDialog } from './DrawioInstallGuideDialog';
import { LinkDialog } from './LinkDialog';
import { ImagePropertiesDialog } from './ImagePropertiesDialog';
import { ImageContextMenu } from './ImageContextMenu';
import { MathDialog } from './MathDialog';
import { DiagramDialog } from './DiagramDialog';
import { EditorContextMenu } from './EditorContextMenu';
import { CrossReferenceDialog } from './CrossReferenceDialog';
import { ActivityBar } from './ActivityBar';
import { SidePanel, type ActivityTab } from './SidePanel';
import { MenuBar, type MenuDef } from './MenuBar';
import { ZoomBar } from './ZoomBar';
import { FolderOpen } from 'lucide-react';
import { collectTargets } from '../extensions/CrossReference';
import { CROSSREF_RESYNC_META } from '../extensions/CrossReference';
import type { RefTarget } from '../extensions/CrossReference';
import { extractRelativePathFromSrc } from '../extensions/CustomImage';
import { preprocessImportedHtml } from '../utils/preprocessImportedHtml';
import type { DocumentSettings, TiptapNode } from '@shared/types';
import type { ExplorerEntry } from '../App';
import type { EditorSettings } from '../context/EditorContext';

/**
 * `setImage`'s TipTap-generated type only knows about `src`/`alt`/`title`. `relativePath` is a
 * custom attribute added by `CustomImage` (see extensions/CustomImage.tsx) to avoid having to
 * reverse-engineer the document-relative path from a (possibly percent-encoded) asset URL.
 */
interface ImageAttrsWithRelativePath {
  src: string;
  alt?: string;
  title?: string;
  relativePath?: string;
}

/**
 * Convert relative image paths (./images/*, ./drawio/*) in a doc tree to asset URLs.
 */
async function convertImagePaths(doc: TiptapNode): Promise<TiptapNode> {
  const cloned: TiptapNode = { ...doc };
  const src = typeof cloned.attrs?.src === 'string' ? cloned.attrs.src : undefined;
  if (cloned.type === 'image' && src?.startsWith('./')) {
    try {
      cloned.attrs = { ...cloned.attrs, src: await resolveAssetUrl(src) };
    } catch { /* keep original */ }
  }
  if (cloned.content && Array.isArray(cloned.content)) {
    cloned.content = await Promise.all(cloned.content.map(convertImagePaths));
  }
  return cloned;
}

interface EditorProps {
  adapter: TauriAdapter;
  initialDoc?: TiptapNode;
  initialMeta?: { title?: string; author?: string; version?: string; created?: string; modified?: string; settings?: Partial<DocumentSettings> } | null;
  currentPath?: string | null;
  workspaceFolder?: string | null;
  workspaceEntries?: ExplorerEntry[];
  onSelectFolder?: () => void;
  onCreateInFolder?: (folder?: string) => void;
  onCreateFolder?: (parent: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  onRefreshWorkspace?: () => void;
  onRenameEntry?: (path: string, newName: string) => void;
  onDeleteEntry?: (entry: ExplorerEntry) => void;
  onUndoDelete?: () => void;
  hasDeletionHistory?: boolean;
  onJsonView?: () => void;
  onNewDocument?: () => void;
  onOpenDocument?: () => void;
  onExit?: () => void;
}

type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

export const Editor: React.FC<EditorProps> = ({
  adapter,
  initialDoc,
  initialMeta,
  currentPath,
  workspaceFolder,
  workspaceEntries = [],
  onSelectFolder,
  onCreateInFolder,
  onCreateFolder,
  onOpenWorkspaceFile,
  onRefreshWorkspace,
  onRenameEntry,
  onDeleteEntry,
  onUndoDelete,
  hasDeletionHistory,
  onJsonView,
  onNewDocument,
  onOpenDocument,
  onExit,
}) => {
  const { state, dispatch } = useEditorContext();
  const [showNumbering, setShowNumbering] = useState(true);
  const [showSidePanel, setShowSidePanel] = useState(true);
  const [sidePanelTab, setSidePanelTab] = useState<ActivityTab>('explorer');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hoveredExplorerPath, setHoveredExplorerPath] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch((error: unknown) => console.warn('Failed to read app version', error));
  }, []);
  const [zoom, setZoom] = useState<number>(() => {
    const saved = localStorage.getItem('sdoc-editor-zoom');
    return saved ? parseInt(saved, 10) : 100;
  });
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showTableProperties, setShowTableProperties] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showDrawioActionDialog, setShowDrawioActionDialog] = useState(false);
  const [showDrawioDialog, setShowDrawioDialog] = useState(false);
  const [showDrawioInstallGuide, setShowDrawioInstallGuide] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [imageProperties, setImageProperties] = useState<{ pos: number; src: string; alt: string; align: string; isDrawio: boolean; path?: string } | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number; pos: number; src: string; isDrawio: boolean } | null>(null);
  const [mathDialog, setMathDialog] = useState<{ latex: string; isBlock: boolean; pos: number | null } | null>(null);
  const [diagramDialog, setDiagramDialog] = useState<{ code: string; language: string; pos: number | null } | null>(null);
  const [meta, setMeta] = useState<{ title: string; author: string; version: string; created: string; modified: string }>(
    {
      title: initialMeta?.title ?? '',
      author: initialMeta?.author ?? '',
      version: initialMeta?.version ?? '',
      created: initialMeta?.created ?? '',
      modified: initialMeta?.modified ?? '',
    }
  );
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCrossRefDialog, setShowCrossRefDialog] = useState(false);
  const pendingEditRef = useRef(false);
  const initDoneRef = useRef(false);
  const postMessageRef = useRef<(msg: Record<string, unknown> & { type: string }) => Promise<void>>(() => Promise.resolve());
  const settings = state.settings;

  const trackSave = useCallback((savePromise: Promise<void>) => {
    setSaveStatus('saving');
    savePromise
      .then(() => {
        setSaveStatus('saved');
        setLastSavedAt(new Date().toLocaleTimeString());
      })
      .catch((error: unknown) => {
        setSaveStatus('error');
        console.error('Failed to save document', error);
      });
  }, []);

  const { editor, setContent, flushUpdate } = useTiptapEditor({
    onUpdate: (content) => {
      setSaveStatus('dirty');
      trackSave(postMessageRef.current({ type: 'edit', content }));
    },
    pendingEditRef,
  });

  useEffect(() => {
    window.__editorSettings = settings;
    const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement;
    if (proseMirrorEl) {
      proseMirrorEl.style.setProperty('--image-caption-prefix', `'${settings.imageCaptionPrefix}'`);
      proseMirrorEl.style.setProperty('--table-caption-prefix', `'${settings.tableCaptionPrefix}'`);
      proseMirrorEl.style.setProperty('--caption-separator', `'${settings.captionSeparator}'`);
      proseMirrorEl.dataset.tableNumberStyle = settings.tableNumberStyle;
      proseMirrorEl.style.setProperty('--heading-h1-color', settings.headingH1Color);
      proseMirrorEl.style.setProperty('--heading-h2-color', settings.headingH2Color);
      proseMirrorEl.style.setProperty('--heading-h3-color', settings.headingH3Color);
    }
    document.documentElement.style.setProperty('--font-weight-h1', '700');
    setShowNumbering(settings.headingNumbering);
  }, [settings]);

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
          const attrs: ImageAttrsWithRelativePath = { src: message.webviewUri as string, alt: (message.imageName as string) || '', relativePath: message.imagePath as string };
          editor.chain().focus().setImage(attrs).run();
          flushUpdate();
        }
        break;
      case 'drawioCreated':
        if (editor && message.webviewUri) {
          const attrs: ImageAttrsWithRelativePath = { src: message.webviewUri as string, alt: (message.fileName as string) || 'diagram', title: (message.fileName as string) || 'diagram', relativePath: message.drawioPath as string };
          editor.chain().focus().setImage(attrs).run();
          flushUpdate();
        }
        break;
      case 'imageInserted':
        if (editor && message.webviewUri) {
          const attrs: ImageAttrsWithRelativePath = { src: message.webviewUri as string, alt: (message.fileName as string) || 'image', relativePath: message.imagePath as string };
          editor.chain().focus().setImage(attrs).run();
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
              tr.setNodeMarkup(message.pos, undefined, { ...node.attrs, src: message.webviewUri, relativePath: message.imagePath });
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
  postMessageRef.current = postMessage;

  const handleViewJson = () => { postMessage({ type: 'viewJson' }); };
  const handleExport = async (format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides') => {
    if (!editor) return;
    const { save: saveDlg } = await import('@tauri-apps/plugin-dialog');
    const { convertJsonToHtml } = await import('@shared/converter/jsonToHtml');
    const { convertJsonToMarkdown } = await import('@shared/converter/jsonToMarkdown');
    const { convertJsonToAdoc } = await import('@shared/converter/jsonToAdoc');
    const { invoke } = await import('@tauri-apps/api/core');

    const doc = editor.getJSON() as TiptapNode;
    const settings = state.settings;
    const exportSettings = {
      imageCaptionPrefix: settings.imageCaptionPrefix,
      tableCaptionPrefix: settings.tableCaptionPrefix,
      equationCaptionPrefix: settings.equationCaptionPrefix,
      captionSeparator: settings.captionSeparator,
      captionNumbering: settings.captionNumbering as 'sequential' | 'hierarchical',
      equationNumbering: settings.equationNumbering as 'sequential' | 'hierarchical',
      tableNumberStyle: settings.tableNumberStyle as 'arabic' | 'roman',
      equationParens: settings.equationParens,
      exportImagePath: settings.exportImagePath as 'relative' | 'absolute',
      pdfScale: state.docSettings?.pdfScale,
      selfContained: state.docSettings?.selfContained,
      outputDir: state.docSettings?.outputDir,
    };
    const currentMeta = { ...meta };

    let content = '';
    let ext = '';
    let filterName = '';
    switch (format) {
      case 'html':
        {
          const appSettings = await invoke<{
            themeCompanyName?: string;
            themePrimaryColor?: string;
            themeAccentColor?: string;
            themeFontFamily?: string;
            themeCustomStyles?: string;
          }>('get_settings');
          let htmlCss = '';
          if (state.docSettings?.htmlCssPath) {
            try {
              const cssPath = await invoke<string>('resolve_document_relative_path', { path: state.docSettings.htmlCssPath });
              htmlCss = await invoke<string>('read_import_file', { path: cssPath });
            } catch (error: unknown) {
              console.warn('Failed to load document HTML CSS', error);
            }
          }
          content = convertJsonToHtml(doc, {
            companyName: appSettings.themeCompanyName,
            primaryColor: appSettings.themePrimaryColor,
            accentColor: appSettings.themeAccentColor,
            fontFamily: appSettings.themeFontFamily,
            customStyles: `${appSettings.themeCustomStyles ?? ''}${htmlCss}`,
          }, exportSettings, currentMeta);
        }
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
      case 'pdf':
      case 'slides':
        alert(`${format.toUpperCase()} 내보내기는 아직 Tauri 앱에서 지원되지 않습니다.`);
        return;
      default:
        return;
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
      trackSave(postMessage({ type: 'updateMeta', meta: { [field]: value }, content: editor.getJSON() }));
    }
  };
  const handleToggleNumbering = () => { setShowNumbering(!showNumbering); };
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
    dispatch({ type: 'SET_DOC_SETTINGS', payload: settings });
    if (settings) {
      dispatch({ type: 'SET_SETTINGS', payload: settings as Partial<EditorSettings> });
    } else {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke<Partial<EditorSettings>>('get_editor_settings')
          .then((editorSettings) => dispatch({ type: 'SET_SETTINGS', payload: editorSettings }))
          .catch((error: unknown) => console.warn('Failed to reload editor settings', error));
      });
    }
    if (editor) {
      trackSave(postMessage({
        type: 'updateMeta',
        meta: { settings },
        content: editor.getJSON(),
      }));
    }
  }, [dispatch, editor, postMessage, trackSave]);
  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (editor && editor.isActive('table')) {
      setContextMenu({ x: event.clientX, y: event.clientY });
    } else {
      setEditorContextMenu({ x: event.clientX, y: event.clientY });
    }
  };
  const handlePaste = useCallback(async (event: ClipboardEvent) => {
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
  }, []);
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
  const handleDrawioNameConfirm = (fileName: string) => {
    postMessage({ type: 'createDrawio', fileName }).catch(() => setShowDrawioInstallGuide(true));
    setShowDrawioDialog(false);
  };
  const handleOpenDrawio = useCallback((drawioPath: string) => {
    postMessageRef.current({ type: 'openDrawio', drawioPath }).catch(() => setShowDrawioInstallGuide(true));
  }, []);
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
      editor.chain().focus().insertDiagram(language, code).run();
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
      editor.chain().focus().insertMathBlock(latex).run();
    } else {
      editor.chain().focus().insertMathInline(latex).run();
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
      const path = node.attrs.relativePath || extractRelativePathFromSrc(imageContextMenu.src) || undefined;
      setImageProperties({ pos: imageContextMenu.pos, src: imageContextMenu.src, alt: node.attrs.alt || '', align: node.attrs.align || 'center', isDrawio: imageContextMenu.isDrawio, path });
    }
    setImageContextMenu(null);
  };
  const handleImageContextMenuReplace = () => {
    if (!imageContextMenu) return;
    postMessage({ type: 'replaceImage', pos: imageContextMenu.pos });
    setImageContextMenu(null);
  };
  const handleImageContextMenuCopyPath = () => {
    if (!imageContextMenu || !editor) return;
    const node = editor.state.doc.nodeAt(imageContextMenu.pos);
    const path = node?.attrs.relativePath || extractRelativePathFromSrc(imageContextMenu.src) || imageContextMenu.src;
    navigator.clipboard.writeText(path).catch((err: unknown) => {
      console.warn('Failed to copy path to clipboard', err);
    });
    setImageContextMenu(null);
  };
  const handleImageContextMenuDelete = () => {
    if (!imageContextMenu || !editor) return;
    editor.chain().focus().command(({ tr }) => { tr.delete(imageContextMenu.pos, imageContextMenu.pos + 1); return true; }).run();
    setImageContextMenu(null);
    flushUpdate();
  };

  // Initialize editor with document
  useEffect(() => {
    if (editor && setContent && initialDoc && !initDoneRef.current) {
      convertImagePaths(initialDoc).then(converted => {
        setContent(converted);
        initDoneRef.current = true;
        dispatch({ type: 'SET_READY', payload: true });
      });
    }
  }, [editor, setContent, initialDoc, dispatch]);

  // Expose global functions for NodeViews
  useEffect(() => {
    if (editor) {
      window.__editorFlushUpdate = flushUpdate;
      window.__showImageProperties = (pos: number, src: string, alt: string) => {
        const isDrawio = src.includes('.drawio.svg') || src.includes('/drawio/');
        setImageProperties({ pos, src, alt, align: 'center', isDrawio });
      };
      window.__showImageContextMenu = (x: number, y: number, pos: number, src: string, alt: string) => {
        handleImageContextMenuOpen(x, y, pos, src, alt);
      };
      window.__showMathDialog = (latex: string, isBlock: boolean, pos: number) => {
        setMathDialog({ latex, isBlock, pos });
      };
      window.__showDiagramDialog = (code: string, language: string, pos: number) => {
        setDiagramDialog({ code, language, pos });
      };
      window.__openDrawio = handleOpenDrawio;
    }
    return () => {
      delete window.__editorFlushUpdate;
      delete window.__showImageProperties;
      delete window.__showImageContextMenu;
      delete window.__showMathDialog;
      delete window.__showDiagramDialog;
      delete window.__openDrawio;
    };
  }, [editor, flushUpdate, handleOpenDrawio]);

  useEffect(() => {
    if (!editor) return;
    const editorElement = editor.view.dom;
    editorElement.addEventListener('paste', handlePaste);
    return () => { editorElement.removeEventListener('paste', handlePaste); };
  }, [editor, handlePaste]);

  // Mouse back/forward button (Button3 = back, Button4 = forward) → cursor history navigation
  useEffect(() => {
    if (!editor) return;
    const scrollCursorIntoView = () => {
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
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
    document.addEventListener('mousedown', handleMouseNav, { capture: true });
    return () => { document.removeEventListener('mousedown', handleMouseNav, { capture: true }); };
  }, [editor]);

  // 메뉴바 File/View 항목에 대응하는 전역 키보드 단축키 (Ctrl+N/O, Ctrl+=/-/0).
  // Ctrl+S/Z/Shift+Z는 각각 useTiptapEditor 훅과 Tiptap History 확장에서 이미 처리하므로 중복 등록하지 않는다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      switch (e.key) {
        case 'n':
          e.preventDefault();
          onNewDocument?.();
          break;
        case 'o':
          e.preventDefault();
          onOpenDocument?.();
          break;
        case '=':
        case '+':
          e.preventDefault();
          handleZoomChange(zoomRef.current + 10);
          break;
        case '-':
          e.preventDefault();
          handleZoomChange(zoomRef.current - 10);
          break;
        case '0':
          e.preventDefault();
          handleZoomChange(100);
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNewDocument, onOpenDocument, handleZoomChange]);

  if (!editor) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading editor...</div>;
  }

  const menuBarMenus: MenuDef[] = [
    {
      label: '파일',
      items: [
        { label: '새 문서', shortcut: 'Ctrl+N', onClick: onNewDocument },
        { label: '문서 열기...', shortcut: 'Ctrl+O', onClick: onOpenDocument },
        { label: '폴더 열기...', onClick: onSelectFolder },
        { separator: true },
        { label: '저장', shortcut: 'Ctrl+S', onClick: () => flushUpdate() },
        { separator: true },
        { label: 'HTML로 내보내기', onClick: () => handleExport('html') },
        { label: 'Markdown으로 내보내기', onClick: () => handleExport('markdown') },
        { label: 'AsciiDoc으로 내보내기', onClick: () => handleExport('adoc') },
        { separator: true },
        { label: 'Markdown 가져오기', onClick: () => handleImport('markdown') },
        { label: 'HTML 가져오기', onClick: () => handleImport('html') },
        { separator: true },
        { label: 'JSON 소스 보기', onClick: handleViewJson },
        { separator: true },
        { label: '종료', onClick: onExit, disabled: !onExit },
      ],
    },
    {
      label: '편집',
      items: [
        { label: '실행 취소', shortcut: 'Ctrl+Z', disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
        { label: '다시 실행', shortcut: 'Ctrl+Y', disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
      ],
    },
    {
      label: '보기',
      items: [
        { label: showSidePanel ? '사이드바 숨기기' : '사이드바 표시', onClick: () => setShowSidePanel(!showSidePanel) },
        { separator: true },
        { label: '확대', shortcut: 'Ctrl++', onClick: () => handleZoomChange(zoom + 10) },
        { label: '축소', shortcut: 'Ctrl+-', onClick: () => handleZoomChange(zoom - 10) },
        { label: '확대/축소 초기화', shortcut: 'Ctrl+0', onClick: () => handleZoomChange(100) },
        { separator: true },
        { label: showNumbering ? '번호 매기기 숨기기' : '번호 매기기 표시', onClick: handleToggleNumbering },
        { label: state.settings.headingDecoration ? '헤딩 장식 숨기기' : '헤딩 장식 표시', onClick: handleToggleDecoration },
      ],
    },
    {
      label: '도움말',
      items: [
        { label: '정보', onClick: () => alert(`Structured Doc Editor\n버전: ${appVersion || '알 수 없음'}`) },
      ],
    },
  ];

  return (
    <div className="editor-shell">
      <MenuBar menus={menuBarMenus} />
      <DocumentHeader
        author={meta.author} version={meta.version} created={meta.created} modified={meta.modified}
        onAuthorChange={(value) => handleMetaChange('author', value)}
        onVersionChange={(value) => handleMetaChange('version', value)}
      />
      <Toolbar
        editor={editor}
        onInsertLink={handleInsertLink} onInsertMath={handleInsertMath}
        onInsertDiagram={handleInsertDiagram}
        onInsertCrossRef={() => setShowCrossRefDialog(true)} onInsertImage={handleInsertImage}
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
            workspaceFolder={workspaceFolder}
            workspaceEntries={workspaceEntries}
            currentPath={currentPath}
            onSelectFolder={onSelectFolder}
            onCreateInFolder={onCreateInFolder}
            onCreateFolder={onCreateFolder}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
            onRefreshWorkspace={onRefreshWorkspace}
            onRenameEntry={onRenameEntry}
            onDeleteEntry={onDeleteEntry}
            onUndoDelete={onUndoDelete}
            hasDeletionHistory={hasDeletionHistory}
            onHoverPath={setHoveredExplorerPath}
          />
        )}
        <div className="editor-content-area" onContextMenu={handleContextMenu}>
          <div className="editor-scroll-area">
            <div style={{ zoom: zoom / 100 }}>
              <div className="editor-title-area">
                <input className="editor-title-input" value={meta.title}
                  onChange={(e) => handleMetaChange('title', e.target.value)} placeholder="문서 제목을 입력하세요" />
              </div>
              <EditorContent editor={editor}
                className={`${showNumbering ? 'show-numbering' : 'hide-numbering'} ${state.settings.headingDecoration ? 'show-heading-decoration' : ''} ${state.settings.captionNumbering === 'hierarchical' ? 'hierarchical-numbering' : 'sequential-numbering'}`}
              />
            </div>
          </div>
          <ZoomBar zoom={zoom} onZoomChange={handleZoomChange} />
          <div className={`save-status save-status-${saveStatus}`}>
            {saveStatus === 'saving' && '저장 중…'}
            {saveStatus === 'dirty' && '변경됨'}
            {saveStatus === 'saved' && (lastSavedAt ? `저장됨 ${lastSavedAt}` : '저장됨')}
            {saveStatus === 'error' && '저장 실패'}
          </div>
        </div>
      </div>
      <div className="app-status-bar" title={hoveredExplorerPath ?? currentPath ?? workspaceFolder ?? undefined}>
        <FolderOpen size={12} className="app-status-bar-icon" />
        <span className="app-status-bar-path">
          {hoveredExplorerPath ?? currentPath ?? workspaceFolder ?? '열린 폴더 없음'}
        </span>
      </div>
      {editorContextMenu && editor && <EditorContextMenu
        position={editorContextMenu}
        editor={editor}
        onInsertImage={handleInsertImage}
        onInsertDrawio={handleInsertDrawio}
        onInsertEquation={handleInsertMath}
        onInsertTable={(rows, cols) => { setEditorContextMenu(null); editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run(); }}
        onInsertLink={handleInsertLink}
        onInsertDiagram={handleInsertDiagram}
        onInsertCrossRef={() => { setEditorContextMenu(null); setShowCrossRefDialog(true); }}
        isLinkActive={editor.isActive('link')}
        onRemoveLink={() => editor.chain().focus().unsetLink().run()}
        onClose={() => setEditorContextMenu(null)}
      />}
      {contextMenu && editor && <TableContextMenu editor={editor} position={contextMenu} onClose={() => setContextMenu(null)} onOpenProperties={() => { setContextMenu(null); setShowTableProperties(true); }} />}
      {showTableProperties && editor && <TablePropertiesModal editor={editor} onClose={() => setShowTableProperties(false)} />}
      {pendingImage && <ImageNameDialog defaultName={`image-${Date.now()}`} onConfirm={handleImageNameConfirm} onCancel={() => setPendingImage(null)} />}
      {showDrawioActionDialog && <DrawioActionDialog onCreateNew={handleDrawioCreateNew} onImportExisting={handleDrawioImportExisting} onCancel={() => setShowDrawioActionDialog(false)} />}
      {showDrawioDialog && <DrawioNameDialog defaultName={`diagram-${Date.now()}`} onConfirm={handleDrawioNameConfirm} onCancel={() => setShowDrawioDialog(false)} />}
      {showDrawioInstallGuide && <DrawioInstallGuideDialog onClose={() => setShowDrawioInstallGuide(false)} />}
      {showLinkDialog && editor && <LinkDialog onConfirm={handleLinkConfirm} onCancel={() => setShowLinkDialog(false)} defaultText={editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')} />}
      {imageProperties && <ImagePropertiesDialog src={imageProperties.src} alt={imageProperties.alt} align={imageProperties.align} onConfirm={handleImagePropertiesConfirm} onReplace={handleImageReplace} onCancel={() => setImageProperties(null)} isDrawio={imageProperties.isDrawio} path={imageProperties.path} />}
      {imageContextMenu && <ImageContextMenu position={{ x: imageContextMenu.x, y: imageContextMenu.y }} onClose={() => setImageContextMenu(null)} onOpenProperties={handleImageContextMenuProperties} onReplaceImage={handleImageContextMenuReplace} onCopyPath={handleImageContextMenuCopyPath} onDelete={handleImageContextMenuDelete} isDrawio={imageContextMenu.isDrawio} />}
      {mathDialog && <MathDialog initialLatex={mathDialog.latex} isBlock={mathDialog.isBlock} onConfirm={handleMathConfirm} onCancel={() => setMathDialog(null)} />}
      {diagramDialog && <DiagramDialog initialCode={diagramDialog.code} initialLanguage={diagramDialog.language} pos={diagramDialog.pos} onConfirm={handleDiagramConfirm} onCancel={() => setDiagramDialog(null)} />}
      {showCrossRefDialog && editor && <CrossReferenceDialog targets={collectTargets(editor)} onSelect={(target: RefTarget) => { setShowCrossRefDialog(false); editor.chain().focus().insertContent([{ type: 'text', marks: [{ type: 'link', attrs: { href: `#${target.id}` } }], text: target.label }, { type: 'text', text: ' ' }]).run(); }} onClose={() => setShowCrossRefDialog(false)} />}
    </div>
  );
};
