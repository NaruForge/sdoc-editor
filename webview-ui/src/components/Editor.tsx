import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useEditorDomEvents } from '@shared/editor/hooks/useEditorDomEvents';
import { EditorContent, type JSONContent } from '@tiptap/react';
import { useTiptapEditor } from '@shared/editor/hooks/useTiptapEditor';
import { useEditorContext } from '@shared/editor/context/EditorContext';
import { useEditorMessages, type MetaState } from '../hooks/useEditorMessages';
import { useDialogState } from '@shared/editor/hooks/useDialogState';
import { applyEditorSettingsCss } from '@shared/editor/applyEditorSettingsCss';
import { Toolbar } from '@shared/editor/components/Toolbar';
import { BubbleMenuBar } from '@shared/editor/components/BubbleMenuBar';
import { DocumentHeader } from '@shared/editor/components/DocumentHeader';
import { TablePropertiesModal } from '@shared/editor/components/TablePropertiesModal';
import { ImageNameDialog } from '@shared/editor/components/ImageNameDialog';
import { DrawioNameDialog } from '@shared/editor/components/DrawioNameDialog';
import { DrawioActionDialog } from '@shared/editor/components/DrawioActionDialog';
import { LinkDialog } from '@shared/editor/components/LinkDialog';
import { ImagePropertiesDialog } from '@shared/editor/components/ImagePropertiesDialog';
import { ImageContextMenu } from '@shared/editor/components/ImageContextMenu';
import { MathDialog } from '@shared/editor/components/MathDialog';
import { CrossReferenceDialog } from '@shared/editor/components/CrossReferenceDialog';
import { DiagramDialog } from '@shared/editor/components/DiagramDialog';
import { ModalDialog } from '@shared/editor/components/ModalDialog';
import { InvalidDocumentNotice } from '@shared/editor/components/InvalidDocumentNotice';
import { DocumentStartCard } from '@shared/editor/components/DocumentStartCard';
import { ActivityBar } from '@shared/editor/components/ActivityBar';
import {
  createActivitySessionState,
  selectSidePanel,
  transitionActivityDestination,
  type ActivityDestination,
  type SidePanelSelection,
} from '@shared/editor/activityState';
import { SidePanel } from './SidePanel';
import { ZoomBar } from '@shared/editor/components/ZoomBar';
import { collectTargets, CROSSREF_RESYNC_META } from '@shared/editor/extensions/CrossReference';
import type { RefTarget } from '@shared/editor/extensions/CrossReference';
import type { DocumentSettings, TiptapNode } from '@shared/types';
import type { EditorToHostMessage } from '@shared/types/messages';
import {
  type DocumentMutation,
  DocumentSyncCoordinator,
} from '@shared/persistence/DocumentSyncCoordinator';
import type { EditorReplacementReason } from '@shared/editor/documentReplacement';
import {
  ExternalChangePrompt,
  ExternalChangeComparison,
  buildExternalChangeComparison,
  buildExternalMutationDiff,
} from '@shared/editor/externalChanges';
import { useEditorI18n } from '@shared/editor/i18n';
import type { EditorExtensionRuntime } from '@shared/editor/extensionRuntime';
import type { HostDiagramRenderer } from '@shared/editor/diagram';
import {
  applyLinkEdit,
  captureLinkSelection,
  copyCapturedLink,
  openCapturedLink,
  removeCapturedLink,
  restoreCapturedLinkSelection,
  type CapturedLinkSelection,
} from '@shared/editor/linkEditing';
import { resolveStructurePosition } from '@shared/editor/structureIndex';
import { toSettingsSyncState } from '@shared/editor/designSettings';
import {
  parseStoredReadingWidth,
  READING_WIDTH_STORAGE_KEY,
  type ReadingWidthId,
} from '@shared/editor/readingWidth';
import { collectEditorStyleProbe, hasAppliedEditorStyles } from '../styleReadiness';
import { EndnoteList } from '@shared/editor/components/EndnoteList';
import { insertEndnoteAndFocus } from '@shared/editor/extensions/Endnote';

function isBlankEditorDocument(doc: JSONContent): boolean {
  const content = doc.content ?? [];
  if (content.length === 0) return true;
  return content.every((node) => {
    if (node.type !== 'paragraph') return false;
    const text = (node.content ?? []).map((child) => child.text ?? '').join('');
    return text.trim().length === 0;
  });
}

export function parseStoredZoom(value: string | null): number {
  if (!value) return 100;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(200, Math.max(60, parsed));
}

export const Editor: React.FC = () => {
  const {
    state,
    dispatch,
    registerSettingsSyncRetry,
  } = useEditorContext();
  const { t } = useEditorI18n();
  const translatorRef = useRef(t);
  translatorRef.current = t;
  const [activityState, setActivityState] = useState(
    () => createActivitySessionState(null, { showTemplates: true }),
  );
  const activityTriggerRef = useRef<HTMLElement | null>(null);
  const editorAreaRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<number>(() => {
    return parseStoredZoom(localStorage.getItem('sdoc-editor-zoom'));
  });
  const [readingWidth, setReadingWidth] = useState<ReadingWidthId>(() => {
    return parseStoredReadingWidth(localStorage.getItem(READING_WIDTH_STORAGE_KEY));
  });
  const [showInvalidRecoveryConfirm, setShowInvalidRecoveryConfirm] = useState(false);
  const [startCardDismissed, setStartCardDismissed] = useState(false);
  const [isBlankStartDocument, setIsBlankStartDocument] = useState(false);
  const invalidRecoveryCancelRef = useRef<HTMLButtonElement>(null);
  const importCancelRef = useRef<HTMLButtonElement>(null);
  const [meta, setMeta] = useState<MetaState>({ title: '', author: '', version: '', created: '', modified: '' });
  const [linkSelection, setLinkSelection] = useState<CapturedLinkSelection | null>(null);
  const [linkSelectionError, setLinkSelectionError] = useState<string | null>(null);
  const { dialogs, dialogDispatch } = useDialogState();
  const replaceEditorDocumentRef = useRef<(
    (reason: EditorReplacementReason, content: JSONContent) => boolean
  ) | null>(null);
  const persistenceSessionRef = useRef<{
    sessionId: string;
    documentId: string;
    revision: number;
    pendingFlushRequestId?: string;
  } | null>(null);
  const initDoneRef = useRef(false);
  const syncCoordinatorRef = useRef<DocumentSyncCoordinator | null>(null);
  const settings = state.settings;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const docSettingsRef = useRef(state.docSettings);
  docSettingsRef.current = state.docSettings;

  // Apply settings to CSS custom properties and global state
  useEffect(() => {
    // Apply CSS custom properties for caption prefixes
    const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement;
    applyEditorSettingsCss(proseMirrorEl, document.documentElement, settings);

  }, [settings]);

  // postMessageRef bridges the circular dependency: useTiptapEditor → postMessage → useEditorMessages
  const postMessageRef = useRef<(msg: EditorToHostMessage) => void>(() => {});
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const flushUpdateRef = useRef<() => boolean>(() => false);
  const diagramRendererRef = useRef<HostDiagramRenderer>(
    async () => ({ kind: 'source-only' }),
  );
  const extensionRuntime = useMemo<EditorExtensionRuntime>(() => ({
    getSettings: () => settingsRef.current,
    translate: (key, params) => translatorRef.current(key, params),
    flush: () => flushUpdateRef.current(),
    openDocument: (path: string, anchor?: string) => postMessageRef.current({ type: 'openDocument', path, anchor }),
    openDrawio: (drawioPath: string) => postMessageRef.current({ type: 'openDrawio', drawioPath }),
    openImageContextMenu: (x: number, y: number, pos: number, src: string, _alt: string) =>
      dialogDispatch({
        type: 'SET_IMAGE_CONTEXT_MENU',
        payload: { x, y, pos, src, isDrawio: src.includes('.drawio.svg') || src.includes('/drawio/') },
      }),
    openMathDialog: (latex: string, isBlock: boolean, pos: number) =>
      dialogDispatch({ type: 'SET_MATH_DIALOG', payload: { latex, isBlock, pos } }),
    openDiagramDialog: (code: string, language: string, pos: number) =>
      dialogDispatch({ type: 'SET_DIAGRAM_DIALOG', payload: { code, language, pos } }),
    renderDiagram: (request) => diagramRendererRef.current(request),
  }), [dialogDispatch]);

  const handleEditorTextFocusChange = useCallback((focused: boolean) => {
    const session = persistenceSessionRef.current;
    if (!session) return;
    postMessageRef.current({
      type: 'editorTextFocusChanged',
      sessionId: session.sessionId,
      documentId: session.documentId,
      focused,
    });
  }, []);

  const { editor, replaceEditorDocument, flushUpdate, flushPendingUpdate } = useTiptapEditor({
    onUpdate: (content) => {
      syncCoordinatorRef.current?.submit({
        content: content as TiptapNode,
        meta: metaRef.current,
        documentSettings: docSettingsRef.current,
      });
    },
    runtime: extensionRuntime,
    // VS Code owns Ctrl+S. Its onWillSave participant requests exactly one flush.
    handleSaveShortcut: false,
    translationLocale: state.locale,
    onEditorTextFocusChange: handleEditorTextFocusChange,
  });
  flushUpdateRef.current = flushUpdate;

  useEffect(() => {
    if (!editor) return undefined;
    const syncBlank = () => setIsBlankStartDocument(isBlankEditorDocument(editor.getJSON()));
    syncBlank();
    editor.on('update', syncBlank);
    return () => {
      editor.off('update', syncBlank);
    };
  }, [editor]);

  // Trigger CrossRef label re-sync when caption settings change
  const prevPrefixRef = useRef<{
    style: string;
    eqMode: string;
    capMode: string;
    includeCaption: boolean;
    heading: boolean;
    headingStart: number;
  } | null>(null);
  useEffect(() => {
    const { captionStyle, equationNumbering, captionNumbering, crossRefIncludeCaption, headingNumbering, headingStartNumber } = state.settings;
    const prev = prevPrefixRef.current;
    if (!prev) {
      prevPrefixRef.current = { style: captionStyle, eqMode: equationNumbering, capMode: captionNumbering, includeCaption: crossRefIncludeCaption, heading: headingNumbering, headingStart: headingStartNumber };
      return;
    }
    const changed = prev.style !== captionStyle || prev.eqMode !== equationNumbering
      || prev.capMode !== captionNumbering || prev.includeCaption !== crossRefIncludeCaption
      || prev.heading !== headingNumbering || prev.headingStart !== headingStartNumber;
    prevPrefixRef.current = { style: captionStyle, eqMode: equationNumbering, capMode: captionNumbering, includeCaption: crossRefIncludeCaption, heading: headingNumbering, headingStart: headingStartNumber };
    if (changed && editor) {
      const { tr } = editor.state;
      tr.setMeta(CROSSREF_RESYNC_META, true);
      editor.view.dispatch(tr);
    }
  }, [state.settings, editor]);

  const handleShowFileOperation = useCallback((tab: 'export' | 'import') => {
    activityTriggerRef.current = document.getElementById('activity-destination-publish');
    setActivityState((current) => selectSidePanel(
      current,
      { destination: 'publish', tab },
      { showTemplates: true },
    ));
  }, []);

  const {
    postMessage,
    handleViewJson,
    handleFileOperation,
    handleFileOperationConfirm,
    handleFileOperationCancel,
    handleFileOperationRetry,
    handleFileOperationResultAction,
    fileOperationState,
    renderDiagram,
    diagramRendererSettings,
    handleDiagramRendererSettingsChange,
    handleDiagramRendererConsent,
    pendingDiagramExportConsent,
    handleDiagramExportConsent,
    cancelDiagramExportConsent,
    handleUiLanguagePreferenceChange,
    handleTestDiagramRenderer,
    handleMetaChange,
    handleRequestTemplateCatalog,
    handleCreateFromTemplate,
    handleOpenExistingDocument,
    handleApplyTemplate,
    handleSavePersonalTemplate,
    handleUpdatePersonalTemplate,
    handleDuplicatePersonalTemplate,
    handleDeletePersonalTemplate,
    handleOpenPersonalTemplateFolder,
    templateSession,
    dispatchTemplateSession,
    externalChange,
    showExternalComparison,
    setShowExternalComparison,
    handleKeepLocal,
    handleReloadExternal,
    handleRecoverInvalidDocument,
    handleRetryInvalidDocument,
    invalidRecoveryPending,
    invalidRecoveryError,
    pendingImport,
    confirmPendingImport,
    cancelPendingImport,
    savePresentation,
    handleRetrySync,
  } = useEditorMessages({
    editor,
    flushUpdate,
    flushPendingUpdate,
    replaceEditorDocumentRef,
    initDoneRef,
    setMeta,
    persistenceSessionRef,
    syncCoordinatorRef,
    getCurrentMutation: () => editor ? {
      content: editor.getJSON() as TiptapNode,
      meta: metaRef.current,
      documentSettings: docSettingsRef.current,
    } satisfies DocumentMutation : null,
    onShowFileOperation: handleShowFileOperation,
  });

  const settingsSyncPhase = savePresentation?.phase;
  const settingsSyncRetryable = savePresentation?.retryable ?? false;
  const settingsSyncMessage = savePresentation?.message;
  const designSettingsSyncState = useMemo(() => toSettingsSyncState(
    settingsSyncPhase
      ? {
          phase: settingsSyncPhase,
          retryable: settingsSyncRetryable,
          ...(settingsSyncMessage ? { message: settingsSyncMessage } : {}),
        }
      : null,
  ), [settingsSyncMessage, settingsSyncPhase, settingsSyncRetryable]);

  useEffect(() => {
    dispatch({ type: 'SET_SETTINGS_SYNC_STATE', payload: designSettingsSyncState });
  }, [designSettingsSyncState, dispatch]);

  useEffect(() => {
    registerSettingsSyncRetry(handleRetrySync);
    return () => registerSettingsSyncRetry();
  }, [handleRetrySync, registerSettingsSyncRetry]);

  useEffect(() => {
    if (!editor || state.documentAccess.status !== 'editable') return;
    const session = persistenceSessionRef.current;
    if (!session) return;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const shell = document.querySelector('[data-sdoc-editor-shell="true"]');
      const titleInput = shell?.querySelector('.editor-title-input') ?? null;
      const toolbar = shell?.querySelector('.toolbar') ?? null;
      const activityBar = shell?.querySelector('.activity-bar') ?? null;
      const proseMirror = editor.view.dom;
      const isVisiblyRendered = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement) || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity) !== 0
          && bounds.width > 0
          && bounds.height > 0
          && bounds.right > 0
          && bounds.bottom > 0
          && bounds.left < window.innerWidth
          && bounds.top < window.innerHeight;
      };
      if (cancelled
        || !isVisiblyRendered(shell)
        || !isVisiblyRendered(titleInput)
        || !isVisiblyRendered(toolbar)
        || !isVisiblyRendered(activityBar)
        || !isVisiblyRendered(proseMirror)
        || !proseMirror.matches('.ProseMirror[contenteditable="true"]')) return;
      if (!hasAppliedEditorStyles(collectEditorStyleProbe({
        shell,
        toolbar,
        activityBar,
        proseMirror,
      }))) return;
      postMessage({
        type: 'uiReady',
        sessionId: session.sessionId,
        documentId: session.documentId,
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [editor, postMessage, state.documentAccess.status]);
  postMessageRef.current = postMessage;
  diagramRendererRef.current = renderDiagram;

  const handleToggleNumbering = () => {
    dispatch({
      type: 'SET_VIEW_PREFERENCES',
      payload: {
        ...state.viewPreferences,
        headingNumbering: state.settings.headingNumbering ? 'hide' : 'show',
      },
    });
  };

  const handleToggleDecoration = () => {
    dispatch({ type: 'SET_SETTINGS', payload: { headingDecoration: !state.settings.headingDecoration } });
  };

  const handleActivityDestinationClick = useCallback((destination: ActivityDestination) => {
    activityTriggerRef.current = document.getElementById(`activity-destination-${destination}`);
    setActivityState((current) => transitionActivityDestination(
      current,
      destination,
      { showTemplates: true },
    ));
  }, []);

  const handleCloseSidePanel = useCallback(() => {
    setActivityState((current) => selectSidePanel(
      current,
      null,
      { showTemplates: true },
    ));
  }, []);

  const handleSidePanelSelection = useCallback((selection: SidePanelSelection) => {
    setActivityState((current) => selectSidePanel(
      current,
      selection,
      { showTemplates: true },
    ));
  }, []);

  const handleZoomChange = useCallback((value: number) => {
    const clamped = Math.min(200, Math.max(60, value));
    setZoom(clamped);
    localStorage.setItem('sdoc-editor-zoom', String(clamped));
  }, []);

  const handleReadingWidthChange = useCallback((value: ReadingWidthId) => {
    setReadingWidth(value);
    localStorage.setItem(READING_WIDTH_STORAGE_KEY, value);
  }, []);

  const handleUpdateDocSettings = useCallback((settings: Partial<DocumentSettings> | null) => {
    if (!state.documentAccess.capabilities.editDocumentSettings) return;
    if (settings) dispatch({ type: 'SET_SETTINGS', payload: settings });
    dispatch({ type: 'SET_DOC_SETTINGS', payload: settings });
    if (!editor) return;
    syncCoordinatorRef.current?.submit({
      content: editor.getJSON() as TiptapNode,
      meta: metaRef.current,
      documentSettings: settings,
    });
  }, [dispatch, editor, state.documentAccess.capabilities.editDocumentSettings]);

  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    if (!state.documentAccess.capabilities.manageAssets) return;
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
  }, [dialogDispatch, state.documentAccess.capabilities.manageAssets]);

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
    if (!editor) return;
    const captured = captureLinkSelection(editor.state);
    if (!captured.ok) {
      setLinkSelectionError(t(captured.reason === 'non-text-selection'
        ? 'link.nonTextSelectionError'
        : 'link.multipleSelectionError'));
      return;
    }
    setLinkSelection(captured.snapshot);
    setLinkSelectionError(null);
    dialogDispatch({ type: 'OPEN_LINK_DIALOG' });
  };

  const closeLinkDialog = (restore: boolean): void => {
    if (restore && editor && linkSelection) {
      editor.view.dispatch(restoreCapturedLinkSelection(editor.state, linkSelection));
      editor.view.focus();
    }
    setLinkSelection(null);
    dialogDispatch({ type: 'CLOSE_LINK_DIALOG' });
  };

  const handleInsertMath = () => {
    dialogDispatch({ type: 'SET_MATH_DIALOG', payload: { latex: '', isBlock: false, pos: null } });
  };

  const handleInsertEndnote = () => {
    if (!editor) return;
    if (insertEndnoteAndFocus(editor)) flushUpdate();
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
      editor.chain().focus().insertDiagram(language, code, true).run();
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
    if (!editor || !linkSelection) return;
    const result = applyLinkEdit(editor.state, linkSelection, { url, text });
    if (!result.ok) {
      setLinkSelectionError(t('link.staleSelectionError'));
      closeLinkDialog(false);
      return;
    }
    editor.view.dispatch(result.transaction);
    editor.view.focus();
    closeLinkDialog(false);
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

  // Keep the explicit replacement boundary available to the message handler.
  useEffect(() => {
    if (editor) {
      replaceEditorDocumentRef.current = replaceEditorDocument;
      if (state.doc && !initDoneRef.current) {
        replaceEditorDocument('initial-load', state.doc);
        initDoneRef.current = true;
        dispatch({ type: 'SET_READY', payload: true });
        editor.setEditable(state.documentAccess.status === 'editable');
      }
    }
  }, [editor, replaceEditorDocument, state.doc, state.documentAccess.status, dispatch]);

  useEditorDomEvents(editor, handlePaste);

  useEffect(() => {
    if (state.documentAccess.capabilities.editContent) return;
    dialogDispatch({ type: 'CLOSE_ALL' });
    setShowInvalidRecoveryConfirm(false);
    setActivityState((current) => (
      current.selection?.destination === 'navigate'
        ? current
        : selectSidePanel(current, null, { showTemplates: true })
    ));
  }, [dialogDispatch, state.documentAccess.capabilities.editContent]);

  if (!editor) {
    return (
      <div className="editor-loading" role="status">
        {t('editor.loading')}
      </div>
    );
  }

  const invalidLabels = {
    title: t('invalidDocument.title'),
    initial: t('invalidDocument.initialExplanation'),
    external: t('invalidDocument.externalExplanation'),
    open: t('invalidDocument.openJsonSource'),
    retry: t('invalidDocument.retryValidation'),
    recover: t('invalidDocument.recoverLocalDraft'),
    confirmTitle: t('invalidDocument.recoveryConfirmTitle'),
    confirmBody: t('invalidDocument.recoveryConfirmBody'),
    confirm: t('invalidDocument.recoveryConfirmAction'),
    cancel: t('common.cancel'),
    running: t('invalidDocument.recoveryRunning'),
    diagnosticsSummary: t('invalidDocument.diagnosticsSummary', {
      count: state.documentAccess.status === 'invalid-initial'
        || state.documentAccess.status === 'invalid-external'
        ? state.documentAccess.diagnostics.length
        : 0,
    }),
    diagnosticsDetails: t('invalidDocument.diagnosticsDetails'),
  };

  if (state.documentAccess.status === 'invalid-initial') {
    return (
      <InvalidDocumentNotice
        variant="initial"
        diagnostics={state.documentAccess.diagnostics}
        labels={invalidLabels}
        onOpenSource={handleViewJson}
        onRetry={handleRetryInvalidDocument}
      />
    );
  }

  const hasLocalChanges = Boolean(syncCoordinatorRef.current
    && syncCoordinatorRef.current.state.localGeneration
      > syncCoordinatorRef.current.state.acknowledgedGeneration);
  const externalComparison = externalChange
    ? buildExternalChangeComparison(
      buildExternalMutationDiff({
        content: editor.getJSON() as TiptapNode,
        meta,
        documentSettings: state.docSettings,
      }, externalChange.snapshot),
      {
        title: t('externalChange.compareTitle'),
        mine: t('externalChange.mine'),
        external: t('externalChange.external'),
      },
    )
    : null;

  return (
    <div className="editor-shell" data-sdoc-editor-shell="true">
      <DocumentHeader
        author={meta.author}
        version={meta.version}
        created={meta.created}
        modified={meta.modified}
        onAuthorChange={(value) => handleMetaChange('author', value)}
        onVersionChange={(value) => handleMetaChange('version', value)}
        disabled={!state.documentAccess.capabilities.editMetadata}
        saveStatus={savePresentation ? {
          phase: savePresentation.phase,
          label: t(({
            blocked: 'editor.saveBlocked',
            conflict: 'editor.conflict',
            failed: 'editor.saveError',
            saving: 'editor.saving',
            syncing: 'editor.syncing',
            modified: 'editor.dirty',
            'disk-pending': 'editor.diskPending',
            saved: 'editor.saved',
          } as const)[savePresentation.phase]),
          detail: savePresentation.message,
          retryable: savePresentation.retryable,
        } : null}
        retryLabel={t('editor.retrySave')}
        onRetrySave={handleRetrySync}
      />
      <Toolbar
        editor={editor}
        disabled={!state.documentAccess.capabilities.editContent}
        onInsertLink={handleInsertLink}
        onInsertMath={handleInsertMath}
        onInsertDiagram={handleInsertDiagram}
        onInsertCrossRef={() => dialogDispatch({ type: 'OPEN_CROSSREF_DIALOG' })}
        onInsertEndnote={handleInsertEndnote}
        onInsertImage={handleInsertImage}
        onInsertDrawio={handleInsertDrawio}
      />
      {state.documentAccess.status === 'invalid-external' && (
        <InvalidDocumentNotice
          variant="external"
          diagnostics={state.documentAccess.diagnostics}
          labels={invalidLabels}
          onOpenSource={handleViewJson}
          onRetry={handleRetryInvalidDocument}
          canRecover={state.documentAccess.canRecoverFromLocal}
          recoveryPending={invalidRecoveryPending}
          recoveryError={invalidRecoveryError}
          onRecover={() => setShowInvalidRecoveryConfirm(true)}
        />
      )}
      {externalChange && (
        <ExternalChangePrompt
          isDirty={hasLocalChanges}
          onCompare={() => setShowExternalComparison(true)}
          onKeepMine={handleKeepLocal}
          onReload={handleReloadExternal}
          fallbackFocusRef={editorAreaRef}
          labels={{
            message: t('externalChange.message'),
            compare: t('externalChange.compare'),
            keepMine: t('externalChange.keepMine'),
            reload: t('externalChange.reload'),
            keepTitle: t('externalChange.keepMineTitle'),
            reloadTitle: t('externalChange.reloadTitle'),
            keepConfirm: t('externalChange.confirmKeepMine'),
            reloadConfirm: t('externalChange.confirmReload'),
            cancel: t('common.cancel'),
            keepRunning: t('externalChange.keepMineRunning'),
            reloadRunning: t('externalChange.reloadRunning'),
            failure: t('externalChange.resolutionFailed'),
            retry: t('externalChange.retry'),
          }}
        />
      )}
      {showExternalComparison && externalComparison && (
        <ExternalChangeComparison
          model={externalComparison}
          onClose={() => setShowExternalComparison(false)}
          closeLabel={t('externalChange.closeComparison')}
          emptyMessage={t('externalChange.noBlockDiff')}
          labels={{
            metadata: t('externalChange.metadata'),
            settings: t('externalChange.settings'),
            body: t('externalChange.body'),
            field: t('externalChange.field'),
            change: t('externalChange.change'),
            changedBlocks: t('externalChange.changedBlocks'),
            notInMine: t('externalChange.notInMine'),
            notOnDisk: t('externalChange.notOnDisk'),
            added: t('externalChange.added'),
            removed: t('externalChange.removed'),
            changed: t('externalChange.changed'),
            moved: t('externalChange.moved'),
            truncated: t('externalChange.truncated'),
          }}
        />
      )}
      {editor && <BubbleMenuBar editor={editor} onEditLink={handleInsertLink} />}
      {linkSelectionError && (
        <div className="link-selection-error" role="alert">
          <span>{linkSelectionError}</span>
          <button type="button" onClick={() => setLinkSelectionError(null)} aria-label={t('common.close')}>×</button>
        </div>
      )}
      <div className={`editor-body-layout${activityState.selection ? ' editor-body-with-toc' : ''}`}>
        <ActivityBar
          activeDestination={activityState.selection?.destination ?? null}
          onDestinationClick={handleActivityDestinationClick}
          showTemplates
          disabledDestinations={state.documentAccess.capabilities.editContent
            ? []
            : ['design', 'templates', 'publish']}
        />
        {activityState.selection && (
          <SidePanel
            onClose={handleCloseSidePanel}
            selection={activityState.selection}
            onSelectionChange={handleSidePanelSelection}
            returnFocusRef={activityTriggerRef}
            editor={editor}
            settings={state.settings}
            showNumbering={state.settings.headingNumbering}
            onToggleNumbering={handleToggleNumbering}
            showDecoration={state.settings.headingDecoration}
            onToggleDecoration={handleToggleDecoration}
            uiLanguagePreference={state.uiLanguagePreference}
            onUiLanguagePreferenceChange={handleUiLanguagePreferenceChange}
            onUpdateDocSettings={handleUpdateDocSettings}
            onPostMessage={postMessage}
            onViewJson={handleViewJson}
            onFileOperation={handleFileOperation}
            onFileOperationConfirm={handleFileOperationConfirm}
            onFileOperationCancel={handleFileOperationCancel}
            onFileOperationRetry={handleFileOperationRetry}
            onFileOperationResultAction={handleFileOperationResultAction}
            fileOperationState={fileOperationState}
            diagramRendererSettings={diagramRendererSettings}
            onDiagramRendererSettingsChange={handleDiagramRendererSettingsChange}
            onResolveDiagramRendererConsent={async (consent) => {
              await handleDiagramRendererConsent(consent);
            }}
            onTestDiagramRenderer={handleTestDiagramRenderer}
            pendingDiagramExportConsent={pendingDiagramExportConsent}
            onDiagramExportConsent={handleDiagramExportConsent}
            onCancelDiagramExportConsent={cancelDiagramExportConsent}
            templateSession={templateSession}
            dispatchTemplateSession={dispatchTemplateSession}
            onRefreshTemplates={handleRequestTemplateCatalog}
            onCreateFromTemplate={handleCreateFromTemplate}
            onApplyTemplate={handleApplyTemplate}
            onSavePersonalTemplate={handleSavePersonalTemplate}
            onUpdatePersonalTemplate={handleUpdatePersonalTemplate}
            onDuplicatePersonalTemplate={handleDuplicatePersonalTemplate}
            onDeletePersonalTemplate={handleDeletePersonalTemplate}
            onOpenPersonalTemplateFolder={handleOpenPersonalTemplateFolder}
          />
        )}
        <div ref={editorAreaRef} className="editor-content-area" tabIndex={-1}>
          <div className="editor-scroll-area" data-reading-width={readingWidth}>
            <div style={{ zoom: zoom / 100 }}>
              <div className="editor-title-area">
                <input
                  className="editor-title-input"
                  value={meta.title}
                  onChange={(e) => handleMetaChange('title', e.target.value)}
                  placeholder={t('document.titlePlaceholder')}
                  aria-label={t('document.titlePlaceholder')}
                  disabled={!state.documentAccess.capabilities.editMetadata}
                />
              </div>
              {!startCardDismissed
                && isBlankStartDocument
                && state.documentAccess.capabilities.editContent && (
                <DocumentStartCard
                  onStartEmpty={() => setStartCardDismissed(true)}
                  onCreateFromTemplate={() => {
                    activityTriggerRef.current = document.getElementById('activity-destination-templates');
                    setActivityState((current) => selectSidePanel(current, {
                      destination: 'templates',
                    }));
                  }}
                  onOpenExisting={handleOpenExistingDocument}
                />
              )}
              <EditorContent
                editor={editor}
                className={`${state.settings.headingNumbering ? 'show-numbering' : 'hide-numbering'} ${state.settings.headingDecoration ? 'show-heading-decoration' : ''} ${state.settings.captionNumbering === 'hierarchical' ? 'hierarchical-numbering' : 'sequential-numbering'}`}
              />
              {editor && <EndnoteList editor={editor} />}
            </div>
          </div>
          <ZoomBar
            zoom={zoom}
            onZoomChange={handleZoomChange}
            readingWidth={readingWidth}
            onReadingWidthChange={handleReadingWidthChange}
          />
        </div>
      </div>
      {showInvalidRecoveryConfirm && (
        <ModalDialog
          size="md"
          role="alertdialog"
          titleId="invalid-recovery-title"
          descriptionId="invalid-recovery-description"
          initialFocusRef={invalidRecoveryCancelRef}
          fallbackFocusRef={editorAreaRef}
          onCancel={() => setShowInvalidRecoveryConfirm(false)}
        >
            <div className="modal-body">
              <h2 id="invalid-recovery-title">{invalidLabels.confirmTitle}</h2>
              <p id="invalid-recovery-description">{invalidLabels.confirmBody}</p>
            </div>
            <div className="modal-footer">
              <button ref={invalidRecoveryCancelRef} type="button" className="btn-secondary"
                onClick={() => setShowInvalidRecoveryConfirm(false)}>{invalidLabels.cancel}</button>
              <button type="button" className="btn-primary" onClick={() => {
                setShowInvalidRecoveryConfirm(false);
                handleRecoverInvalidDocument();
              }}>{invalidLabels.confirm}</button>
            </div>
        </ModalDialog>
      )}
      {pendingImport && (
        <ModalDialog
          size="md"
          role="alertdialog"
          titleId="import-confirm-title"
          descriptionId="import-confirm-description"
          initialFocusRef={importCancelRef}
          fallbackFocusRef={editorAreaRef}
          onCancel={cancelPendingImport}
        >
          <div className="modal-body">
            <h2 id="import-confirm-title">{t('import.confirmTitle')}</h2>
            <p id="import-confirm-description">{t('import.confirmBody')}</p>
          </div>
          <div className="modal-footer">
            <button ref={importCancelRef} type="button" className="btn-secondary" onClick={cancelPendingImport}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" onClick={confirmPendingImport}>
              {t('import.confirmAction')}
            </button>
          </div>
        </ModalDialog>
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
      {dialogs.showLinkDialog && editor && linkSelection && (
        <LinkDialog
          mode={linkSelection.mode}
          onConfirm={(url, text) => handleLinkConfirm(url, text)}
          onCancel={() => closeLinkDialog(true)}
          onBrowseSdoc={() => { void postMessage({ type: 'browseSdocFiles' }); }}
          defaultText={linkSelection.text}
          defaultUrl={linkSelection.href}
          mixedFormatting={linkSelection.hasMixedFormatting}
          onOpen={() => {
            openCapturedLink(linkSelection, (url) => {
              closeLinkDialog(false);
              if (url.startsWith('#')) {
                const position = resolveStructurePosition(editor.state, url.slice(1));
                if (position !== undefined) {
                  editor.commands.setTextSelection(position + 1);
                  editor.commands.focus();
                }
              } else if (url.includes('.sdoc')) {
                const [path, anchor] = url.split('#');
                postMessage({ type: 'openDocument', path, anchor });
              } else {
                window.open(url, '_blank', 'noopener,noreferrer');
              }
            });
          }}
          onCopy={() => copyCapturedLink(
            linkSelection,
            (url) => navigator.clipboard.writeText(url),
          )}
          onRemove={() => {
            const result = removeCapturedLink(editor.state, linkSelection);
            if (result.ok) {
              editor.view.dispatch(result.transaction);
              editor.view.focus();
              closeLinkDialog(false);
              flushUpdate();
            }
          }}
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
          returnFocusRef={editorAreaRef}
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
          renderDiagram={renderDiagram}
          rendererSettings={diagramRendererSettings}
          onResolveRendererConsent={async (consent) => {
            await handleDiagramRendererConsent(consent);
          }}
          initialCode={dialogs.diagramDialog.code}
          initialLanguage={dialogs.diagramDialog.language}
          pos={dialogs.diagramDialog.pos}
          onConfirm={handleDiagramConfirm}
          onCancel={() => dialogDispatch({ type: 'SET_DIAGRAM_DIALOG', payload: null })}
        />
      )}
      {dialogs.showCrossRefDialog && editor && (
        <CrossReferenceDialog
          targets={collectTargets(editor, settings)}
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
