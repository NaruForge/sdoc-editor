import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BookEditorWorkspace } from '@shared/editor/components/BookEditorWorkspace';
import {
  isBookWorkspaceHostMessage,
  beginBookResultAction,
  BOOK_RESULT_ACTION_IDLE_STATE,
  reduceBookFileOperationHostMessage,
  reduceBookResultActionHostMessage,
  type BookFileOperationIdentity,
  type BookFileOperationAdapter,
  type BookResultActionState,
  type BookWorkspaceCallbacks,
  type BookWorkspaceState,
} from '@shared/editor/bookWorkspace';
import {
  isBookMutationResult,
  type BookMutationResult,
} from '@shared/book/messages';
import { resolveEditorSettings } from '@shared/settingsResolver';
import { isHostToEditorMessage } from '@shared/types/messageGuards';
import {
  createFileOperationControllerState,
  fileOperationReducer,
  isFileOperationActive,
  type FileOperationControllerState,
} from '@shared/editor/fileOperations';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '@shared/editor/extensionRuntime';
import { createEditorTranslator } from '@shared/editor/i18n';
import '@shared/editor/styles/fonts.css';
import '@shared/editor/styles/editor.css';
import '@shared/editor/styles/bookEditor.css';
import 'katex/dist/katex.min.css';

const vscode = acquireVsCodeApi();

const nextRequestId = (() => {
  let sequence = 0;
  return (): string => `book-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
})();

function BookApp() {
  const [state, setState] = useState<BookWorkspaceState | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | undefined>(undefined);
  const [fileOperationController, setFileOperationController] = useState<FileOperationControllerState>(
    () => createFileOperationControllerState('book-session-pending'),
  );
  const [resultActionState, setResultActionState] = useState<BookResultActionState>(
    BOOK_RESULT_ACTION_IDLE_STATE,
  );
  const stateRef = useRef<BookWorkspaceState | null>(null);
  const pendingRequestRef = useRef<string | undefined>(undefined);
  const identityRef = useRef<BookFileOperationIdentity | undefined>(undefined);
  const resultActionRef = useRef<BookResultActionState>(BOOK_RESULT_ACTION_IDLE_STATE);

  const updateResultActionState = (next: BookResultActionState): void => {
    resultActionRef.current = next;
    setResultActionState(next);
  };

  const updatePendingRequest = (requestId?: string): void => {
    pendingRequestRef.current = requestId;
    setPendingRequestId(requestId);
  };

  useEffect(() => {
    vscode.postMessage({ type: 'bookReady' });
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (isBookWorkspaceHostMessage(event.data)) {
        const next = event.data.state;
        const identity = { sessionId: event.data.sessionId, documentId: event.data.documentId };
        const sessionChanged = identityRef.current?.sessionId !== identity.sessionId
          || identityRef.current?.documentId !== identity.documentId;
        if (sessionChanged) {
          identityRef.current = identity;
          updateResultActionState(BOOK_RESULT_ACTION_IDLE_STATE);
          setFileOperationController((current) => fileOperationReducer(current, {
            type: 'session-changed', sessionId: identity.sessionId,
          }));
        }
        if (sessionChanged || !stateRef.current || next.generation > stateRef.current.generation) {
          stateRef.current = next;
          setState(next);
          document.documentElement.lang = next.locale;
        }
        return;
      }
      if (isHostToEditorMessage(event.data)) {
        const hostMessage = event.data;
        const identity = identityRef.current;
        if (identity && hostMessage.type === 'fileOperationResultActionStatus') {
          updateResultActionState(reduceBookResultActionHostMessage(
            resultActionRef.current, hostMessage, identity,
          ));
        } else if (identity && (hostMessage.type === 'fileOperationPreflight'
          || hostMessage.type === 'fileOperationStatus')) {
          setFileOperationController((current) => reduceBookFileOperationHostMessage(
            current, hostMessage, identity,
          ));
        }
        return;
      }
      if (!isBookMutationResult(event.data)) return;
      const result: BookMutationResult = event.data;
      if (result.requestId !== pendingRequestRef.current) return;
      updatePendingRequest(undefined);
      if (result.status === 'rejected' && result.error.code === 'stale-revision') {
        vscode.postMessage({ type: 'refreshBook' });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const postMutation = useCallback((message: Record<string, unknown>): void => {
    const current = stateRef.current;
    if (!current || pendingRequestRef.current) return;
    const requestId = nextRequestId();
    updatePendingRequest(requestId);
    vscode.postMessage({ ...message, requestId, baseRevision: current.revision });
  }, []);

  const fileOperations = useMemo<BookFileOperationAdapter>(() => ({
    prepare: (request) => {
      const identity = identityRef.current;
      if (!identity) return;
      updateResultActionState(BOOK_RESULT_ACTION_IDLE_STATE);
      const ko = stateRef.current?.locale === 'ko';
      setFileOperationController((current) => fileOperationReducer(current, {
        type: 'prepare', sessionId: identity.sessionId, requestId: request.requestId,
        intent: { kind: 'export', format: request.format },
        stage: ko ? '불변 Book 스냅샷을 준비하는 중…' : 'Preparing immutable Book snapshot…',
      }));
      vscode.postMessage({ type: 'prepareBookExport', ...identity, ...request });
    },
    execute: (requestId, planId) => {
      const identity = identityRef.current;
      if (!identity) return;
      const ko = stateRef.current?.locale === 'ko';
      setFileOperationController((current) => fileOperationReducer(current, {
        type: 'execute', sessionId: identity.sessionId, requestId, planId,
        stage: ko ? '불변 Book 내보내기를 시작하는 중…' : 'Starting immutable Book export…',
      }));
      vscode.postMessage({ type: 'fileOperationExecute', ...identity, requestId, planId });
    },
    cancel: (requestId, planId) => {
      const identity = identityRef.current;
      if (!identity) return;
      vscode.postMessage({ type: 'fileOperationCancel', ...identity, requestId, ...(planId ? { planId } : {}) });
    },
    retry: (requestId, previousRequestId) => {
      const identity = identityRef.current;
      if (!identity) return;
      const ko = stateRef.current?.locale === 'ko';
      setFileOperationController((current) => fileOperationReducer(current, {
        type: 'retry', sessionId: identity.sessionId, requestId, previousRequestId,
        stage: ko ? '새 Book 스냅샷을 준비하는 중…' : 'Preparing a fresh Book snapshot…',
      }));
      vscode.postMessage({ type: 'fileOperationRetry', ...identity, requestId, previousRequestId });
    },
    resultAction: (requestId, action, artifactId) => {
      const identity = identityRef.current;
      if (!identity || resultActionRef.current.pending) return;
      const actionRequestId = nextRequestId();
      const next = beginBookResultAction(
        resultActionRef.current, requestId, actionRequestId, action,
      );
      if (next === resultActionRef.current) return;
      updateResultActionState(next);
      vscode.postMessage({
        type: 'fileOperationResultAction', ...identity,
        requestId, actionRequestId, action, ...(artifactId ? { artifactId } : {}),
      });
    },
  }), []);

  const callbacks = useMemo<BookWorkspaceCallbacks>(() => ({
    onAddDocument: () => postMutation({ type: 'addDocument' }),
    onOpenDocument: (index, nodeId) => vscode.postMessage({
      type: 'openDocument', index, ...(nodeId ? { nodeId } : {}),
    }),
    onMoveDocument: (from, to) => postMutation({ type: 'moveDocument', from, to }),
    onRemoveDocument: (index) => postMutation({ type: 'removeDocument', index }),
    onUpdateMeta: (key, value) => postMutation({ type: 'updateMeta', key, value }),
    onRefresh: () => vscode.postMessage({ type: 'refreshBook' }),
    onOpenSource: () => vscode.postMessage({ type: 'openBookSource' }),
    onOpenDiagnostic: (index) => vscode.postMessage({ type: 'openDiagnostic', index }),
    onSavePublishProfile: (profile) => postMutation({ type: 'savePublishProfile', profile }),
    onExport: (format) => {
      const current = stateRef.current;
      if (!current || current.status !== 'ready' || !current.canExport) return;
      fileOperations.prepare({
        requestId: nextRequestId(),
        baseRevision: current.revision,
        format,
        settingsFingerprint: current.settings.fingerprint,
      });
    },
  }), [fileOperations, postMutation]);

  const previewRuntime = useMemo(() => {
    const ready = state?.status === 'ready' ? state : undefined;
    return {
      ...NOOP_EDITOR_EXTENSION_RUNTIME,
      getSettings: () => resolveEditorSettings(ready?.settings.values),
      translate: createEditorTranslator(state?.locale ?? 'en'),
    };
  }, [state]);

  if (!state) {
    return <main className="book-workspace" aria-busy="true"><p role="status">Loading Book…</p></main>;
  }

  const operationState = fileOperationController.operationState;

  return <BookEditorWorkspace
    state={state}
    callbacks={callbacks}
    previewRuntime={previewRuntime}
    pending={Boolean(pendingRequestId) || isFileOperationActive(operationState)}
    operationState={operationState}
    fileOperations={fileOperations}
    resultActionState={resultActionState}
  />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BookApp /></React.StrictMode>,
);
