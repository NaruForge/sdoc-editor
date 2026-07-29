import { useRef, useState, MutableRefObject } from 'react';
import { Editor as TiptapEditor, type JSONContent } from '@tiptap/react';
import { useEditorContext, resolveFontWeight } from '@shared/editor/context/EditorContext';
import { useVSCodeMessaging } from './useVSCodeMessaging';
import { preprocessImportedHtml } from '@shared/editor/utils/preprocessImportedHtml';
import { isUpdatedDrawioAsset } from '@shared/editor/drawioUpdates';
import type { ManagedTemplateDescriptor } from '@shared/types/messages';
import type { TemplateCatalogDiagnosticView } from '@shared/template/catalogView';
import {
  createFileOperationControllerState,
  fileOperationReducer,
  tryStartFileOperation,
  type FileOperationControllerState,
  type FileOperationKind,
} from '@shared/editor/fileOperations';
import type { FileExportFormat, FileImportFormat } from '@shared/editor/components/FilesPanel';
import {
  DiagramRenderError,
  type HostDiagramRenderer,
} from '@shared/editor/diagram';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type DiagramRendererSettings,
} from '@shared/diagramRenderer';
import type { SdocMeta } from '@shared/types';
import {
  DocumentSyncCoordinator,
  SaveCoordinator,
  type DocumentMutation,
} from '@shared/persistence/DocumentSyncCoordinator';
import type { EditorReplacementReason } from '@shared/editor/documentReplacement';
import type { UiLanguagePreference } from '@shared/editor/i18n';

export interface MetaState extends Partial<SdocMeta> {
  title: string;
  author: string;
  version: string;
  created: string;
  modified: string;
}

const replaceMetaState = (meta: Partial<SdocMeta>): MetaState => ({
  title: '',
  author: '',
  version: '',
  created: '',
  modified: '',
  ...meta,
});

interface UseEditorMessagesOptions {
  editor: TiptapEditor | null;
  flushUpdate: () => boolean;
  flushPendingUpdate: () => boolean;
  replaceEditorDocumentRef: MutableRefObject<(
    (reason: EditorReplacementReason, content: JSONContent) => boolean
  ) | null>;
  initDoneRef: MutableRefObject<boolean>;
  setMeta: React.Dispatch<React.SetStateAction<MetaState>>;
  persistenceSessionRef: MutableRefObject<{
    sessionId: string;
    documentId: string;
    revision: number;
    pendingFlushRequestId?: string;
  } | null>;
  syncCoordinatorRef: MutableRefObject<DocumentSyncCoordinator | null>;
  getCurrentMutation: () => DocumentMutation | null;
}

export function useEditorMessages({
  editor,
  flushUpdate,
  flushPendingUpdate,
  replaceEditorDocumentRef,
  initDoneRef,
  setMeta,
  persistenceSessionRef,
  syncCoordinatorRef,
  getCurrentMutation,
}: UseEditorMessagesOptions) {
  const { dispatch } = useEditorContext();
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const flushRef = useRef(flushUpdate);
  flushRef.current = flushUpdate;
  const flushPendingRef = useRef(flushPendingUpdate);
  flushPendingRef.current = flushPendingUpdate;

  const [templates, setTemplates] = useState<ManagedTemplateDescriptor[]>([]);
  const [templateDiagnostics, setTemplateDiagnostics] = useState<TemplateCatalogDiagnosticView[]>([]);
  const [isTemplateCatalogLoading, setIsTemplateCatalogLoading] = useState(true);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [isManagingTemplate, setIsManagingTemplate] = useState(false);
  const [personalTemplateRootScope, setPersonalTemplateRootScope] = useState<'local' | 'remote'>('local');
  const [fileController, setFileController] = useState<FileOperationControllerState>(
    () => createFileOperationControllerState('pending'),
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

  const { postMessage } = useVSCodeMessaging((message) => {
    const ed = editorRef.current;
    const flush = flushRef.current;

    switch (message.type) {
      case 'init':
        if (initDoneRef.current) break;
        dispatch({ type: 'SET_LOCALE', payload: message.locale });
        persistenceSessionRef.current = {
          sessionId: message.sessionId,
          documentId: message.documentId,
          revision: message.revision,
        };
        setFileController(createFileOperationControllerState(message.sessionId));
        syncCoordinatorRef.current = new DocumentSyncCoordinator({
          identity: {
            sessionId: message.sessionId,
            documentId: message.documentId,
            revision: message.revision,
          },
          send: (request) => postMessage({ type: 'edit', ...request }),
        });
        syncCoordinatorRef.current.adoptReplacement(message.revision, message.snapshot);
        setMeta(replaceMetaState(message.snapshot.meta));
        dispatch({
          type: 'SET_DOC_SETTINGS',
          payload: message.snapshot.documentSettings,
        });
        if (replaceEditorDocumentRef.current) {
          replaceEditorDocumentRef.current('initial-load', message.snapshot.content);
          initDoneRef.current = true;
          dispatch({ type: 'SET_READY', payload: true });
          ed?.setEditable(!message.readOnlyReason);
        } else {
          dispatch({ type: 'SET_DOC', payload: message.snapshot.content });
        }
        break;
      case 'uiLanguageChanged':
        dispatch({
          type: 'SET_UI_LANGUAGE',
          payload: {
            preference: message.preference,
            detectedLanguage: message.locale,
          },
        });
        break;
      case 'templateCatalog':
        if (message.requestId !== catalogRequestRef.current) break;
        setTemplates(message.templates);
        setTemplateDiagnostics(message.diagnostics);
        setPersonalTemplateRootScope(message.personalRootScope);
        setIsTemplateCatalogLoading(false);
        break;
      case 'templateApplicationFinished':
        if (message.requestId !== applyRequestRef.current) break;
        applyRequestRef.current = null;
        setIsApplyingTemplate(false);
        ed?.setEditable(true);
        break;
      case 'templateOperationFinished':
        if (message.requestId !== personalRequestRef.current) break;
        personalRequestRef.current = null;
        setIsManagingTemplate(false);
        break;
      case 'externalChange':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId
          || persistenceSessionRef.current.documentId !== message.documentId) break;
        if (syncCoordinatorRef.current?.observeExternalChange(message.revision, message.snapshot)) {
          setExternalChange({ revision: message.revision, snapshot: message.snapshot });
        }
        break;
      case 'replaceDocument':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId
          || persistenceSessionRef.current.documentId !== message.documentId) break;
        replaceEditorDocumentRef.current?.(message.reason, message.snapshot.content);
        syncCoordinatorRef.current?.adoptReplacement(message.revision, message.snapshot);
        persistenceSessionRef.current.revision = message.revision;
        setMeta(replaceMetaState(message.snapshot.meta));
        dispatch({
          type: 'SET_DOC_SETTINGS',
          payload: message.snapshot.documentSettings,
        });
        setExternalChange(null);
        setShowExternalComparison(false);
        break;
      case 'requestFlush':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId) break;
        if (!ed || !syncCoordinatorRef.current) {
          postMessage({ type: 'flushComplete', sessionId: message.sessionId, requestId: message.requestId });
          break;
        }
        flush();
        void new SaveCoordinator(syncCoordinatorRef.current).afterAcknowledged(() => {
          postMessage({
            type: 'flushComplete',
            sessionId: message.sessionId,
            requestId: message.requestId,
          });
        }).catch((error: unknown) => {
          postMessage({
            type: 'flushFailed',
            sessionId: message.sessionId,
            requestId: message.requestId,
            code: syncCoordinatorRef.current?.state.error?.code ?? 'UNKNOWN',
            message: error instanceof Error ? error.message : String(error),
          });
        });
        break;
      case 'editAcknowledged':
        if (syncCoordinatorRef.current?.acknowledge(message)) {
          if (persistenceSessionRef.current) {
            persistenceSessionRef.current.revision = message.revision;
          }
          const observed = syncCoordinatorRef.current.state.externalChange;
          setExternalChange(observed
            ? { revision: observed.revision, snapshot: observed.hostSnapshot }
            : null);
          if (!observed) setShowExternalComparison(false);
        }
        break;
      case 'editRejected':
        if (syncCoordinatorRef.current?.reject(message)) {
          const observed = syncCoordinatorRef.current.state.externalChange;
          if (observed) {
            setExternalChange({ revision: observed.revision, snapshot: observed.hostSnapshot });
          }
        }
        break;
      case 'settingsChanged': {
        const s = { ...message.settings };
        if (typeof s.fontWeightBody === 'string') s.fontWeightBody = resolveFontWeight(s.fontWeightBody);
        if (typeof s.fontWeightBold === 'string') s.fontWeightBold = resolveFontWeight(s.fontWeightBold);
        if (typeof s.fontWeightH1 === 'string') s.fontWeightH1 = resolveFontWeight(s.fontWeightH1);
        if (typeof s.fontWeightH2 === 'string') s.fontWeightH2 = resolveFontWeight(s.fontWeightH2);
        if (typeof s.fontWeightH3 === 'string') s.fontWeightH3 = resolveFontWeight(s.fontWeightH3);
        dispatch({ type: 'SET_SETTINGS', payload: s });
        break;
      }
      case 'docSettingsChanged':
        dispatch({ type: 'SET_DOC_SETTINGS', payload: message.docSettings ?? null });
        break;
      case 'documentSettingSelected': {
        const current = getCurrentMutation();
        if (!current) break;
        const nextSettings = { ...(current.documentSettings ?? {}) };
        if (message.value === null) delete nextSettings[message.key];
        else nextSettings[message.key] = message.value;
        const documentSettings = Object.keys(nextSettings).length > 0 ? nextSettings : null;
        dispatch({ type: 'SET_DOC_SETTINGS', payload: documentSettings });
        if (message.value !== null) {
          dispatch({ type: 'SET_SETTINGS', payload: { [message.key]: message.value } });
        }
        syncCoordinatorRef.current?.submit({ ...current, documentSettings });
        break;
      }
      case 'metaUpdate':
        setMeta(prev => ({ ...prev, ...message.meta }));
        break;
      case 'importContent':
        if (ed
          && persistenceSessionRef.current?.sessionId === message.sessionId
          && persistenceSessionRef.current.documentId === message.documentId
          && fileController.operationState.phase === 'running'
          && fileController.operationState.requestId === message.requestId) {
          if (!window.confirm('Importing this file will replace the current document. Continue?')) {
            postMessage({
              type: 'fileOperationApplied',
              requestId: message.requestId,
              sessionId: message.sessionId,
              documentId: message.documentId,
              applied: false,
            });
            break;
          }
          replaceEditorDocumentRef.current?.('user-import', message.content);
          flush();
          postMessage({
            type: 'fileOperationApplied',
            requestId: message.requestId,
            sessionId: message.sessionId,
            documentId: message.documentId,
            applied: true,
          });
        }
        break;
      case 'importHtml':
        if (ed
          && persistenceSessionRef.current?.sessionId === message.sessionId
          && persistenceSessionRef.current.documentId === message.documentId
          && fileController.operationState.phase === 'running'
          && fileController.operationState.requestId === message.requestId) {
          if (!window.confirm('Importing this file will replace the current document. Continue?')) {
            postMessage({
              type: 'fileOperationApplied',
              requestId: message.requestId,
              sessionId: message.sessionId,
              documentId: message.documentId,
              applied: false,
            });
            break;
          }
          const cleaned = preprocessImportedHtml(message.html);
          replaceEditorDocumentRef.current?.('user-import', cleaned as unknown as JSONContent);
          flush();
          postMessage({
            type: 'fileOperationApplied',
            requestId: message.requestId,
            sessionId: message.sessionId,
            documentId: message.documentId,
            applied: true,
          });
        }
        break;
      case 'imageSaved':
        if (ed && message.webviewUri) {
          ed.chain().focus().setImage({
            src: message.webviewUri,
            alt: message.imageName || '',
          }).run();
          flush();
        }
        break;
      case 'drawioCreated':
        if (ed && message.webviewUri) {
          ed.chain().focus().setImage({
            src: message.webviewUri,
            alt: message.fileName || 'diagram',
            title: message.fileName || 'diagram',
          }).run();
          flush();
        }
        break;
      case 'imageInserted':
        if (ed && message.webviewUri) {
          ed.chain().focus().setImage({
            src: message.webviewUri,
            alt: message.fileName || 'image',
          }).run();
          flush();
        }
        break;
      case 'drawioFileUpdated':
        if (ed && message.relativePath && message.newWebviewUri) {
          ed.chain().command(({ tr }) => {
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
        if (ed && message.webviewUri && typeof message.pos === 'number') {
          ed.chain().focus().command(({ tr }) => {
            const node = tr.doc.nodeAt(message.pos);
            if (node && node.type.name === 'image') {
              tr.setNodeMarkup(message.pos, undefined, {
                ...node.attrs,
                src: message.webviewUri,
              });
            }
            return true;
          }).run();
          flush();
        }
        break;
      case 'fileOperationStatus':
        setFileController((current) => {
          if (current.sessionId !== message.sessionId
            || message.state.phase === 'idle'
            || message.state.phase === 'running') {
            return current;
          }
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
          pending.resolve({
            kind: 'png',
            dataUrl: message.result.dataUrl,
          });
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
    }
  });

  const handleViewJson = () => {
    postMessage({ type: 'viewJson' });
  };

  const handleFileOperation = (
    kind: FileOperationKind,
    format: FileExportFormat | FileImportFormat,
  ) => {
    const session = persistenceSessionRef.current;
    if (!session) return;
    const requestId = crypto.randomUUID();
    const start = tryStartFileOperation(fileController, {
      sessionId: session.sessionId,
      requestId,
      kind,
      format,
      stage: kind === 'export' ? 'Preparing export...' : 'Choose a file...',
    });
    if (!start.accepted) return;
    setFileController(start.state);
    if (kind === 'export') {
      postMessage({
        type: 'export',
        requestId,
        sessionId: session.sessionId,
        documentId: session.documentId,
        format: format as FileExportFormat,
      });
    } else {
      postMessage({
        type: format === 'markdown' ? 'importMarkdown' : 'importHtml',
        requestId,
        sessionId: session.sessionId,
        documentId: session.documentId,
      });
    }
  };

  const handleMetaChange = (field: string, value: string) => {
    setMeta(prev => ({ ...prev, [field]: value }));
    const current = getCurrentMutation();
    if (current) {
      syncCoordinatorRef.current?.submit({
        ...current,
        meta: { ...current.meta, [field]: value },
      });
    }
  };

  const handleRequestTemplateCatalog = () => {
    const requestId = crypto.randomUUID();
    catalogRequestRef.current = requestId;
    setIsTemplateCatalogLoading(true);
    postMessage({ type: 'requestTemplateCatalog', requestId });
  };

  const handleApplyTemplate = (templateId: string) => {
    if (isApplyingTemplate) return;
    flushPendingRef.current();
    const session = persistenceSessionRef.current;
    const sync = syncCoordinatorRef.current;
    if (!session || !sync) return;
    setIsApplyingTemplate(true);
    const requestId = crypto.randomUUID();
    applyRequestRef.current = requestId;
    catalogRequestRef.current = `apply-refresh-${requestId}`;
    editorRef.current?.setEditable(false);
    void new SaveCoordinator(sync).afterAcknowledged(() => {
      postMessage({
        type: 'applyTemplate',
        requestId,
        templateId,
        sessionId: session.sessionId,
        documentId: session.documentId,
        baseRevision: sync.state.acknowledgedRevision,
      });
    }).catch(() => {
      setIsApplyingTemplate(false);
      editorRef.current?.setEditable(true);
    });
  };

  const postIdentifiedTemplateOperation = (
    type: 'savePersonalTemplate' | 'updatePersonalTemplate' | 'duplicatePersonalTemplate',
    template?: ManagedTemplateDescriptor,
  ) => {
    if (isManagingTemplate) return;
    const session = persistenceSessionRef.current;
    const sync = syncCoordinatorRef.current;
    if (!session || !sync) return;
    if (type !== 'savePersonalTemplate' && (!template || !template.revisionToken)) return;
    flushPendingRef.current();
    setIsManagingTemplate(true);
    void new SaveCoordinator(sync).afterAcknowledged(() => {
      if (type === 'savePersonalTemplate') {
        const requestId = crypto.randomUUID();
        personalRequestRef.current = requestId;
        catalogRequestRef.current = `operation-${requestId}`;
        postMessage({
          type,
          requestId,
          sessionId: session.sessionId,
          documentId: session.documentId,
          baseRevision: sync.state.acknowledgedRevision,
        });
        return;
      }
      if (!template?.revisionToken) return;
      const requestId = crypto.randomUUID();
      personalRequestRef.current = requestId;
      catalogRequestRef.current = `operation-${requestId}`;
      postMessage({
        type,
        requestId,
        sessionId: session.sessionId,
        documentId: session.documentId,
        baseRevision: sync.state.acknowledgedRevision,
        templateId: template.id,
        revisionToken: template.revisionToken,
      });
    }).catch(() => {
      setIsManagingTemplate(false);
    });
  };

  const handleSavePersonalTemplate = () =>
    postIdentifiedTemplateOperation('savePersonalTemplate');
  const handleUpdatePersonalTemplate = (template: ManagedTemplateDescriptor) =>
    postIdentifiedTemplateOperation('updatePersonalTemplate', template);
  const handleDuplicatePersonalTemplate = (template: ManagedTemplateDescriptor) =>
    postIdentifiedTemplateOperation('duplicatePersonalTemplate', template);
  const handleDeletePersonalTemplate = (template: ManagedTemplateDescriptor) => {
    if (isManagingTemplate || !template.revisionToken) return;
    setIsManagingTemplate(true);
    const requestId = crypto.randomUUID();
    personalRequestRef.current = requestId;
    catalogRequestRef.current = `operation-${requestId}`;
    postMessage({
      type: 'deletePersonalTemplate',
      requestId,
      templateId: template.id,
      revisionToken: template.revisionToken,
    });
  };
  const handleOpenPersonalTemplateFolder = () => {
    if (isManagingTemplate) return;
    setIsManagingTemplate(true);
    const requestId = crypto.randomUUID();
    personalRequestRef.current = requestId;
    catalogRequestRef.current = `operation-${requestId}`;
    postMessage({ type: 'openPersonalTemplateFolder', requestId });
  };

  const renderDiagram: HostDiagramRenderer = ({ language, code, signal }) => {
    if (language === 'mermaid') return Promise.resolve({ kind: 'source-only' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        diagramRequestsRef.current.delete(requestId);
        postMessage({ type: 'cancelDiagramRender', requestId });
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
      postMessage({ type: 'renderDiagram', requestId, language, source: code });
    });
  };

  const handleDiagramRendererSettingsChange = (settings: DiagramRendererSettings) => {
    postMessage({ type: 'updateDiagramRendererSettings', settings });
  };
  const handleUiLanguagePreferenceChange = (preference: UiLanguagePreference) => {
    postMessage({ type: 'updateUiLanguage', preference });
  };
  const handleTestDiagramRenderer = (settings: DiagramRendererSettings) => {
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      diagramRequestsRef.current.set(requestId, {
        resolve: () => resolve(),
        reject,
      });
      postMessage({ type: 'testDiagramRendererConnection', requestId, settings });
    });
  };

  const handleKeepLocal = () => {
    if (!externalChange) return;
    syncCoordinatorRef.current?.keepLocal(externalChange.revision);
    if (persistenceSessionRef.current) {
      persistenceSessionRef.current.revision = externalChange.revision;
    }
    setExternalChange(null);
    setShowExternalComparison(false);
  };

  const handleReloadExternal = () => {
    if (!externalChange) return;
    replaceEditorDocumentRef.current?.('user-reload', externalChange.snapshot.content);
    syncCoordinatorRef.current?.adoptReplacement(externalChange.revision, externalChange.snapshot);
    if (persistenceSessionRef.current) {
      persistenceSessionRef.current.revision = externalChange.revision;
    }
    setMeta(replaceMetaState(externalChange.snapshot.meta));
    dispatch({ type: 'SET_DOC_SETTINGS', payload: externalChange.snapshot.documentSettings });
    setExternalChange(null);
    setShowExternalComparison(false);
  };

  return {
    postMessage,
    handleViewJson,
    handleFileOperation,
    fileOperationState: fileController.operationState,
    renderDiagram,
    diagramRendererSettings,
    handleDiagramRendererSettingsChange,
    handleUiLanguagePreferenceChange,
    handleTestDiagramRenderer,
    handleMetaChange,
    handleRequestTemplateCatalog,
    handleApplyTemplate,
    handleSavePersonalTemplate,
    handleUpdatePersonalTemplate,
    handleDuplicatePersonalTemplate,
    handleDeletePersonalTemplate,
    handleOpenPersonalTemplateFolder,
    templates,
    templateDiagnostics,
    isTemplateCatalogLoading,
    isApplyingTemplate,
    isManagingTemplate,
    personalTemplateRootScope,
    externalChange,
    showExternalComparison,
    setShowExternalComparison,
    handleKeepLocal,
    handleReloadExternal,
  };
}
