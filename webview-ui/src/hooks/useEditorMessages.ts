import { useCallback, useEffect, useReducer, useRef, useState, MutableRefObject } from 'react';
import { Editor as TiptapEditor, type JSONContent } from '@tiptap/react';
import {
  EDITABLE_CAPABILITIES,
  useEditorContext,
  resolveFontWeight,
  type EditorDocumentAccess,
} from '@shared/editor/context/EditorContext';
import { useVSCodeMessaging } from './useVSCodeMessaging';
import { preprocessImportedHtml } from '@shared/editor/utils/preprocessImportedHtml';
import { isUpdatedDrawioAsset } from '@shared/editor/drawioUpdates';
import type {
  FileOperationPreflightMessage,
  FileOperationStatusMessage,
  ImportContentMessage,
  ImportHtmlToWebviewMessage,
  ManagedTemplateDescriptor,
  PersonalTemplateMetadataInput,
} from '@shared/types/messages';
import {
  createTemplateSessionState,
  templateSessionReducer,
} from '@shared/editor/templateSession';
import {
  createFileOperationError,
  createFileOperationControllerState,
  fileOperationReducer,
  isFileOperationActive,
  type FileOperationControllerState,
  type FileOperationKind,
  type FileOperationState,
  type FileOperationResultAction,
} from '@shared/editor/fileOperations';
import type { FileExportFormat, FileImportFormat } from '@shared/editor/components/FilesPanel';
import {
  DiagramRenderError,
  hasExternalDiagramNodes,
  type HostDiagramRenderer,
} from '@shared/editor/diagram';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type ResolvedDiagramRendererConsent,
  type DiagramRendererSettings,
} from '@shared/diagramRenderer';
import type { SdocMeta, TiptapNode } from '@shared/types';
import {
  DocumentSyncCoordinator,
  SaveCoordinator,
  type DocumentMutation,
} from '@shared/persistence/DocumentSyncCoordinator';
import {
  keepLocalThroughAcknowledgement,
  reloadExternalChangeAfterReplacement,
} from '@shared/persistence/externalChangeResolution';
import type { EditorReplacementReason } from '@shared/editor/documentReplacement';
import type { UiLanguagePreference } from '@shared/editor/i18n';
import {
  createHostDocumentSaveState,
  deriveDocumentSavePresentation,
  markHostDocumentDirty,
  observeDocumentSaveState,
  type HostDocumentSaveState,
} from '@shared/editor/saveStatus';
import type { DocumentSyncState } from '@shared/persistence/DocumentSyncCoordinator';

export interface MetaState extends Partial<SdocMeta> {
  title: string;
  author: string;
  version: string;
  created: string;
  modified: string;
}

type PendingImportMessage = ImportContentMessage | ImportHtmlToWebviewMessage;
type SucceededFileOperationState = Extract<FileOperationState, { phase: 'succeeded' }>;

interface PendingResultAction {
  action: FileOperationResultAction;
  actionRequestId: string;
  resultRequestId: string;
  resultState: SucceededFileOperationState;
}

export function requiresLegacyImportConfirmation(message: PendingImportMessage): boolean {
  return message.confirmation !== 'preflight-confirmed';
}

interface FileOperationHostIdentity {
  sessionId: string;
  documentId: string;
}

/** Reconcile a trusted host-started standalone operation, including Palette starts from idle. */
export function reduceStandaloneFileOperationHostMessage(
  controller: FileOperationControllerState,
  message: FileOperationPreflightMessage | FileOperationStatusMessage,
  identity: FileOperationHostIdentity,
): FileOperationControllerState {
  if (message.sessionId !== identity.sessionId
    || (message.documentId !== undefined && message.documentId !== identity.documentId)) return controller;
  if (message.type === 'fileOperationPreflight') {
    return fileOperationReducer(controller, {
      type: 'preflight', sessionId: identity.sessionId,
      requestId: message.requestId, plan: message.plan,
    });
  }
  const state = message.state;
  if (state.phase === 'idle') return controller;
  if (state.phase === 'preflighting') {
    if (controller.operationState.phase === 'preflighting'
      && controller.operationState.requestId === state.requestId) {
      return { ...controller, operationState: state };
    }
    return fileOperationReducer(controller, {
      type: 'prepare', sessionId: identity.sessionId,
      requestId: state.requestId, intent: state.intent, stage: state.stage,
    });
  }
  if (state.phase === 'awaiting-confirmation') return controller;
  if (state.phase === 'running') {
    if (controller.operationState.phase === 'awaiting-confirmation' && state.planId) {
      return fileOperationReducer(controller, {
        type: 'execute', sessionId: identity.sessionId,
        requestId: state.requestId, planId: state.planId, stage: state.stage,
      });
    }
    if (controller.operationState.phase !== 'running'
      || controller.operationState.requestId !== state.requestId) {
      return { ...controller, operationState: state };
    }
    return fileOperationReducer(controller, {
      type: 'progress', sessionId: identity.sessionId,
      requestId: state.requestId, stage: state.stage,
    });
  }
  if (state.phase === 'succeeded') return fileOperationReducer(controller, {
    type: 'succeeded', sessionId: identity.sessionId,
    requestId: state.requestId, result: state.result, details: state.details,
  });
  if (state.phase === 'failed') return fileOperationReducer(controller, {
    type: 'failed', sessionId: identity.sessionId,
    requestId: state.requestId, error: state.error,
  });
  return fileOperationReducer(controller, {
    type: 'cancelled', sessionId: identity.sessionId, requestId: state.requestId,
  });
}

export interface ApplyImportedContentWithRollbackOptions {
  content: JSONContent;
  checkpoint: JSONContent;
  replace(content: JSONContent): boolean;
  flush(): void;
  afterAcknowledged(): Promise<void>;
  restoreSyncCheckpoint(): void;
  reportApplied(applied: boolean): Promise<unknown>;
}

/** Apply an import only when persistence acknowledges it; restore the local body on failure. */
export async function applyImportedContentWithRollback(
  options: ApplyImportedContentWithRollbackOptions,
): Promise<boolean> {
  if (!options.replace(options.content)) {
    await options.reportApplied(false);
    return false;
  }
  try {
    options.flush();
    await options.afterAcknowledged();
  } catch {
    options.replace(options.checkpoint);
    options.restoreSyncCheckpoint();
    await options.reportApplied(false);
    return false;
  }
  await options.reportApplied(true);
  return true;
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
  onShowFileOperation?: (tab: 'export' | 'import') => void;
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
  onShowFileOperation,
}: UseEditorMessagesOptions) {
  const { dispatch } = useEditorContext();
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const flushRef = useRef(flushUpdate);
  flushRef.current = flushUpdate;
  const flushPendingRef = useRef(flushPendingUpdate);
  flushPendingRef.current = flushPendingUpdate;

  const [templateSession, dispatchTemplateSession] = useReducer(
    templateSessionReducer,
    undefined,
    createTemplateSessionState,
  );
  const [fileController, setFileController] = useState<FileOperationControllerState>(
    () => createFileOperationControllerState('pending'),
  );
  const fileControllerRef = useRef(fileController);
  fileControllerRef.current = fileController;
  const updateFileController = (
    update: (current: FileOperationControllerState) => FileOperationControllerState,
  ): void => {
    const next = update(fileControllerRef.current);
    fileControllerRef.current = next;
    setFileController(next);
  };
  const pendingResultActionRef = useRef<PendingResultAction | null>(null);
  const hostAuthorizedImportRequestRef = useRef<string | null>(null);
  const [diagramRendererSettings, setDiagramRendererSettings] =
    useState<DiagramRendererSettings>({ ...DEFAULT_DIAGRAM_RENDERER_SETTINGS });
  const [pendingDiagramExportFormat, setPendingDiagramExportFormat] =
    useState<FileExportFormat | null>(null);
  const catalogBootstrappedRef = useRef(false);
  const requestCatalogRef = useRef<() => void>(() => {});
  const diagramRequestsRef = useRef(new Map<string, {
    resolve: (value: Awaited<ReturnType<HostDiagramRenderer>>) => void;
    reject: (reason: unknown) => void;
  }>());
  const diagramConsentRequestsRef = useRef(new Map<string, {
    resolve: (settings: DiagramRendererSettings) => void;
    reject: (reason: unknown) => void;
  }>());
  const [externalChange, setExternalChange] = useState<{
    revision: number;
    snapshot: DocumentMutation;
  } | null>(null);
  const [showExternalComparison, setShowExternalComparison] = useState(false);
  const accessRef = useRef<EditorDocumentAccess>({
    status: 'loading',
    capabilities: { ...EDITABLE_CAPABILITIES, editContent: false, editMetadata: false,
      editDocumentSettings: false, replaceDocument: false, manageAssets: false,
      exportDocument: false, inspectSource: false },
  });
  const pendingInvalidRecoveryRef = useRef<string | null>(null);
  const [invalidRecoveryPending, setInvalidRecoveryPending] = useState(false);
  const [invalidRecoveryError, setInvalidRecoveryError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<Readonly<DocumentSyncState> | null>(null);
  const [hostSaveState, setHostSaveState] = useState<HostDocumentSaveState | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImportMessage | null>(null);
  const unsubscribeSyncRef = useRef<(() => void) | null>(null);

  const attachSyncCoordinator = (coordinator: DocumentSyncCoordinator | null): void => {
    unsubscribeSyncRef.current?.();
    unsubscribeSyncRef.current = null;
    syncCoordinatorRef.current = coordinator;
    setSyncState(coordinator?.getSnapshot() ?? null);
    if (coordinator) {
      unsubscribeSyncRef.current = coordinator.subscribe(() => {
        setSyncState(coordinator.getSnapshot());
      });
    }
  };

  useEffect(() => () => {
    unsubscribeSyncRef.current?.();
    unsubscribeSyncRef.current = null;
  }, []);

  const publishAccess = (access: EditorDocumentAccess): void => {
    accessRef.current = access;
    dispatch({ type: 'SET_DOCUMENT_ACCESS', payload: access });
    editorRef.current?.setEditable(access.status === 'editable');
  };

  const { postMessage } = useVSCodeMessaging((message) => {
    const ed = editorRef.current;
    const flush = flushRef.current;
    const applyImportAfterAcknowledgement = (
      importMessage: PendingImportMessage,
      content: JSONContent,
    ): void => {
      const sync = syncCoordinatorRef.current;
      const checkpoint = getCurrentMutation();
      if (!sync || !checkpoint) {
        void postMessage({
          type: 'fileOperationApplied',
          requestId: importMessage.requestId,
          sessionId: importMessage.sessionId,
          documentId: importMessage.documentId,
          applied: false,
        });
        return;
      }
      void applyImportedContentWithRollback({
        content,
        checkpoint: checkpoint.content,
        replace: (next) => replaceEditorDocumentRef.current?.('user-import', next) ?? false,
        flush: () => { flush(); },
        afterAcknowledged: () => new SaveCoordinator(sync).afterAcknowledged(() => undefined),
        restoreSyncCheckpoint: () => { sync.submit(checkpoint); },
        reportApplied: (applied) => postMessage({
          type: 'fileOperationApplied',
          requestId: importMessage.requestId,
          sessionId: importMessage.sessionId,
          documentId: importMessage.documentId,
          applied,
        }),
      });
    };

    switch (message.type) {
      case 'init':
        if (initDoneRef.current && accessRef.current.status !== 'invalid-initial') break;
        dispatch({ type: 'SET_LOCALE', payload: message.locale });
        persistenceSessionRef.current = {
          sessionId: message.sessionId,
          documentId: message.documentId,
          revision: message.revision,
        };
        updateFileController(() => createFileOperationControllerState(message.sessionId));
        if (message.documentState.status === 'invalid') {
          attachSyncCoordinator(null);
          setHostSaveState(null);
          initDoneRef.current = true;
          dispatch({ type: 'SET_READY', payload: true });
          publishAccess({
            status: 'invalid-initial',
            capabilities: {
              ...EDITABLE_CAPABILITIES,
              editContent: false,
              editMetadata: false,
              editDocumentSettings: false,
              replaceDocument: false,
              manageAssets: false,
              exportDocument: false,
            },
            reason: message.documentState.reason,
            diagnostics: message.documentState.diagnostics,
            canRecoverFromLocal: false,
          });
          break;
        }
        const snapshot = message.documentState.snapshot;
        const coordinator = new DocumentSyncCoordinator({
          identity: {
            sessionId: message.sessionId,
            documentId: message.documentId,
            revision: message.revision,
          },
          send: (request) => postMessage({ type: 'edit', ...request }),
        });
        attachSyncCoordinator(coordinator);
        coordinator.adoptReplacement(message.revision, snapshot);
        setHostSaveState(createHostDocumentSaveState({
          sessionId: message.sessionId,
          documentId: message.documentId,
          revision: message.revision,
          isDirty: message.isDirty,
          modified: typeof snapshot.meta.modified === 'string' ? snapshot.meta.modified : undefined,
        }));
        setMeta(replaceMetaState(snapshot.meta));
        dispatch({
          type: 'SET_DOC_SETTINGS',
          payload: snapshot.documentSettings,
        });
        if (replaceEditorDocumentRef.current) {
          replaceEditorDocumentRef.current('initial-load', snapshot.content);
          initDoneRef.current = true;
          dispatch({ type: 'SET_READY', payload: true });
          publishAccess({ status: 'editable', capabilities: EDITABLE_CAPABILITIES });
        } else {
          dispatch({ type: 'SET_DOC', payload: snapshot.content });
          publishAccess({ status: 'editable', capabilities: EDITABLE_CAPABILITIES });
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
        dispatchTemplateSession({
          type: 'catalog-succeeded',
          requestId: message.requestId,
          templates: message.templates,
          diagnostics: message.diagnostics,
          personalRootScope: message.personalRootScope,
        });
        break;
      case 'templateCatalogFailed':
        dispatchTemplateSession({
          type: 'catalog-failed',
          requestId: message.requestId,
          error: message.error,
        });
        break;
      case 'templateApplicationFinished':
        if (message.result === 'applied') {
          dispatchTemplateSession({ type: 'action-completed', requestId: message.requestId });
        } else if (message.result === 'cancelled') {
          dispatchTemplateSession({ type: 'action-cancelled', requestId: message.requestId });
        } else {
          dispatchTemplateSession({
            type: 'action-failed', requestId: message.requestId,
            error: message.error ?? { code: 'operation-failed', message: 'The template could not be applied.' },
          });
        }
        ed?.setEditable(accessRef.current.status === 'editable');
        break;
      case 'externalInvalidDocument':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId
          || persistenceSessionRef.current.documentId !== message.documentId) break;
        persistenceSessionRef.current.revision = message.revision;
        setExternalChange(null);
        setShowExternalComparison(false);
        setInvalidRecoveryError(null);
        publishAccess({
          status: 'invalid-external',
          capabilities: {
            ...EDITABLE_CAPABILITIES,
            editContent: false,
            editMetadata: false,
            editDocumentSettings: false,
            replaceDocument: message.canRecoverFromLocal,
            manageAssets: false,
            exportDocument: false,
          },
          reason: message.reason,
          diagnostics: message.diagnostics,
          canRecoverFromLocal: message.canRecoverFromLocal,
        });
        break;
      case 'invalidDocumentRecoveryResult':
        if (pendingInvalidRecoveryRef.current !== message.requestId
          || persistenceSessionRef.current?.sessionId !== message.sessionId
          || persistenceSessionRef.current.documentId !== message.documentId) break;
        pendingInvalidRecoveryRef.current = null;
        setInvalidRecoveryPending(false);
        if (message.result === 'recovered') {
          const mutation = getCurrentMutation();
          if (mutation) syncCoordinatorRef.current?.adoptReplacement(message.revision, mutation);
          persistenceSessionRef.current.revision = message.revision;
          setHostSaveState((current) => current
            ? markHostDocumentDirty(current, message.revision, message.modified)
            : current);
          setInvalidRecoveryError(null);
          publishAccess({ status: 'editable', capabilities: EDITABLE_CAPABILITIES });
        } else {
          setInvalidRecoveryError(message.message ?? 'The invalid source could not be recovered.');
        }
        break;
      case 'templateOperationFinished':
        if (message.result === 'completed') {
          dispatchTemplateSession({
            type: 'action-completed', requestId: message.requestId, templateId: message.templateId,
          });
          if (message.operation !== 'open-folder') queueMicrotask(() => requestCatalogRef.current());
        } else if (message.result === 'cancelled') {
          dispatchTemplateSession({ type: 'action-cancelled', requestId: message.requestId });
        } else {
          dispatchTemplateSession({
            type: 'action-failed', requestId: message.requestId,
            error: message.error ?? { code: 'operation-failed', message: 'The template action could not be completed.' },
          });
        }
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
        setHostSaveState(createHostDocumentSaveState({
          sessionId: message.sessionId,
          documentId: message.documentId,
          revision: message.revision,
          isDirty: false,
          modified: message.snapshot.meta.modified,
        }));
        setMeta(replaceMetaState(message.snapshot.meta));
        dispatch({
          type: 'SET_DOC_SETTINGS',
          payload: message.snapshot.documentSettings,
        });
        setExternalChange(null);
        setShowExternalComparison(false);
        break;
      case 'requestFlush':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId
          || persistenceSessionRef.current.documentId !== message.documentId) break;
        if (!ed || !syncCoordinatorRef.current) {
          postMessage({
            type: 'flushComplete', sessionId: message.sessionId,
            documentId: message.documentId, requestId: message.requestId,
          });
          break;
        }
        flush();
        void new SaveCoordinator(syncCoordinatorRef.current).afterAcknowledged(() => {
          postMessage({
            type: 'flushComplete',
            sessionId: message.sessionId,
            documentId: message.documentId,
            requestId: message.requestId,
          });
        }).catch((error: unknown) => {
          postMessage({
            type: 'flushFailed',
            sessionId: message.sessionId,
            documentId: message.documentId,
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
          setMeta((current) => ({ ...current, modified: message.modified }));
          setHostSaveState((current) => current
            ? markHostDocumentDirty(current, message.revision, message.modified)
            : current);
        }
        break;
      case 'documentSaveState':
        setHostSaveState((current) => current
          ? observeDocumentSaveState(current, message)
          : current);
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
          && ((fileControllerRef.current.operationState.phase === 'running'
            && fileControllerRef.current.operationState.requestId === message.requestId)
            || hostAuthorizedImportRequestRef.current === message.requestId)) {
          hostAuthorizedImportRequestRef.current = null;
          if (requiresLegacyImportConfirmation(message)) {
            setPendingImport(message);
          } else {
            applyImportAfterAcknowledgement(message, message.content);
          }
        }
        break;
      case 'importHtml':
        if (ed
          && persistenceSessionRef.current?.sessionId === message.sessionId
          && persistenceSessionRef.current.documentId === message.documentId
          && ((fileControllerRef.current.operationState.phase === 'running'
            && fileControllerRef.current.operationState.requestId === message.requestId)
            || hostAuthorizedImportRequestRef.current === message.requestId)) {
          hostAuthorizedImportRequestRef.current = null;
          if (requiresLegacyImportConfirmation(message)) {
            setPendingImport(message);
          } else {
            applyImportAfterAcknowledgement(
              message,
              preprocessImportedHtml(message.html) as unknown as JSONContent,
            );
          }
        }
        break;
      case 'showFileOperation':
        onShowFileOperation?.(message.tab);
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
      case 'fileOperationPreflight':
        if (persistenceSessionRef.current?.documentId !== message.documentId) break;
        updateFileController((current) => reduceStandaloneFileOperationHostMessage(
          current,
          message,
          { sessionId: message.sessionId, documentId: message.documentId },
        ));
        break;
      case 'fileOperationStatus':
        if (message.documentId !== undefined
          && persistenceSessionRef.current?.documentId !== message.documentId) break;
        if (message.state.phase === 'running' && message.state.kind === 'import') {
          hostAuthorizedImportRequestRef.current = message.state.requestId;
        } else if (message.state.phase === 'failed'
          || message.state.phase === 'cancelled'
          || message.state.phase === 'succeeded') {
          hostAuthorizedImportRequestRef.current = null;
        }
        updateFileController((current) => {
          if (current.sessionId !== message.sessionId || message.state.phase === 'idle') return current;
          const state = message.state;
          const pending = pendingResultActionRef.current;
          if (pending && pending.actionRequestId === state.requestId) {
            if (state.phase === 'preflighting' && pending.action === 'repeat') {
              pendingResultActionRef.current = null;
              return fileOperationReducer(
                { ...current, operationState: pending.resultState },
                {
                  type: 'prepare', sessionId: message.sessionId,
                  requestId: state.requestId, intent: state.intent, stage: state.stage,
                },
              );
            }
            if (state.phase === 'running' && pending.action === 'undo') {
              return { ...current, operationState: state };
            }
            if (state.phase === 'succeeded' && pending.action === 'undo') {
              pendingResultActionRef.current = null;
              return { ...current, operationState: state };
            }
            if (state.phase === 'failed' || state.phase === 'cancelled') {
              pendingResultActionRef.current = null;
              const messageText = state.phase === 'failed'
                ? state.error.message
                : 'The result action was cancelled.';
              return fileOperationReducer(
                { ...current, operationState: pending.resultState },
                {
                  type: 'result-action-failed', sessionId: message.sessionId,
                  requestId: pending.resultRequestId,
                  error: createFileOperationError(
                    state.phase === 'failed' ? state.error.code : 'ACTION_CANCELLED',
                    messageText,
                    state.phase === 'failed' && state.error.retryable,
                  ),
                },
              );
            }
          }
          const identity = persistenceSessionRef.current;
          if (!identity) return current;
          return reduceStandaloneFileOperationHostMessage(current, message, identity);
        });
        break;
      case 'fileOperationResultActionStatus': {
        const session = persistenceSessionRef.current;
        const pending = pendingResultActionRef.current;
        if (!session
          || message.sessionId !== session.sessionId
          || message.documentId !== session.documentId
          || !pending
          || message.requestId !== pending.resultRequestId
          || message.actionRequestId !== pending.actionRequestId
          || message.action !== pending.action) break;
        pendingResultActionRef.current = null;
        const actionError = message.error;
        if (message.status === 'failed' && actionError) {
          updateFileController((current) => fileOperationReducer(
            { ...current, operationState: pending.resultState },
            {
              type: 'result-action-failed', sessionId: message.sessionId,
              requestId: pending.resultRequestId, error: actionError,
            },
          ));
        }
        break;
      }
      case 'diagramRenderResult': {
        const pending = diagramRequestsRef.current.get(message.requestId);
        if (!pending) break;
        diagramRequestsRef.current.delete(message.requestId);
        if (message.result.status === 'ready') {
          pending.resolve({
            kind: 'image',
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
      case 'diagramRendererConsentResult': {
        const pending = diagramConsentRequestsRef.current.get(message.requestId);
        if (!pending) break;
        diagramConsentRequestsRef.current.delete(message.requestId);
        if (message.result.status === 'resolved') {
          setDiagramRendererSettings(message.result.settings);
          pending.resolve(message.result.settings);
        } else {
          pending.reject(new Error(message.result.message));
        }
        break;
      }
    }
  });

  const handleViewJson = () => {
    postMessage({ type: 'viewJson' });
  };

  const handleFileOperation = (
    kind: FileOperationKind,
    format: FileExportFormat | FileImportFormat,
    skipDiagramConsent = false,
  ) => {
    const currentEditor = editorRef.current;
    if (
      kind === 'export'
      && !skipDiagramConsent
      && (format === 'html' || format === 'pdf' || format === 'slides')
      && diagramRendererSettings.consent === 'undecided'
      && currentEditor
      && hasExternalDiagramNodes(currentEditor.getJSON() as TiptapNode)
    ) {
      setPendingDiagramExportFormat(format as FileExportFormat);
      return;
    }
    const session = persistenceSessionRef.current;
    if (!session) return;
    if (isFileOperationActive(fileControllerRef.current.operationState)) return;
    const requestId = crypto.randomUUID();
    const intent = kind === 'export'
      ? { kind, format: format as FileExportFormat } as const
      : { kind, format: format as FileImportFormat } as const;
    updateFileController((current) => fileOperationReducer(current, {
      type: 'prepare', sessionId: session.sessionId, requestId, intent,
      stage: kind === 'export' ? 'Preparing export…' : 'Choose a file…',
    }));
    flushPendingRef.current();
    postMessage({
      type: 'fileOperationPrepare',
      requestId,
      sessionId: session.sessionId,
      documentId: session.documentId,
      baseRevision: syncCoordinatorRef.current?.state.acknowledgedRevision ?? session.revision,
      intent,
    });
  };

  const handleFileOperationConfirm = (planId: string): void => {
    const session = persistenceSessionRef.current;
    const state = fileControllerRef.current.operationState;
    if (!session || state.phase !== 'awaiting-confirmation' || state.plan.planId !== planId) return;
    updateFileController((current) => fileOperationReducer(current, {
      type: 'execute', sessionId: session.sessionId, requestId: state.requestId,
      planId, stage: state.intent.kind === 'export' ? 'Starting export…' : 'Applying import…',
    }));
    postMessage({
      type: 'fileOperationExecute', requestId: state.requestId,
      sessionId: session.sessionId, documentId: session.documentId, planId,
    });
  };

  const handleFileOperationCancel = (): void => {
    const session = persistenceSessionRef.current;
    const state = fileControllerRef.current.operationState;
    if (!session || (state.phase !== 'preflighting'
      && state.phase !== 'awaiting-confirmation'
      && state.phase !== 'running')) return;
    const planId = state.phase === 'awaiting-confirmation'
      ? state.plan.planId : state.phase === 'running' ? state.planId : undefined;
    postMessage({
      type: 'fileOperationCancel', requestId: state.requestId,
      sessionId: session.sessionId, documentId: session.documentId,
      ...(planId ? { planId } : {}),
    });
  };

  const handleFileOperationRetry = (): void => {
    const session = persistenceSessionRef.current;
    const state = fileControllerRef.current.operationState;
    if (!session || (state.phase !== 'failed' && state.phase !== 'cancelled') || !state.intent) return;
    const requestId = crypto.randomUUID();
    updateFileController((current) => fileOperationReducer(current, {
      type: 'retry', sessionId: session.sessionId, previousRequestId: state.requestId,
      requestId, stage: 'Preparing file operation again…',
    }));
    postMessage({
      type: 'fileOperationRetry', requestId, previousRequestId: state.requestId,
      sessionId: session.sessionId, documentId: session.documentId,
    });
  };

  const handleFileOperationResultAction = (
    action: FileOperationResultAction,
    artifactId?: string,
  ): void => {
    const session = persistenceSessionRef.current;
    const state = fileControllerRef.current.operationState;
    if (!session || state.phase !== 'succeeded' || pendingResultActionRef.current) return;
    if (action !== 'repeat' && !artifactId) return;
    const actionRequestId = crypto.randomUUID();
    pendingResultActionRef.current = {
      action,
      actionRequestId,
      resultRequestId: state.requestId,
      resultState: state,
    };
    void postMessage({
      type: 'fileOperationResultAction', requestId: state.requestId,
      actionRequestId,
      sessionId: session.sessionId, documentId: session.documentId,
      action,
      ...(artifactId ? { artifactId } : {}),
    } as Parameters<typeof postMessage>[0]).catch(() => {
      const pending = pendingResultActionRef.current;
      if (!pending || pending.actionRequestId !== actionRequestId) return;
      pendingResultActionRef.current = null;
      updateFileController((current) => fileOperationReducer(
        { ...current, operationState: pending.resultState },
        {
          type: 'result-action-failed', sessionId: session.sessionId,
          requestId: pending.resultRequestId,
          error: createFileOperationError(
            'RESULT_ACTION_TRANSPORT_FAILED',
            'The result action could not be sent to the extension host.',
            true,
          ),
        },
      ));
    });
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

  const handleRequestTemplateCatalog = useCallback(() => {
    const requestId = crypto.randomUUID();
    dispatchTemplateSession({ type: 'catalog-requested', requestId });
    void postMessage({ type: 'requestTemplateCatalog', requestId }).catch(() => {
      dispatchTemplateSession({
        type: 'catalog-failed',
        requestId,
        error: { code: 'catalog-unavailable', message: 'The template catalog could not be loaded.' },
      });
    });
  }, [postMessage]);
  requestCatalogRef.current = handleRequestTemplateCatalog;

  useEffect(() => {
    if (catalogBootstrappedRef.current) return;
    catalogBootstrappedRef.current = true;
    handleRequestTemplateCatalog();
  }, [handleRequestTemplateCatalog]);

  const handleApplyTemplate = (templateId: string) => {
    if (templateSession.action.phase === 'running') return;
    flushPendingRef.current();
    const session = persistenceSessionRef.current;
    const sync = syncCoordinatorRef.current;
    if (!session || !sync) return;
    const requestId = crypto.randomUUID();
    dispatchTemplateSession({ type: 'action-started', requestId, operation: 'apply', templateId });
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
      dispatchTemplateSession({
        type: 'action-failed', requestId,
        error: { code: 'operation-failed', message: 'The template could not be applied.' },
      });
      editorRef.current?.setEditable(true);
    });
  };

  const postIdentifiedTemplateOperation = (
    type: 'savePersonalTemplate' | 'updatePersonalTemplate' | 'duplicatePersonalTemplate',
    metadata: PersonalTemplateMetadataInput,
    template?: ManagedTemplateDescriptor,
  ) => {
    if (templateSession.action.phase === 'running') return;
    const session = persistenceSessionRef.current;
    const sync = syncCoordinatorRef.current;
    if (!session || !sync) return;
    if (type !== 'savePersonalTemplate' && (!template || !template.revisionToken)) return;
    flushPendingRef.current();
    const requestId = crypto.randomUUID();
    const operation = type === 'savePersonalTemplate'
      ? 'save' : type === 'updatePersonalTemplate' ? 'update' : 'duplicate';
    dispatchTemplateSession({ type: 'action-started', requestId, operation, templateId: template?.id });
    void new SaveCoordinator(sync).afterAcknowledged(() => {
      if (type === 'savePersonalTemplate') {
        postMessage({
          type,
          requestId,
          sessionId: session.sessionId,
          documentId: session.documentId,
          baseRevision: sync.state.acknowledgedRevision,
          metadata,
        });
        return;
      }
      if (!template?.revisionToken) return;
      postMessage({
        type,
        requestId,
        sessionId: session.sessionId,
        documentId: session.documentId,
        baseRevision: sync.state.acknowledgedRevision,
        templateId: template.id,
        revisionToken: template.revisionToken,
        metadata,
      });
    }).catch(() => {
      dispatchTemplateSession({
        type: 'action-failed', requestId,
        error: { code: 'operation-failed', message: 'The template action could not be completed.' },
      });
    });
  };

  const handleSavePersonalTemplate = (metadata: PersonalTemplateMetadataInput) =>
    postIdentifiedTemplateOperation('savePersonalTemplate', metadata);
  const handleUpdatePersonalTemplate = (template: ManagedTemplateDescriptor, metadata: PersonalTemplateMetadataInput) =>
    postIdentifiedTemplateOperation('updatePersonalTemplate', metadata, template);
  const handleDuplicatePersonalTemplate = (template: ManagedTemplateDescriptor, metadata: PersonalTemplateMetadataInput) =>
    postIdentifiedTemplateOperation('duplicatePersonalTemplate', metadata, template);
  const handleDeletePersonalTemplate = (template: ManagedTemplateDescriptor, visibleIndex: number) => {
    if (templateSession.action.phase === 'running' || !template.revisionToken) return;
    const requestId = crypto.randomUUID();
    dispatchTemplateSession({
      type: 'action-started', requestId, operation: 'delete', templateId: template.id, visibleIndex,
    });
    void postMessage({
      type: 'deletePersonalTemplate',
      requestId,
      templateId: template.id,
      revisionToken: template.revisionToken,
    }).catch(() => dispatchTemplateSession({
      type: 'action-failed', requestId,
      error: { code: 'operation-failed', message: 'The template could not be deleted.' },
    }));
  };
  const handleOpenPersonalTemplateFolder = () => {
    if (templateSession.action.phase === 'running') return;
    const requestId = crypto.randomUUID();
    dispatchTemplateSession({ type: 'action-started', requestId, operation: 'open-folder' });
    void postMessage({ type: 'openPersonalTemplateFolder', requestId }).catch(() => {
      dispatchTemplateSession({
        type: 'action-failed', requestId,
        error: { code: 'operation-failed', message: 'The template folder could not be opened.' },
      });
    });
  };

  const renderDiagram: HostDiagramRenderer = ({ language, code, signal }) => {
    if (language === 'mermaid') return Promise.resolve({ kind: 'source-only' });
    if (diagramRendererSettings.consent !== 'granted') {
      return Promise.resolve({ kind: 'source-only', reason: 'consent-required' });
    }
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
  const handleDiagramRendererConsent = (consent: ResolvedDiagramRendererConsent) => {
    const requestId = crypto.randomUUID();
    return new Promise<DiagramRendererSettings>((resolve, reject) => {
      diagramConsentRequestsRef.current.set(requestId, { resolve, reject });
      void postMessage({ type: 'resolveDiagramRendererConsent', requestId, consent }).catch((error) => {
        diagramConsentRequestsRef.current.delete(requestId);
        reject(error);
      });
    });
  };
  const handleDiagramExportConsent = async (
    consent: ResolvedDiagramRendererConsent,
  ): Promise<void> => {
    const format = pendingDiagramExportFormat;
    await handleDiagramRendererConsent(consent);
    setPendingDiagramExportFormat(null);
    if (format) handleFileOperation('export', format, true);
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

  const handleKeepLocal = async (): Promise<void> => {
    const sync = syncCoordinatorRef.current;
    if (!externalChange || !sync) {
      throw new Error('No external document change is available.');
    }
    try {
      const observed = await keepLocalThroughAcknowledgement(sync, externalChange.revision);
      setExternalChange(observed
        ? { revision: observed.revision, snapshot: observed.hostSnapshot }
        : null);
      if (!observed) setShowExternalComparison(false);
    } catch (error: unknown) {
      console.error('Failed to keep local document after an external change', error);
      throw error;
    }
  };

  const handleReloadExternal = async (): Promise<void> => {
    if (!externalChange) {
      throw new Error('No external document change is available.');
    }
    try {
      await reloadExternalChangeAfterReplacement({
        sync: syncCoordinatorRef.current,
        revision: externalChange.revision,
        snapshot: externalChange.snapshot,
        replace: () => replaceEditorDocumentRef.current?.(
          'user-reload',
          externalChange.snapshot.content,
        ) ?? false,
      });
      if (persistenceSessionRef.current) {
        persistenceSessionRef.current.revision = externalChange.revision;
      }
      setMeta(replaceMetaState(externalChange.snapshot.meta));
      dispatch({ type: 'SET_DOC_SETTINGS', payload: externalChange.snapshot.documentSettings });
      const session = persistenceSessionRef.current;
      if (session) {
        setHostSaveState(createHostDocumentSaveState({
          sessionId: session.sessionId,
          documentId: session.documentId,
          revision: externalChange.revision,
          isDirty: false,
          modified: externalChange.snapshot.meta.modified,
        }));
      }
      setExternalChange(null);
      publishAccess({ status: 'editable', capabilities: EDITABLE_CAPABILITIES });
      setShowExternalComparison(false);
    } catch (error: unknown) {
      console.error('Failed to reload an external document change', error);
      throw error;
    }
  };

  const handleRecoverInvalidDocument = (): void => {
    const session = persistenceSessionRef.current;
    const mutation = getCurrentMutation();
    if (!session || !mutation || accessRef.current.status !== 'invalid-external'
      || !accessRef.current.canRecoverFromLocal || pendingInvalidRecoveryRef.current) return;
    const requestId = crypto.randomUUID();
    pendingInvalidRecoveryRef.current = requestId;
    setInvalidRecoveryPending(true);
    setInvalidRecoveryError(null);
    postMessage({
      type: 'recoverInvalidDocument',
      requestId,
      sessionId: session.sessionId,
      documentId: session.documentId,
      baseRevision: session.revision,
      mutation,
    });
  };

  const handleRetryInvalidDocument = (): void => {
    postMessage({ type: 'ready' });
  };

  const finishPendingImport = (applied: boolean): void => {
    const message = pendingImport;
    if (!message) return;
    const session = persistenceSessionRef.current;
    const matchesCurrentOperation = session?.sessionId === message.sessionId
      && session.documentId === message.documentId
      && fileControllerRef.current.operationState.phase === 'running'
      && fileControllerRef.current.operationState.requestId === message.requestId;
    const reportApplied = (didApply: boolean): Promise<void> => postMessage({
      type: 'fileOperationApplied',
      requestId: message.requestId,
      sessionId: message.sessionId,
      documentId: message.documentId,
      applied: didApply,
    });
    if (applied && matchesCurrentOperation) {
      const content = message.type === 'importContent'
        ? message.content
        : preprocessImportedHtml(message.html) as unknown as JSONContent;
      const sync = syncCoordinatorRef.current;
      const checkpoint = getCurrentMutation();
      if (sync && checkpoint) {
        void applyImportedContentWithRollback({
          content,
          checkpoint: checkpoint.content,
          replace: (next) => replaceEditorDocumentRef.current?.('user-import', next) ?? false,
          flush: () => { flushRef.current(); },
          afterAcknowledged: () => new SaveCoordinator(sync).afterAcknowledged(() => undefined),
          restoreSyncCheckpoint: () => { sync.submit(checkpoint); },
          reportApplied,
        });
      } else {
        void reportApplied(false);
      }
    } else {
      void reportApplied(false);
    }
    setPendingImport(null);
  };

  const handleRetrySync = (): void => {
    const sync = syncCoordinatorRef.current;
    if (!sync?.state.error || sync.state.conflict || sync.state.externalChange) return;
    if (!['WRITE_FAILED', 'TRANSPORT_ERROR', 'UNKNOWN'].includes(sync.state.error.code)) return;
    sync.retry();
  };

  const savePresentation = syncState && hostSaveState
    ? deriveDocumentSavePresentation(
      syncState,
      hostSaveState,
      accessRef.current.status === 'editable' ? 'editable' : 'invalid',
    )
    : null;

  return {
    postMessage,
    handleViewJson,
    handleFileOperation,
    handleFileOperationConfirm,
    handleFileOperationCancel,
    handleFileOperationRetry,
    handleFileOperationResultAction,
    fileOperationState: fileController.operationState,
    renderDiagram,
    diagramRendererSettings,
    handleDiagramRendererSettingsChange,
    handleDiagramRendererConsent,
    pendingDiagramExportConsent: pendingDiagramExportFormat !== null,
    handleDiagramExportConsent,
    cancelDiagramExportConsent: () => setPendingDiagramExportFormat(null),
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
    confirmPendingImport: () => finishPendingImport(true),
    cancelPendingImport: () => finishPendingImport(false),
    savePresentation,
    handleRetrySync,
  };
}
