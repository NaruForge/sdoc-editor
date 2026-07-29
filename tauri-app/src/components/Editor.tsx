import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorDomEvents } from '@shared/editor/hooks/useEditorDomEvents';
import { EditorContent } from '@tiptap/react';
import { useTiptapEditor } from '@shared/editor/hooks/useTiptapEditor';
import { applyEditorSettingsCss } from '@shared/editor/applyEditorSettingsCss';
import { isUpdatedDrawioAsset } from '@shared/editor/drawioUpdates';
import { useDialogState } from '@shared/editor/hooks/useDialogState';
import { useEditorContext } from '@shared/editor/context/EditorContext';
import { useTauriMessaging } from '../hooks/useTauriMessaging';
import { type TauriAdapter, resolveAssetUrl } from '../adapters/tauriMessaging';
import { convertMarkdownToJson } from '@shared/converter/markdownToJson';
import { extractTitle, normalizeDocument, wrapSdoc } from '@shared/document/sdocUtils';
import { dehydrateDocumentAssets, hydrateDocumentAssets } from '@shared/document/runtimeAssets';
import { assertPersistedDocument } from '@shared/document/documentContract';
import { Toolbar } from '@shared/editor/components/Toolbar';
import { BubbleMenuBar } from '@shared/editor/components/BubbleMenuBar';
import { DocumentHeader } from '@shared/editor/components/DocumentHeader';
import { TableContextMenu } from '@shared/editor/components/TableContextMenu';
import { TablePropertiesModal } from '@shared/editor/components/TablePropertiesModal';
import { ImageNameDialog } from '@shared/editor/components/ImageNameDialog';
import { DrawioNameDialog } from '@shared/editor/components/DrawioNameDialog';
import { DrawioActionDialog } from '@shared/editor/components/DrawioActionDialog';
import { DrawioInstallGuideDialog } from './DrawioInstallGuideDialog';
import { LinkDialog } from '@shared/editor/components/LinkDialog';
import { ImagePropertiesDialog } from '@shared/editor/components/ImagePropertiesDialog';
import { ImageContextMenu } from '@shared/editor/components/ImageContextMenu';
import { MathDialog } from '@shared/editor/components/MathDialog';
import { DiagramDialog } from '@shared/editor/components/DiagramDialog';
import { EditorContextMenu } from '@shared/editor/components/EditorContextMenu';
import { CrossReferenceDialog } from '@shared/editor/components/CrossReferenceDialog';
import { ActivityBar } from '@shared/editor/components/ActivityBar';
import {
  createActivitySessionState,
  selectSidePanel,
  transitionActivityDestination,
  type ActivityDestination,
  type SidePanelSelection,
} from '@shared/editor/activityState';
import { SidePanel } from './SidePanel';
import { MenuBar, type MenuDef } from './MenuBar';
import { ZoomBar } from '@shared/editor/components/ZoomBar';
import { FolderOpen } from 'lucide-react';
import { collectTargets, CROSSREF_RESYNC_META } from '@shared/editor/extensions/CrossReference';
import type { RefTarget } from '@shared/editor/extensions/CrossReference';
import { extractRelativePathFromSrc } from '@shared/editor/extensions/CustomImage';
import { preprocessImportedHtml } from '@shared/editor/utils/preprocessImportedHtml';
import type { DocumentSettings, SdocMeta, TiptapNode } from '@shared/types';
import type { EditorToHostMessage, ManagedTemplateDescriptor } from '@shared/types/messages';
import type { ExplorerEntry } from '../App';
import { exportDocument, type ExportFormat } from '../services/exportService';
import {
  dispatchTauriSettingsMessage,
  resolveTauriEditorSettings,
} from '../settingsAdapter';
import {
  DocumentSyncCoordinator,
  SaveCoordinator,
  type DocumentMutation,
} from '@shared/persistence/DocumentSyncCoordinator';
import {
  keepLocalThroughAcknowledgement,
  reloadExternalChangeAfterReplacement,
} from '@shared/persistence/externalChangeResolution';
import { DocumentHydrationCoordinator } from '../documentHydration';
import {
  ExternalChangePrompt,
  ExternalChangeComparison,
  buildExternalChangeComparison,
  buildExternalDocumentDiff,
} from '@shared/editor/externalChanges';
import { useEditorI18n, type UiLanguagePreference } from '@shared/editor/i18n';
import type { EditorExtensionRuntime } from '@shared/editor/extensionRuntime';
import type {
  HostDiagramRenderer,
} from '@shared/editor/diagram';
import { DiagramRenderError } from '@shared/editor/diagram';
import type { TemplateCatalogDiagnosticView } from '@shared/template/catalogView';
import {
  createFileOperationControllerState,
  createFileOperationError,
  fileOperationReducer,
  tryStartFileOperation,
  type FileOperationControllerState,
  type FileOperationKind,
} from '@shared/editor/fileOperations';
import type { FileExportFormat, FileImportFormat } from '@shared/editor/components/FilesPanel';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type DiagramRendererSettings,
} from '@shared/diagramRenderer';

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
  return hydrateDocumentAssets(doc, resolveAssetUrl);
}

interface EditorProps {
  adapter: TauriAdapter;
  initialDoc?: TiptapNode;
  initialMeta?: SdocMeta | null;
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

interface EditorMetaState extends SdocMeta {
  title: string;
  author: string;
  version: string;
  created: string;
  modified: string;
}

const replaceMetaState = (meta: Partial<SdocMeta> | null | undefined): EditorMetaState => ({
  title: meta?.title ?? '',
  author: meta?.author ?? '',
  version: meta?.version ?? '',
  created: meta?.created ?? '',
  modified: meta?.modified ?? '',
});

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
  const { t } = useEditorI18n();
  const translatorRef = useRef(t);
  translatorRef.current = t;
  const [showNumbering, setShowNumbering] = useState(true);
  const [activityState, setActivityState] = useState(
    () => createActivitySessionState(
      { destination: 'workspace' },
      { showWorkspace: true, showTemplates: true },
    ),
  );
  const activityTriggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const destination = activityState.selection?.destination;
    if (destination && !activityTriggerRef.current) {
      activityTriggerRef.current = document.getElementById(`activity-destination-${destination}`);
    }
  }, [activityState.selection]);
  const editorAreaRef = useRef<HTMLDivElement | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ManagedTemplateDescriptor[]>([]);
  const [templateDiagnostics, setTemplateDiagnostics] = useState<TemplateCatalogDiagnosticView[]>([]);
  const [isTemplateCatalogLoading, setIsTemplateCatalogLoading] = useState(true);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [isManagingTemplate, setIsManagingTemplate] = useState(false);
  const [fileController, setFileController] = useState<FileOperationControllerState>(
    () => createFileOperationControllerState(adapter.getDocumentSession()?.sessionId ?? 'pending'),
  );
  const [diagramRendererSettings, setDiagramRendererSettings] =
    useState<DiagramRendererSettings>({ ...DEFAULT_DIAGRAM_RENDERER_SETTINGS });
  const catalogRequestRef = useRef<string | null>(null);
  const applyRequestRef = useRef<string | null>(null);
  const personalRequestRef = useRef<string | null>(null);
  const diagramRequestsRef = useRef(new Map<string, {
    resolve: (value: Awaited<ReturnType<HostDiagramRenderer>>) => void;
    reject: (reason: unknown) => void;
  }>());
  const [externalChange, setExternalChange] = useState<{
    revision: number;
    snapshot: DocumentMutation;
  } | null>(null);
  const [showExternalComparison, setShowExternalComparison] = useState(false);
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
  const { dialogs, dialogDispatch } = useDialogState();
  const {
    contextMenu, editorContextMenu, showTableProperties, pendingImage,
    showDrawioActionDialog, showDrawioDialog, showLinkDialog, imageProperties,
    imageContextMenu, mathDialog, diagramDialog, showCrossRefDialog,
  } = dialogs;
  const setContextMenu = (payload: typeof contextMenu) => dialogDispatch({ type: payload ? 'OPEN_TABLE_CONTEXT_MENU' : 'CLOSE_TABLE_CONTEXT_MENU', ...(payload ? { payload } : {}) } as Parameters<typeof dialogDispatch>[0]);
  const setEditorContextMenu = (payload: typeof editorContextMenu) => dialogDispatch({ type: payload ? 'OPEN_EDITOR_CONTEXT_MENU' : 'CLOSE_EDITOR_CONTEXT_MENU', ...(payload ? { payload } : {}) } as Parameters<typeof dialogDispatch>[0]);
  const setShowTableProperties = (open: boolean) => dialogDispatch({ type: open ? 'OPEN_TABLE_PROPERTIES' : 'CLOSE_TABLE_PROPERTIES' });
  const setPendingImage = useCallback((payload: typeof pendingImage) => dialogDispatch({ type: 'SET_PENDING_IMAGE', payload }), [dialogDispatch]);
  const setShowDrawioActionDialog = (open: boolean) => dialogDispatch({ type: open ? 'OPEN_DRAWIO_ACTION_DIALOG' : 'CLOSE_DRAWIO_ACTION_DIALOG' });
  const setShowDrawioDialog = (open: boolean) => dialogDispatch({ type: open ? 'OPEN_DRAWIO_DIALOG' : 'CLOSE_DRAWIO_DIALOG' });
  const setShowLinkDialog = (open: boolean) => dialogDispatch({ type: open ? 'OPEN_LINK_DIALOG' : 'CLOSE_LINK_DIALOG' });
  const setImageProperties = (payload: typeof imageProperties) => dialogDispatch({ type: 'SET_IMAGE_PROPERTIES', payload });
  const setImageContextMenu = useCallback((payload: typeof imageContextMenu) => dialogDispatch({ type: 'SET_IMAGE_CONTEXT_MENU', payload }), [dialogDispatch]);
  const setMathDialog = useCallback((payload: typeof mathDialog) => dialogDispatch({ type: 'SET_MATH_DIALOG', payload }), [dialogDispatch]);
  const setDiagramDialog = useCallback((payload: typeof diagramDialog) => dialogDispatch({ type: 'SET_DIAGRAM_DIALOG', payload }), [dialogDispatch]);
  const setShowCrossRefDialog = (open: boolean) => dialogDispatch({ type: open ? 'OPEN_CROSSREF_DIALOG' : 'CLOSE_CROSSREF_DIALOG' });
  const [showDrawioInstallGuide, setShowDrawioInstallGuide] = useState(false);
  const [meta, setMeta] = useState<EditorMetaState>(() => replaceMetaState(initialMeta));
  const initDoneRef = useRef(false);
  const postMessageRef = useRef<(msg: EditorToHostMessage) => Promise<void>>(() => Promise.resolve());
  const diagramRendererRef = useRef<HostDiagramRenderer>(
    async () => ({ kind: 'source-only' }),
  );
  const syncCoordinatorRef = useRef<DocumentSyncCoordinator | null>(null);
  const hydrationCoordinatorRef = useRef(new DocumentHydrationCoordinator<TiptapNode>());
  const replacementHydrationRef = useRef<string | null>(null);
  const settings = state.settings;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const docSettingsRef = useRef(state.docSettings);
  docSettingsRef.current = state.docSettings;
  const flushUpdateRef = useRef<() => void>(() => {});
  const openWorkspaceFileRef = useRef(onOpenWorkspaceFile);
  openWorkspaceFileRef.current = onOpenWorkspaceFile;
  const extensionRuntime = useMemo<EditorExtensionRuntime>(() => ({
    getSettings: () => settingsRef.current,
    translate: (key, params) => translatorRef.current(key, params),
    flush: () => flushUpdateRef.current(),
    openDocument: (path: string) => {
      void invoke<string>('resolve_document_relative_path', { path })
        .then((resolvedPath) => openWorkspaceFileRef.current?.(resolvedPath))
        .catch((error: unknown) => console.warn('Failed to resolve linked document', error));
    },
    openDrawio: (drawioPath: string) => {
      postMessageRef.current({ type: 'openDrawio', drawioPath }).catch(() => setShowDrawioInstallGuide(true));
    },
    openImageContextMenu: (x: number, y: number, pos: number, src: string) => {
      const isDrawio = src.includes('.drawio.svg') || src.includes('/drawio/');
      setImageContextMenu({ x, y, pos, src, isDrawio });
    },
    openMathDialog: (latex: string, isBlock: boolean, pos: number) => setMathDialog({ latex, isBlock, pos }),
    openDiagramDialog: (code: string, language: string, pos: number) => setDiagramDialog({ code, language, pos }),
    renderDiagram: (request) => diagramRendererRef.current(request),
  }), [setDiagramDialog, setImageContextMenu, setMathDialog]);

  const session = adapter.getDocumentSession();
  if (session && syncCoordinatorRef.current?.state.sessionId !== session.sessionId) {
    syncCoordinatorRef.current = new DocumentSyncCoordinator({
      identity: session,
      send: (request) => postMessageRef.current({ type: 'edit', ...request }),
    });
  }

  const { editor, replaceEditorDocument, flushUpdate } = useTiptapEditor({
    onUpdate: (content) => {
      setSaveStatus('dirty');
      const normalized = normalizeDocument(dehydrateDocumentAssets(content as TiptapNode), {
        equationNumbering: settings.equationNumbering,
        captionStyle: settings.captionStyle,
        crossRefIncludeCaption: settings.crossRefIncludeCaption,
        captionNumbering: settings.captionNumbering,
        headingNumbering: settings.headingNumbering,
      });
      assertPersistedDocument(wrapSdoc(normalized, {}));
      syncCoordinatorRef.current?.submit({
        content: normalized,
        meta: { ...metaRef.current, title: extractTitle(normalized) },
        documentSettings: docSettingsRef.current,
      });
    },
    runtime: extensionRuntime,
    translationLocale: state.locale,
  });
  flushUpdateRef.current = flushUpdate;

  useEffect(() => {
    adapter.setFlushHandler(async () => {
      flushUpdate();
      const sync = syncCoordinatorRef.current;
      if (sync) {
        await new SaveCoordinator(sync).afterAcknowledged(async () => {});
      }
    });
    return () => adapter.setFlushHandler(null);
  }, [adapter, flushUpdate]);

  useEffect(() => {
    adapter.setEditorEditableHandler((editable) => editor?.setEditable(editable));
    return () => adapter.setEditorEditableHandler(null);
  }, [adapter, editor]);

  useEffect(() => {
    const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement;
    applyEditorSettingsCss(proseMirrorEl, document.documentElement, settings);
    setShowNumbering(settings.headingNumbering);
  }, [settings]);

  // Trigger CrossRef label re-sync when caption settings change
  const prevPrefixRef = useRef({ style: '', eqMode: '', capMode: '', includeCaption: false, heading: true });
  useEffect(() => {
    const { captionStyle, equationNumbering, captionNumbering, crossRefIncludeCaption, headingNumbering } = state.settings;
    const prev = prevPrefixRef.current;
    const changed = prev.style !== captionStyle || prev.eqMode !== equationNumbering
      || prev.capMode !== captionNumbering || prev.includeCaption !== crossRefIncludeCaption
      || prev.heading !== headingNumbering;
    prevPrefixRef.current = { style: captionStyle, eqMode: equationNumbering, capMode: captionNumbering, includeCaption: crossRefIncludeCaption, heading: headingNumbering };
    if (changed && editor) {
      const { tr } = editor.state;
      tr.setMeta(CROSSREF_RESYNC_META, true);
      editor.view.dispatch(tr);
    }
  }, [state.settings, editor]);

  const { postMessage } = useTauriMessaging(adapter, (message) => {
    if (dispatchTauriSettingsMessage(message, dispatch)) return;
    switch (message.type) {
      case 'uiLanguageChanged':
        dispatch({
          type: 'SET_UI_LANGUAGE',
          payload: {
            preference: message.preference,
            detectedLanguage: message.locale,
          },
        });
        break;
      case 'importMarkdownText':
        if (editor
          && session?.sessionId === message.sessionId
          && session.documentId === message.documentId
          && fileController.operationState.phase === 'running'
          && fileController.operationState.requestId === message.requestId) {
          const converted = convertMarkdownToJson(message.text);
          replaceEditorDocument('user-import', converted);
          flushUpdate();
          void postMessageRef.current({
            type: 'fileOperationApplied',
            requestId: message.requestId,
            sessionId: message.sessionId,
            documentId: message.documentId,
            applied: true,
          });
        }
        break;
      case 'importHtml':
        if (editor
          && session?.sessionId === message.sessionId
          && session.documentId === message.documentId
          && fileController.operationState.phase === 'running'
          && fileController.operationState.requestId === message.requestId) {
          const cleaned = preprocessImportedHtml(message.html);
          replaceEditorDocument('user-import', cleaned as unknown as TiptapNode);
          flushUpdate();
          void postMessageRef.current({
            type: 'fileOperationApplied',
            requestId: message.requestId,
            sessionId: message.sessionId,
            documentId: message.documentId,
            applied: true,
          });
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
          editor.chain().command(({ tr }) => {
            tr.doc.descendants((node, pos) => {
              if (node.type.name === 'image' && isUpdatedDrawioAsset(node.attrs.relativePath, message.relativePath)) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: message.newWebviewUri });
              }
            });
            return true;
          }).run();
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
      case 'templateCatalog':
        if (message.requestId !== catalogRequestRef.current) break;
        setTemplates(message.templates);
        setTemplateDiagnostics(message.diagnostics);
        setIsTemplateCatalogLoading(false);
        break;
      case 'templateApplicationFinished':
        if (message.requestId !== applyRequestRef.current) break;
        applyRequestRef.current = null;
        setIsApplyingTemplate(false);
        if (message.result !== 'applied' || replacementHydrationRef.current === null) {
          editor?.setEditable(true);
        }
        break;
      case 'templateOperationFinished':
        if (message.requestId !== personalRequestRef.current) break;
        personalRequestRef.current = null;
        setIsManagingTemplate(false);
        if (!message.succeeded && message.message) {
          window.alert(t('template.operationFailed', { message: message.message }));
        }
        break;
      case 'fileOperationStatus':
        setFileController((current) => {
          if (current.sessionId !== message.sessionId
            || message.state.phase === 'idle'
            || message.state.phase === 'running') return current;
          if (message.state.phase === 'succeeded') {
            return fileOperationReducer(current, {
              type: 'succeeded',
              sessionId: message.sessionId,
              requestId: message.state.requestId,
              result: message.state.result,
            });
          }
          if (message.state.phase === 'failed') {
            return fileOperationReducer(current, {
              type: 'failed',
              sessionId: message.sessionId,
              requestId: message.state.requestId,
              error: message.state.error,
            });
          }
          return fileOperationReducer(current, {
            type: 'cancelled',
            sessionId: message.sessionId,
            requestId: message.state.requestId,
          });
        });
        break;
      case 'diagramRenderResult': {
        const pending = diagramRequestsRef.current.get(message.requestId);
        if (!pending) break;
        diagramRequestsRef.current.delete(message.requestId);
        if (message.result.status === 'ready') {
          pending.resolve({ kind: 'png', dataUrl: message.result.dataUrl });
        } else {
          pending.reject(new DiagramRenderError(
            message.result.message,
            message.result.retryable,
          ));
        }
        break;
      }
      case 'diagramRendererSettings':
        setDiagramRendererSettings(message.settings);
        break;
      case 'editAcknowledged':
        if (syncCoordinatorRef.current?.acknowledge(message)) {
          const observed = syncCoordinatorRef.current.state.externalChange;
          setExternalChange(observed
            ? { revision: observed.revision, snapshot: observed.hostSnapshot }
            : null);
          if (!observed) setShowExternalComparison(false);
          setSaveStatus(
            syncCoordinatorRef.current.state.localGeneration
              === syncCoordinatorRef.current.state.acknowledgedGeneration
              ? 'saved'
              : 'saving',
          );
          setLastSavedAt(new Date().toLocaleTimeString());
        }
        break;
      case 'editRejected':
        if (syncCoordinatorRef.current?.reject(message)) {
          setSaveStatus('error');
          console.error('Failed to save document', message.message);
        }
        break;
      case 'externalChange':
        if (session?.sessionId !== message.sessionId
          || session.documentId !== message.documentId) break;
        if (syncCoordinatorRef.current?.observeExternalChange(message.revision, message.snapshot)) {
          setExternalChange({ revision: message.revision, snapshot: message.snapshot });
        }
        break;
      case 'replaceDocument':
        if (session?.sessionId !== message.sessionId
          || session.documentId !== message.documentId) break;
        {
          const hydrationKey = `${message.sessionId}:${message.revision}:${message.reason}`;
          const applyReplacement = (content: TiptapNode) => {
            replaceEditorDocument(message.reason, content);
            syncCoordinatorRef.current?.adoptReplacement(message.revision, message.snapshot);
              setMeta(replaceMetaState(message.snapshot.meta));
            dispatch({ type: 'SET_DOC_SETTINGS', payload: message.snapshot.documentSettings });
            setExternalChange(null);
            setShowExternalComparison(false);
          };
          replacementHydrationRef.current = hydrationKey;
          editor?.setEditable(false);
          void hydrationCoordinatorRef.current.hydrate(
            hydrationKey,
            () => convertImagePaths(message.snapshot.content),
            applyReplacement,
          ).catch((error: unknown) => {
            setSaveStatus('error');
            console.error('Failed to hydrate replacement document assets', error);
            if (replacementHydrationRef.current === hydrationKey) {
              applyReplacement(message.snapshot.content);
            }
          }).finally(() => {
            if (replacementHydrationRef.current === hydrationKey) {
              replacementHydrationRef.current = null;
              editor?.setEditable(true);
            }
          });
        }
        break;
    }
  });
  postMessageRef.current = postMessage;

  const renderDiagram: HostDiagramRenderer = ({ language, code, signal }) => {
    if (language === 'mermaid') return Promise.resolve({ kind: 'source-only' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        diagramRequestsRef.current.delete(requestId);
        void postMessage({ type: 'cancelDiagramRender', requestId });
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, { once: true });
      diagramRequestsRef.current.set(requestId, {
        resolve: (value) => {
          signal.removeEventListener('abort', cancel);
          resolve(value);
        },
        reject: (reason) => {
          signal.removeEventListener('abort', cancel);
          reject(reason);
        },
      });
      void postMessage({ type: 'renderDiagram', requestId, language, source: code });
    });
  };
  diagramRendererRef.current = renderDiagram;
  const handleDiagramRendererSettingsChange = (settings: DiagramRendererSettings) => {
    void postMessage({ type: 'updateDiagramRendererSettings', settings });
  };
  const handleUiLanguagePreferenceChange = (preference: UiLanguagePreference) => {
    void postMessage({ type: 'updateUiLanguage', preference });
  };
  const handleTestDiagramRenderer = (settings: DiagramRendererSettings) => {
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      diagramRequestsRef.current.set(requestId, {
        resolve: () => resolve(),
        reject,
      });
      void postMessage({
        type: 'testDiagramRendererConnection',
        requestId,
        settings,
      });
    });
  };

  useEffect(() => {
    const requestId = crypto.randomUUID();
    catalogRequestRef.current = requestId;
    void postMessage({ type: 'requestTemplateCatalog', requestId });
  }, [postMessage]);

  useEffect(() => {
    const currentSessionId = adapter.getDocumentSession()?.sessionId ?? 'pending';
    setFileController((current) => fileOperationReducer(current, {
      type: 'session-changed',
      sessionId: currentSessionId,
    }));
  }, [adapter, session?.sessionId]);

  const handleViewJson = () => { postMessage({ type: 'viewJson' }); };
  const handleFileOperation = (
    kind: FileOperationKind,
    format: FileExportFormat | FileImportFormat,
  ) => {
    const currentSession = adapter.getDocumentSession();
    if (!currentSession) return;
    const requestId = crypto.randomUUID();
    const start = tryStartFileOperation(fileController, {
      sessionId: currentSession.sessionId,
      requestId,
      kind,
      format,
      stage: kind === 'export' ? 'Preparing export...' : 'Choose a file...',
    });
    if (!start.accepted) return;
    setFileController(start.state);
    if (kind === 'import') {
      void postMessage({
        type: format === 'markdown' ? 'importMarkdown' : 'importHtml',
        requestId,
        sessionId: currentSession.sessionId,
        documentId: currentSession.documentId,
      });
      return;
    }
    if (!editor) return;
    void (async () => {
      try {
        flushUpdate();
        const sync = syncCoordinatorRef.current;
        if (sync) {
          await new SaveCoordinator(sync).afterAcknowledged(() => adapter.flushAndWait());
        } else {
          await adapter.flushAndWait();
        }
        const exportDoc = editor.getJSON() as TiptapNode;
        const diagramSources = new Map<string, {
          language: 'plantuml' | 'd2' | 'graphviz';
          code: string;
        }>();
        let usedDiagramFallback = false;
        const collectDiagrams = (node: TiptapNode): void => {
          if (node.type === 'diagram') {
            const language = typeof node.attrs?.language === 'string'
              ? node.attrs.language.toLowerCase()
              : 'mermaid';
            const code = typeof node.attrs?.code === 'string' ? node.attrs.code : '';
            if (language !== 'mermaid') {
              if (language === 'plantuml' || language === 'd2' || language === 'graphviz') {
                diagramSources.set(`${language}\0${code}`, { language, code });
              } else {
                usedDiagramFallback = true;
              }
            }
          }
          node.content?.forEach(collectDiagrams);
        };
        if (format === 'html') collectDiagrams(exportDoc);
        const diagramImages = new Map<string, string>();
        await Promise.all([...diagramSources.entries()].map(async ([key, source]) => {
          try {
            const controller = new AbortController();
            const rendered = await renderDiagram({
              language: source.language,
              code: source.code,
              signal: controller.signal,
            });
            if (rendered.kind === 'png') diagramImages.set(key, rendered.dataUrl);
            else usedDiagramFallback = true;
          } catch {
            usedDiagramFallback = true;
          }
        }));
        const outcome = await exportDocument(
          format as ExportFormat,
          exportDoc,
          state.settings,
          state.docSettings,
          meta,
          diagramImages,
        );
        setFileController((current) => fileOperationReducer(current, outcome === 'cancelled'
          ? {
            type: 'cancelled',
            sessionId: currentSession.sessionId,
            requestId,
          }
          : {
            type: 'succeeded',
            sessionId: currentSession.sessionId,
            requestId,
            result: usedDiagramFallback ? 'fallback' : outcome,
          }));
      } catch (error: unknown) {
        setFileController((current) => fileOperationReducer(current, {
          type: 'failed',
          sessionId: currentSession.sessionId,
          requestId,
          error: createFileOperationError(
            'EXPORT_FAILED',
            error instanceof Error ? error.message : 'Export failed.',
            true,
          ),
        }));
      }
    })();
  };
  const handleMetaChange = (field: string, value: string) => {
    setMeta(prev => ({ ...prev, [field]: value }));
    if (editor) {
      setSaveStatus('dirty');
      syncCoordinatorRef.current?.submit({
        content: normalizeDocument(dehydrateDocumentAssets(editor.getJSON() as TiptapNode), settingsRef.current),
        meta: { ...metaRef.current, [field]: value },
        documentSettings: docSettingsRef.current,
      });
    }
  };
  const handleToggleNumbering = () => { setShowNumbering(!showNumbering); };
  const handleToggleDecoration = () => {
    dispatch({ type: 'SET_SETTINGS', payload: { headingDecoration: !state.settings.headingDecoration } });
  };

  const handleRefreshTemplates = useCallback(() => {
    const requestId = crypto.randomUUID();
    catalogRequestRef.current = requestId;
    setIsTemplateCatalogLoading(true);
    void postMessage({ type: 'requestTemplateCatalog', requestId });
  }, [postMessage]);

  const currentTemplateIdentity = useCallback(() => adapter.getDocumentSession(), [adapter]);
  const handleApplyTemplate = useCallback((templateId: string) => {
    const session = currentTemplateIdentity();
    if (!session || isApplyingTemplate) return;
    const requestId = crypto.randomUUID();
    applyRequestRef.current = requestId;
    catalogRequestRef.current = `apply-refresh-${requestId}`;
    setIsApplyingTemplate(true);
    editor?.setEditable(false);
    void postMessage({
      type: 'applyTemplate',
      requestId,
      templateId,
      sessionId: session.sessionId,
      documentId: session.documentId,
      baseRevision: session.revision,
    }).catch((error: unknown) => {
      setIsApplyingTemplate(false);
      editor?.setEditable(true);
      console.error('Failed to apply template', error);
    });
  }, [currentTemplateIdentity, editor, isApplyingTemplate, postMessage]);

  const handleManagedTemplate = useCallback((
    type: 'savePersonalTemplate' | 'updatePersonalTemplate' | 'duplicatePersonalTemplate',
    template?: ManagedTemplateDescriptor,
  ) => {
    const session = currentTemplateIdentity();
    if (!session || isManagingTemplate || (template && !template.revisionToken)) return;
    const requestId = crypto.randomUUID();
    personalRequestRef.current = requestId;
    catalogRequestRef.current = `operation-${requestId}`;
    setIsManagingTemplate(true);
    void postMessage({
      type,
      requestId,
      sessionId: session.sessionId,
      documentId: session.documentId,
      baseRevision: session.revision,
      ...(template ? {
        templateId: template.id,
        revisionToken: template.revisionToken as string,
      } : {}),
    } as EditorToHostMessage);
  }, [currentTemplateIdentity, isManagingTemplate, postMessage]);

  const handleDeletePersonalTemplate = useCallback((template: ManagedTemplateDescriptor) => {
    if (isManagingTemplate || !template.revisionToken) return;
    const requestId = crypto.randomUUID();
    personalRequestRef.current = requestId;
    catalogRequestRef.current = `operation-${requestId}`;
    setIsManagingTemplate(true);
    void postMessage({
      type: 'deletePersonalTemplate',
      requestId,
      templateId: template.id,
      revisionToken: template.revisionToken,
    });
  }, [isManagingTemplate, postMessage]);

  const handleOpenPersonalTemplateFolder = useCallback(() => {
    if (isManagingTemplate) return;
    const requestId = crypto.randomUUID();
    personalRequestRef.current = requestId;
    catalogRequestRef.current = `operation-${requestId}`;
    setIsManagingTemplate(true);
    void postMessage({ type: 'openPersonalTemplateFolder', requestId });
  }, [isManagingTemplate, postMessage]);

  const handleActivityDestinationClick = useCallback((destination: ActivityDestination) => {
    activityTriggerRef.current = document.getElementById(`activity-destination-${destination}`);
    setActivityState((current) => transitionActivityDestination(
      current,
      destination,
      { showWorkspace: true, showTemplates: true },
    ));
  }, []);

  const handleCloseSidePanel = useCallback(() => {
    setActivityState((current) => selectSidePanel(
      current,
      null,
      { showWorkspace: true, showTemplates: true },
    ));
  }, []);

  const handleSidePanelSelection = useCallback((selection: SidePanelSelection) => {
    setActivityState((current) => selectSidePanel(
      current,
      selection,
      { showWorkspace: true, showTemplates: true },
    ));
  }, []);

  const handleZoomChange = useCallback((value: number) => {
    const clamped = Math.min(200, Math.max(60, value));
    setZoom(clamped);
    localStorage.setItem('sdoc-editor-zoom', String(clamped));
  }, []);

  const handleUpdateDocSettings = useCallback((settings: Partial<DocumentSettings> | null) => {
    if (settings) {
      dispatch({ type: 'SET_SETTINGS', payload: settings });
    } else {
      invoke<unknown>('get_editor_settings')
        .then((nativeSettings) => dispatch({
          type: 'SET_SETTINGS',
          payload: resolveTauriEditorSettings(nativeSettings, null),
        }))
        .catch((error: unknown) => console.warn('Failed to reload editor settings', error));
    }
    dispatch({ type: 'SET_DOC_SETTINGS', payload: settings });
    if (editor) {
      setSaveStatus('dirty');
      syncCoordinatorRef.current?.submit({
        content: normalizeDocument(dehydrateDocumentAssets(editor.getJSON() as TiptapNode), {
          ...settingsRef.current,
          ...(settings ?? {}),
        }),
        meta: metaRef.current,
        documentSettings: settings,
      });
    }
  }, [dispatch, editor]);

  const handleKeepExternal = useCallback(async () => {
    try {
      const accepted = await adapter.acceptExternalChange();
      const sync = syncCoordinatorRef.current;
      if (!sync) throw new Error('No active document synchronization session.');
      setSaveStatus('saving');
      const observed = await keepLocalThroughAcknowledgement(sync, accepted.revision);
      setExternalChange(observed
        ? { revision: observed.revision, snapshot: observed.hostSnapshot }
        : null);
      if (!observed) setShowExternalComparison(false);
    } catch (error: unknown) {
      setSaveStatus('error');
      console.error('Failed to keep local document after an external change', error);
      throw error;
    }
  }, [adapter]);

  const handleReloadExternal = useCallback(async () => {
    try {
      const accepted = await adapter.acceptExternalChange();
      await reloadExternalChangeAfterReplacement({
        sync: syncCoordinatorRef.current,
        revision: accepted.revision,
        snapshot: accepted.snapshot,
        replace: async () => {
          const hydrated = await convertImagePaths(accepted.snapshot.content);
          return replaceEditorDocument('user-reload', hydrated);
        },
      });
      setMeta(replaceMetaState(accepted.snapshot.meta));
      dispatch({ type: 'SET_DOC_SETTINGS', payload: accepted.snapshot.documentSettings });
      setExternalChange(null);
      setShowExternalComparison(false);
      setSaveStatus('saved');
    } catch (error: unknown) {
      setSaveStatus('error');
      console.error('Failed to reload an external document change', error);
      throw error;
    }
  }, [adapter, dispatch, replaceEditorDocument]);
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
  }, [setPendingImage]);
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
    const currentSession = adapter.getDocumentSession();
    const hydrationCoordinator = hydrationCoordinatorRef.current;
    if (editor && initialDoc && currentSession && !initDoneRef.current) {
      void hydrationCoordinator.hydrate(
        currentSession.sessionId,
        () => convertImagePaths(initialDoc),
        (converted) => {
          replaceEditorDocument('initial-load', converted);
          const { settings: initialDocumentSettings, ...initialPersistedMeta } = initialMeta ?? {};
          syncCoordinatorRef.current?.adoptReplacement(currentSession.revision, {
            content: initialDoc,
            meta: initialPersistedMeta,
            documentSettings: initialDocumentSettings ?? null,
          });
          initDoneRef.current = true;
          dispatch({ type: 'SET_READY', payload: true });
          editor.setEditable(true);
        },
      ).catch((error: unknown) => {
        setSaveStatus('error');
        console.error('Failed to hydrate document assets', error);
      });
    }
    return () => hydrationCoordinator.cancel();
  }, [adapter, editor, replaceEditorDocument, initialDoc, initialMeta, dispatch]);

  useEditorDomEvents(editor, handlePaste);

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
    return <div style={{ padding: '20px', textAlign: 'center' }}>{t('editor.loading')}</div>;
  }

  const menuBarMenus: MenuDef[] = [
    {
      label: t('menu.file'),
      items: [
        { label: t('explorer.newDocument'), shortcut: 'Ctrl+N', onClick: onNewDocument },
        { label: t('menu.openDocument'), shortcut: 'Ctrl+O', onClick: onOpenDocument },
        { label: t('menu.openFolder'), onClick: onSelectFolder },
        { separator: true },
        { label: t('common.save'), shortcut: 'Ctrl+S', onClick: () => flushUpdate() },
        { separator: true },
        { label: t('menu.exportAs', { format: 'HTML' }), onClick: () => handleFileOperation('export', 'html') },
        { label: t('menu.exportAs', { format: 'Markdown' }), onClick: () => handleFileOperation('export', 'markdown') },
        { label: t('menu.exportAs', { format: 'AsciiDoc' }), onClick: () => handleFileOperation('export', 'adoc') },
        { separator: true },
        { label: t('menu.importFrom', { format: 'Markdown' }), onClick: () => handleFileOperation('import', 'markdown') },
        { label: t('menu.importFrom', { format: 'HTML' }), onClick: () => handleFileOperation('import', 'html') },
        { separator: true },
        { label: t('menu.exit'), onClick: onExit, disabled: !onExit },
      ],
    },
    {
      label: t('menu.edit'),
      items: [
        { label: t('common.undo'), shortcut: 'Ctrl+Z', disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
        { label: t('menu.redo'), shortcut: 'Ctrl+Y', disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        {
          label: t(activityState.selection ? 'menu.hideSidebar' : 'menu.showSidebar'),
          onClick: () => setActivityState((current) => current.selection
            ? selectSidePanel(current, null, { showWorkspace: true, showTemplates: true })
            : selectSidePanel(current, { destination: 'workspace' }, { showWorkspace: true, showTemplates: true })),
        },
        { separator: true },
        { label: t('menu.zoomIn'), shortcut: 'Ctrl++', onClick: () => handleZoomChange(zoom + 10) },
        { label: t('menu.zoomOut'), shortcut: 'Ctrl+-', onClick: () => handleZoomChange(zoom - 10) },
        { label: t('menu.resetZoom'), shortcut: 'Ctrl+0', onClick: () => handleZoomChange(100) },
        { separator: true },
        { label: t(showNumbering ? 'panel.hideNumbering' : 'panel.showNumbering'), onClick: handleToggleNumbering },
        { label: t(state.settings.headingDecoration ? 'panel.hideDecoration' : 'panel.showDecoration'), onClick: handleToggleDecoration },
      ],
    },
    {
      label: t('menu.help'),
      items: [
        {
          label: t('menu.about'),
          onClick: () => alert(`Structured Doc Editor\n${t('menu.version', { version: appVersion || t('common.unknown') })}`),
        },
      ],
    },
  ];
  const hasLocalChanges = Boolean(syncCoordinatorRef.current
    && syncCoordinatorRef.current.state.localGeneration
      > syncCoordinatorRef.current.state.acknowledgedGeneration);
  const externalComparison = externalChange
    ? buildExternalChangeComparison(
      buildExternalDocumentDiff(
        editor.getJSON() as TiptapNode,
        externalChange.snapshot.content,
      ),
      {
        title: t('externalChange.compareTitle'),
        mine: t('externalChange.mine'),
        external: t('externalChange.external'),
      },
    )
    : null;

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
      {externalChange && (
        <ExternalChangePrompt
          isDirty={hasLocalChanges}
          onCompare={() => setShowExternalComparison(true)}
          onKeepMine={handleKeepExternal}
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
        />
      )}
      {editor && <BubbleMenuBar editor={editor} />}
      <div className={`editor-body-layout${activityState.selection ? ' editor-body-with-toc' : ''}`}>
        <ActivityBar
          activeDestination={activityState.selection?.destination ?? null}
          onDestinationClick={handleActivityDestinationClick}
          showWorkspace
        />
        {activityState.selection && (
          <SidePanel
            onClose={handleCloseSidePanel}
            selection={activityState.selection}
            onSelectionChange={handleSidePanelSelection}
            returnFocusRef={activityTriggerRef}
            editor={editor}
            settings={state.settings}
            showNumbering={showNumbering}
            onToggleNumbering={handleToggleNumbering}
            showDecoration={state.settings.headingDecoration}
            onToggleDecoration={handleToggleDecoration}
            uiLanguagePreference={state.uiLanguagePreference}
            onUiLanguagePreferenceChange={handleUiLanguagePreferenceChange}
            onUpdateDocSettings={handleUpdateDocSettings}
            onViewJson={handleViewJson}
            onFileOperation={handleFileOperation}
            fileOperationState={fileController.operationState}
            diagramRendererSettings={diagramRendererSettings}
            onDiagramRendererSettingsChange={handleDiagramRendererSettingsChange}
            onTestDiagramRenderer={handleTestDiagramRenderer}
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
            templates={templates}
            templateDiagnostics={templateDiagnostics}
            isTemplateCatalogLoading={isTemplateCatalogLoading}
            isApplyingTemplate={isApplyingTemplate}
            isManagingTemplate={isManagingTemplate}
            onRefreshTemplates={handleRefreshTemplates}
            onApplyTemplate={handleApplyTemplate}
            onSavePersonalTemplate={() => handleManagedTemplate('savePersonalTemplate')}
            onUpdatePersonalTemplate={(template) => handleManagedTemplate('updatePersonalTemplate', template)}
            onDuplicatePersonalTemplate={(template) => handleManagedTemplate('duplicatePersonalTemplate', template)}
            onDeletePersonalTemplate={handleDeletePersonalTemplate}
            onOpenPersonalTemplateFolder={handleOpenPersonalTemplateFolder}
          />
        )}
        <div ref={editorAreaRef} className="editor-content-area" onContextMenu={handleContextMenu} tabIndex={-1}>
          <div className="editor-scroll-area">
            <div style={{ zoom: zoom / 100 }}>
              <div className="editor-title-area">
                <input className="editor-title-input" value={meta.title}
                  onChange={(e) => handleMetaChange('title', e.target.value)} placeholder={t('document.titlePlaceholder')} />
              </div>
              <EditorContent editor={editor}
                className={`${showNumbering ? 'show-numbering' : 'hide-numbering'} ${state.settings.headingDecoration ? 'show-heading-decoration' : ''} ${state.settings.captionNumbering === 'hierarchical' ? 'hierarchical-numbering' : 'sequential-numbering'}`}
              />
            </div>
          </div>
          <ZoomBar zoom={zoom} onZoomChange={handleZoomChange} />
          <div className={`save-status save-status-${saveStatus}`}>
            {saveStatus === 'saving' && t('editor.saving')}
            {saveStatus === 'dirty' && t('editor.dirty')}
            {saveStatus === 'saved' && (lastSavedAt ? `${t('editor.saved')} ${lastSavedAt}` : t('editor.saved'))}
            {saveStatus === 'error' && t('editor.saveError')}
          </div>
        </div>
      </div>
      <div className="app-status-bar" title={hoveredExplorerPath ?? currentPath ?? workspaceFolder ?? undefined}>
        <FolderOpen size={12} className="app-status-bar-icon" />
        <span className="app-status-bar-path">
          {hoveredExplorerPath ?? currentPath ?? workspaceFolder ?? t('editor.noFolder')}
        </span>
      </div>
      {editorContextMenu && editor && <EditorContextMenu
        returnFocusRef={editorAreaRef}
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
      {contextMenu && editor && <TableContextMenu returnFocusRef={editorAreaRef} editor={editor} position={contextMenu} onClose={() => setContextMenu(null)} onOpenProperties={() => { setContextMenu(null); setShowTableProperties(true); }} />}
      {showTableProperties && editor && <TablePropertiesModal editor={editor} onClose={() => setShowTableProperties(false)} />}
      {pendingImage && <ImageNameDialog defaultName={`image-${Date.now()}`} onConfirm={handleImageNameConfirm} onCancel={() => setPendingImage(null)} />}
      {showDrawioActionDialog && <DrawioActionDialog onCreateNew={handleDrawioCreateNew} onImportExisting={handleDrawioImportExisting} onCancel={() => setShowDrawioActionDialog(false)} />}
      {showDrawioDialog && <DrawioNameDialog defaultName={`diagram-${Date.now()}`} onConfirm={handleDrawioNameConfirm} onCancel={() => setShowDrawioDialog(false)} />}
      {showDrawioInstallGuide && <DrawioInstallGuideDialog onClose={() => setShowDrawioInstallGuide(false)} />}
      {showLinkDialog && editor && <LinkDialog onConfirm={handleLinkConfirm} onCancel={() => setShowLinkDialog(false)} defaultText={editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')} />}
      {imageProperties && <ImagePropertiesDialog src={imageProperties.src} alt={imageProperties.alt} align={imageProperties.align} onConfirm={handleImagePropertiesConfirm} onReplace={handleImageReplace} onCancel={() => setImageProperties(null)} isDrawio={imageProperties.isDrawio} path={imageProperties.path} />}
      {imageContextMenu && <ImageContextMenu returnFocusRef={editorAreaRef} position={{ x: imageContextMenu.x, y: imageContextMenu.y }} onClose={() => setImageContextMenu(null)} onOpenProperties={handleImageContextMenuProperties} onReplaceImage={handleImageContextMenuReplace} onCopyPath={handleImageContextMenuCopyPath} onDelete={handleImageContextMenuDelete} isDrawio={imageContextMenu.isDrawio} />}
      {mathDialog && <MathDialog initialLatex={mathDialog.latex} isBlock={mathDialog.isBlock} onConfirm={handleMathConfirm} onCancel={() => setMathDialog(null)} />}
      {diagramDialog && <DiagramDialog renderDiagram={renderDiagram} initialCode={diagramDialog.code} initialLanguage={diagramDialog.language} pos={diagramDialog.pos} onConfirm={handleDiagramConfirm} onCancel={() => setDiagramDialog(null)} />}
      {showCrossRefDialog && editor && <CrossReferenceDialog targets={collectTargets(editor, settings)} onSelect={(target: RefTarget) => { setShowCrossRefDialog(false); editor.chain().focus().insertContent([{ type: 'text', marks: [{ type: 'link', attrs: { href: `#${target.id}` } }], text: target.label }, { type: 'text', text: ' ' }]).run(); }} onClose={() => setShowCrossRefDialog(false)} />}
    </div>
  );
};
