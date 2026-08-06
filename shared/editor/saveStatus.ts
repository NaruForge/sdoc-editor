import type { DocumentSyncState } from '../persistence/DocumentSyncCoordinator';
import type { DocumentSaveStateMessage } from '../types/messages';

export type DocumentSavePresentationPhase =
  | 'blocked'
  | 'conflict'
  | 'failed'
  | 'saving'
  | 'syncing'
  | 'modified'
  | 'disk-pending'
  | 'saved';

export interface HostDocumentSaveState {
  readonly sessionId: string;
  readonly documentId: string;
  readonly saveGeneration: number;
  readonly revision: number;
  readonly phase: 'dirty' | 'saving' | 'saved' | 'failed';
  readonly modified?: string;
  readonly message?: string;
}

export interface DocumentSavePresentation {
  readonly phase: DocumentSavePresentationPhase;
  readonly retryable: boolean;
  readonly message?: string;
}

export const createHostDocumentSaveState = (identity: {
  sessionId: string;
  documentId: string;
  revision: number;
  isDirty: boolean;
  modified?: string;
}): HostDocumentSaveState => Object.freeze({
  sessionId: identity.sessionId,
  documentId: identity.documentId,
  saveGeneration: 0,
  revision: identity.revision,
  phase: identity.isDirty ? 'dirty' : 'saved',
  ...(identity.modified ? { modified: identity.modified } : {}),
});

export const markHostDocumentDirty = (
  current: HostDocumentSaveState,
  revision: number,
  modified?: string,
): HostDocumentSaveState => Object.freeze({
  ...current,
  revision: Math.max(current.revision, revision),
  phase: current.phase === 'saving' ? 'saving' : 'dirty',
  ...(modified ? { modified } : {}),
  message: undefined,
});

const isTerminal = (phase: HostDocumentSaveState['phase']): boolean =>
  phase === 'saved' || phase === 'failed';

export const observeDocumentSaveState = (
  current: HostDocumentSaveState,
  message: DocumentSaveStateMessage,
): HostDocumentSaveState => {
  if (message.sessionId !== current.sessionId || message.documentId !== current.documentId) {
    return current;
  }
  if (message.saveGeneration < current.saveGeneration) return current;
  if (message.saveGeneration === current.saveGeneration && isTerminal(current.phase)) return current;
  if (message.saveGeneration === current.saveGeneration
    && current.phase !== 'saving'
    && message.phase !== current.phase) return current;
  return Object.freeze({
    sessionId: current.sessionId,
    documentId: current.documentId,
    saveGeneration: message.saveGeneration,
    revision: Math.max(current.revision, message.revision),
    phase: message.phase,
    ...(message.modified ? { modified: message.modified } : current.modified ? { modified: current.modified } : {}),
    ...(message.message ? { message: message.message } : {}),
  });
};

export const deriveDocumentSavePresentation = (
  sync: Readonly<DocumentSyncState>,
  host: HostDocumentSaveState,
  access: 'editable' | 'invalid',
): DocumentSavePresentation => {
  if (access === 'invalid') return Object.freeze({ phase: 'blocked', retryable: false });
  if (sync.conflict || sync.externalChange) return Object.freeze({ phase: 'conflict', retryable: false });
  if (sync.error) {
    const retryable = ['WRITE_FAILED', 'TRANSPORT_ERROR', 'UNKNOWN'].includes(sync.error.code);
    return Object.freeze({ phase: 'failed', retryable, message: sync.error.message });
  }
  if (host.phase === 'failed') {
    return Object.freeze({ phase: 'failed', retryable: false, ...(host.message ? { message: host.message } : {}) });
  }
  if (host.phase === 'saving') return Object.freeze({ phase: 'saving', retryable: false });
  if (sync.inFlight) return Object.freeze({ phase: 'syncing', retryable: false });
  if (sync.pending || sync.localGeneration > sync.acknowledgedGeneration) {
    return Object.freeze({ phase: 'modified', retryable: false });
  }
  if (host.phase === 'saved' && host.revision >= sync.acknowledgedRevision) {
    return Object.freeze({ phase: 'saved', retryable: false });
  }
  return Object.freeze({ phase: 'disk-pending', retryable: false });
};
