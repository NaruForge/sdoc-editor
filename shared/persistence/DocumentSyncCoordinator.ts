import type { DocumentSettings, SdocMeta, TiptapNode } from '../types';
import { areDocumentMutationsSemanticallyEqual } from '../editor/externalChanges/mutationDiff';

export interface DocumentSyncIdentity {
  sessionId: string;
  documentId: string;
  revision: number;
}

export interface DocumentMutation {
  content: TiptapNode;
  meta: Partial<SdocMeta>;
  documentSettings: Partial<DocumentSettings> | null;
}

export interface DocumentMutationRequest {
  sessionId: string;
  documentId: string;
  editId: string;
  baseRevision: number;
  localGeneration: number;
  mutation: DocumentMutation;
}

export interface DocumentMutationResponseIdentity {
  sessionId: string;
  documentId: string;
  editId: string;
  revision: number;
}

export interface DocumentMutationAcknowledgement extends DocumentMutationResponseIdentity {
  modified: string;
}

export type DocumentMutationErrorCode =
  | 'STALE_REVISION'
  | 'EXTERNAL_CHANGE'
  | 'INVALID_DOCUMENT'
  | 'WRITE_FAILED'
  | 'TRANSPORT_ERROR'
  | 'UNKNOWN';

export interface DocumentMutationRejection extends DocumentMutationResponseIdentity {
  code: DocumentMutationErrorCode;
  message: string;
  hostSnapshot?: DocumentMutation;
}

export interface DocumentSyncError {
  editId: string;
  localGeneration: number;
  code: DocumentMutationErrorCode;
  message: string;
}

export interface DocumentSyncConflict extends DocumentSyncError {
  hostRevision: number;
  hostSnapshot: DocumentMutation;
}

export interface DocumentSyncState {
  sessionId: string;
  documentId: string;
  acknowledgedRevision: number;
  acknowledgedModified?: string;
  localGeneration: number;
  acknowledgedGeneration: number;
  localMutation: DocumentMutation | null;
  inFlight: DocumentMutationRequest | null;
  pending: { localGeneration: number; mutation: DocumentMutation } | null;
  error: DocumentSyncError | null;
  conflict: DocumentSyncConflict | null;
  externalChange: { revision: number; hostSnapshot: DocumentMutation } | null;
}

interface FlushWaiter {
  generation: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface DocumentSyncCoordinatorOptions {
  identity: DocumentSyncIdentity;
  send: (request: DocumentMutationRequest) => void | Promise<void>;
  createEditId?: () => string;
}

const mutationsEqual = (left: DocumentMutation | null, right: DocumentMutation): boolean =>
  left !== null && JSON.stringify(left) === JSON.stringify(right);

const reconcileMutationModified = (
  mutation: DocumentMutation,
  modified: string | undefined,
): DocumentMutation => {
  if (!modified || mutation.meta.modified === modified) return mutation;
  return {
    ...mutation,
    meta: { ...mutation.meta, modified },
  };
};

export function readDocumentMutationBestEffort(
  reader: () => DocumentMutation,
): DocumentMutation | undefined {
  try {
    return reader();
  } catch {
    return undefined;
  }
}

/**
 * Host-neutral, snapshot-based persistence state machine.
 *
 * The editor remains the source of truth while it is editable. This coordinator
 * serializes persistence without ever applying a host snapshot back to the editor.
 */
export class DocumentSyncCoordinator {
  private readonly send: DocumentSyncCoordinatorOptions['send'];
  private readonly createEditId: () => string;
  private readonly flushWaiters = new Set<FlushWaiter>();
  private readonly listeners = new Set<() => void>();
  private current: DocumentSyncState;

  public constructor(options: DocumentSyncCoordinatorOptions) {
    this.send = options.send;
    this.createEditId = options.createEditId ?? (() => crypto.randomUUID());
    this.current = Object.freeze({
      sessionId: options.identity.sessionId,
      documentId: options.identity.documentId,
      acknowledgedRevision: options.identity.revision,
      localGeneration: 0,
      acknowledgedGeneration: 0,
      localMutation: null,
      inFlight: null,
      pending: null,
      error: null,
      conflict: null,
      externalChange: null,
    });
  }

  public get state(): Readonly<DocumentSyncState> {
    return this.current;
  }

  public getSnapshot = (): Readonly<DocumentSyncState> => this.current;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(next: DocumentSyncState): void {
    this.current = Object.freeze(next);
    this.listeners.forEach((listener) => listener());
  }

  public submit(mutation: DocumentMutation): number {
    if (mutationsEqual(this.current.localMutation, mutation)) {
      return this.current.localGeneration;
    }

    const localGeneration = this.current.localGeneration + 1;
    this.publish({
      ...this.current,
      localGeneration,
      localMutation: mutation,
      pending: { localGeneration, mutation },
    });
    this.dispatchNext();
    return localGeneration;
  }

  public acknowledge(message: DocumentMutationAcknowledgement): boolean {
    const inFlight = this.matchInFlight(message);
    if (!inFlight || message.revision <= inFlight.baseRevision) return false;
    const remainingExternalChange = this.current.externalChange
      && this.current.externalChange.revision > message.revision
      ? this.current.externalChange
      : null;
    const localMutation = this.current.localMutation
      ? reconcileMutationModified(this.current.localMutation, message.modified)
      : null;
    const pending = this.current.pending
      ? {
          ...this.current.pending,
          mutation: reconcileMutationModified(
            this.current.pending.mutation,
            message.modified,
          ),
        }
      : null;

    this.publish({
      ...this.current,
      acknowledgedRevision: message.revision,
      acknowledgedModified: message.modified,
      acknowledgedGeneration: Math.max(
        this.current.acknowledgedGeneration,
        inFlight.localGeneration,
      ),
      localMutation,
      inFlight: null,
      pending,
      error: null,
      conflict: null,
      externalChange: remainingExternalChange,
    });
    this.settleFlushWaiters();
    this.dispatchNext();
    return true;
  }

  public reject(message: DocumentMutationRejection): boolean {
    const inFlight = this.matchInFlight(message);
    if (!inFlight) return false;

    const error: DocumentSyncError = {
      editId: inFlight.editId,
      localGeneration: inFlight.localGeneration,
      code: message.code,
      message: message.message,
    };
    const latest = this.current.pending
      ?? (this.current.localMutation
        ? { localGeneration: this.current.localGeneration, mutation: this.current.localMutation }
        : null);
    const isConflict = Boolean(
      message.hostSnapshot
      && (message.code === 'EXTERNAL_CHANGE' || message.code === 'STALE_REVISION'),
    );
    this.publish({
      ...this.current,
      inFlight: null,
      pending: latest,
      error,
      conflict: isConflict && message.hostSnapshot
        ? { ...error, hostRevision: message.revision, hostSnapshot: message.hostSnapshot }
        : null,
      externalChange: isConflict && message.hostSnapshot
        ? { revision: message.revision, hostSnapshot: message.hostSnapshot }
        : this.current.externalChange,
    });
    this.rejectFlushWaiters(error);
    return true;
  }

  /**
   * Explicit retry/keep-mine boundary. A host revision may be adopted only as
   * part of the user's conflict decision; rejection itself never advances it.
   */
  public retry(options: { revision?: number } = {}): void {
    if (!this.current.error) return;
    this.publish({
      ...this.current,
      ...(options.revision === undefined
        ? {}
        : { acknowledgedRevision: options.revision }),
      error: null,
      conflict: null,
      externalChange: null,
    });
    this.dispatchNext();
  }

  public observeExternalChange(revision: number, hostSnapshot: DocumentMutation): boolean {
    if (revision <= this.current.acknowledgedRevision) return false;
    if (this.current.localMutation
      && areDocumentMutationsSemanticallyEqual(this.current.localMutation, hostSnapshot)) {
      const remainingExternalChange = this.current.externalChange
        && this.current.externalChange.revision > revision
        ? this.current.externalChange
        : null;
      this.publish({
        ...this.current,
        acknowledgedRevision: revision,
        externalChange: remainingExternalChange,
      });
      this.dispatchNext();
      return false;
    }
    this.publish({
      ...this.current,
      externalChange: { revision, hostSnapshot },
    });
    return true;
  }

  /** Advances across a host-verified representation-only document edit. */
  public advanceAcknowledgedRevision(revision: number): boolean {
    if (revision <= this.current.acknowledgedRevision) return false;
    const remainingExternalChange = this.current.externalChange
      && this.current.externalChange.revision > revision
      ? this.current.externalChange
      : null;
    this.publish({
      ...this.current,
      acknowledgedRevision: revision,
      externalChange: remainingExternalChange,
    });
    this.dispatchNext();
    return true;
  }

  /** User chose “keep mine”; rebase and send the newest editor snapshot. */
  public keepLocal(revision: number): number {
    const latest = this.current.localMutation;
    const localGeneration = latest
      ? this.current.localGeneration + 1
      : this.current.localGeneration;
    this.publish({
      ...this.current,
      acknowledgedRevision: revision,
      localGeneration,
      inFlight: null,
      pending: latest
        ? { localGeneration, mutation: latest }
        : null,
      error: null,
      conflict: null,
      externalChange: null,
    });
    this.dispatchNext();
    return localGeneration;
  }

  /** User chose reload/template; reset persistence state to that explicit snapshot. */
  public adoptReplacement(revision: number, mutation: DocumentMutation): void {
    this.publish({
      ...this.current,
      acknowledgedRevision: revision,
      acknowledgedModified: typeof mutation.meta.modified === 'string'
        ? mutation.meta.modified
        : this.current.acknowledgedModified,
      acknowledgedGeneration: this.current.localGeneration,
      localMutation: mutation,
      inFlight: null,
      pending: null,
      error: null,
      conflict: null,
      externalChange: null,
    });
    this.settleFlushWaiters();
  }

  public flushThrough(generation = this.current.localGeneration): Promise<void> {
    if (generation <= this.current.acknowledgedGeneration) return Promise.resolve();
    if (this.current.error) return Promise.reject(new Error(this.current.error.message));

    return new Promise<void>((resolve, reject) => {
      this.flushWaiters.add({ generation, resolve, reject });
    });
  }

  private matchInFlight(
    message: DocumentMutationResponseIdentity,
  ): DocumentMutationRequest | null {
    const inFlight = this.current.inFlight;
    if (!inFlight
      || message.sessionId !== this.current.sessionId
      || message.documentId !== this.current.documentId
      || message.editId !== inFlight.editId) {
      return null;
    }
    return inFlight;
  }

  private dispatchNext(): void {
    if (this.current.inFlight
      || this.current.error
      || this.current.externalChange
      || !this.current.pending) return;

    const request: DocumentMutationRequest = {
      sessionId: this.current.sessionId,
      documentId: this.current.documentId,
      editId: this.createEditId(),
      baseRevision: this.current.acknowledgedRevision,
      localGeneration: this.current.pending.localGeneration,
      mutation: this.current.pending.mutation,
    };
    this.publish({ ...this.current, inFlight: request, pending: null });

    try {
      const result = this.send(request);
      if (result && typeof result.then === 'function') {
        void result.catch((reason: unknown) => {
          this.reject({
            sessionId: request.sessionId,
            documentId: request.documentId,
            editId: request.editId,
            revision: request.baseRevision,
            code: 'TRANSPORT_ERROR',
            message: reason instanceof Error ? reason.message : String(reason),
          });
        });
      }
    } catch (reason: unknown) {
      this.reject({
        sessionId: request.sessionId,
        documentId: request.documentId,
        editId: request.editId,
        revision: request.baseRevision,
        code: 'TRANSPORT_ERROR',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  private settleFlushWaiters(): void {
    for (const waiter of this.flushWaiters) {
      if (waiter.generation > this.current.acknowledgedGeneration) continue;
      this.flushWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  private rejectFlushWaiters(error: DocumentSyncError): void {
    for (const waiter of this.flushWaiters) {
      this.flushWaiters.delete(waiter);
      waiter.reject(new Error(error.message));
    }
  }
}

/** Captures point-in-time save/export barriers without blocking subsequent typing. */
export class SaveCoordinator {
  public constructor(private readonly sync: DocumentSyncCoordinator) {}

  public async afterAcknowledged<T>(action: () => Promise<T> | T): Promise<T> {
    const error = this.sync.state.error;
    const canRetry = error
      && !this.sync.state.conflict
      && !this.sync.state.externalChange
      && ['WRITE_FAILED', 'TRANSPORT_ERROR', 'UNKNOWN'].includes(error.code);
    if (canRetry) this.sync.retry();
    const requestedGeneration = this.sync.state.localGeneration;
    await this.sync.flushThrough(requestedGeneration);
    return action();
  }
}
