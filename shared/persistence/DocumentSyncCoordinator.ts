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

export interface DocumentComponentRevisions {
  content: number;
  metadata: number;
  settings: number;
}

export interface DocumentSyncOperationCounts {
  contentSubmissions: number;
  metadataSubmissions: number;
  settingsSubmissions: number;
  contentSnapshotsCreated: number;
  contentSnapshotsReused: number;
  mutationSnapshotsCreated: number;
  flushBarriers: number;
  /** Local no-op detection must never serialize the complete mutation. */
  localStringifyComparisons: 0;
}

export interface DocumentMutationRequest {
  sessionId: string;
  documentId: string;
  editId: string;
  baseRevision: number;
  localGeneration: number;
  componentRevisions: DocumentComponentRevisions;
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
  componentRevisions: DocumentComponentRevisions;
  localMutation: DocumentMutation | null;
  inFlight: DocumentMutationRequest | null;
  pending: {
    localGeneration: number;
    componentRevisions: DocumentComponentRevisions;
    mutation: DocumentMutation;
  } | null;
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

const EMPTY_COMPONENT_REVISIONS: DocumentComponentRevisions = Object.freeze({
  content: 0,
  metadata: 0,
  settings: 0,
});

const EMPTY_OPERATION_COUNTS: DocumentSyncOperationCounts = Object.freeze({
  contentSubmissions: 0,
  metadataSubmissions: 0,
  settingsSubmissions: 0,
  contentSnapshotsCreated: 0,
  contentSnapshotsReused: 0,
  mutationSnapshotsCreated: 0,
  flushBarriers: 0,
  localStringifyComparisons: 0,
});

const ownedImmutableSnapshots = new WeakSet<object>();

const immutableSnapshot = <T>(value: T, visited = new WeakSet<object>()): T => {
  if (value === null || typeof value !== 'object'
    || ownedImmutableSnapshots.has(value) || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) immutableSnapshot(child, visited);
  Object.freeze(value);
  ownedImmutableSnapshots.add(value);
  return value;
};

const componentValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => componentValuesEqual(entry, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
      && componentValuesEqual(leftRecord[key], rightRecord[key]));
};

const createMutationSnapshot = (mutation: DocumentMutation): DocumentMutation => immutableSnapshot({
  content: immutableSnapshot(mutation.content),
  meta: immutableSnapshot(mutation.meta),
  documentSettings: immutableSnapshot(mutation.documentSettings),
});

const reconcileMutationModified = (
  mutation: DocumentMutation,
  modified: string | undefined,
): DocumentMutation => {
  if (!modified || mutation.meta.modified === modified) return mutation;
  return Object.freeze({
    ...mutation,
    meta: immutableSnapshot({ ...mutation.meta, modified }),
  });
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
  private counts: DocumentSyncOperationCounts = EMPTY_OPERATION_COUNTS;
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
      componentRevisions: EMPTY_COMPONENT_REVISIONS,
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

  public get operationCounts(): Readonly<DocumentSyncOperationCounts> {
    return Object.freeze({ ...this.counts });
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(next: DocumentSyncState): void {
    this.current = Object.freeze(next);
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Compatibility entry point for replacement/rollback callers. Interactive
   * editor paths should use the component-specific methods below so a metadata
   * or settings change cannot accidentally recapture the document content.
   */
  public submit(mutation: DocumentMutation): number {
    const current = this.current.localMutation;
    const normalized = this.withAcknowledgedModified(mutation);
    const contentChanged = current?.content !== normalized.content;
    const metadataChanged = !current || !componentValuesEqual(current.meta, normalized.meta);
    const settingsChanged = !current
      || !componentValuesEqual(current.documentSettings, normalized.documentSettings);
    return this.submitComponents(normalized, { contentChanged, metadataChanged, settingsChanged });
  }

  public submitContent(
    content: TiptapNode,
    meta = this.current.localMutation?.meta,
    documentSettings = this.current.localMutation?.documentSettings,
  ): number {
    if (!meta || documentSettings === undefined) return this.current.localGeneration;
    const current = this.current.localMutation;
    const normalized = this.withAcknowledgedModified({ content, meta, documentSettings });
    return this.submitComponents(normalized, {
      contentChanged: current?.content !== content,
      metadataChanged: !current || !componentValuesEqual(current.meta, normalized.meta),
      settingsChanged: !current
        || !componentValuesEqual(current.documentSettings, normalized.documentSettings),
    }, 'content');
  }

  public submitMetadata(meta: Partial<SdocMeta>): number {
    const current = this.current.localMutation;
    if (!current) return this.current.localGeneration;
    const normalized = this.withAcknowledgedModified({ ...current, meta });
    return this.submitComponents(normalized, {
      contentChanged: false,
      metadataChanged: !componentValuesEqual(current.meta, normalized.meta),
      settingsChanged: false,
    }, 'metadata');
  }

  public submitDocumentSettings(documentSettings: Partial<DocumentSettings> | null): number {
    const current = this.current.localMutation;
    if (!current) return this.current.localGeneration;
    return this.submitComponents({ ...current, documentSettings }, {
      contentChanged: false,
      metadataChanged: false,
      settingsChanged: !componentValuesEqual(current.documentSettings, documentSettings),
    }, 'settings');
  }

  private withAcknowledgedModified(mutation: DocumentMutation): DocumentMutation {
    if (!this.current.acknowledgedModified) return mutation;
    return reconcileMutationModified(mutation, this.current.acknowledgedModified);
  }

  private submitComponents(
    mutation: DocumentMutation,
    changed: { contentChanged: boolean; metadataChanged: boolean; settingsChanged: boolean },
    source?: 'content' | 'metadata' | 'settings',
  ): number {
    if (!changed.contentChanged && !changed.metadataChanged && !changed.settingsChanged) {
      return this.current.localGeneration;
    }
    const current = this.current.localMutation;
    const snapshot = createMutationSnapshot({
      content: changed.contentChanged || !current ? mutation.content : current.content,
      meta: changed.metadataChanged || !current ? mutation.meta : current.meta,
      documentSettings: changed.settingsChanged || !current
        ? mutation.documentSettings
        : current.documentSettings,
    });
    const componentRevisions = Object.freeze({
      content: this.current.componentRevisions.content + Number(changed.contentChanged),
      metadata: this.current.componentRevisions.metadata + Number(changed.metadataChanged),
      settings: this.current.componentRevisions.settings + Number(changed.settingsChanged),
    });
    const localGeneration = this.current.localGeneration + 1;
    this.counts = Object.freeze({
      ...this.counts,
      contentSubmissions: this.counts.contentSubmissions + Number(source === 'content'),
      metadataSubmissions: this.counts.metadataSubmissions + Number(source === 'metadata'),
      settingsSubmissions: this.counts.settingsSubmissions + Number(source === 'settings'),
      contentSnapshotsCreated: this.counts.contentSnapshotsCreated
        + Number(changed.contentChanged),
      contentSnapshotsReused: this.counts.contentSnapshotsReused
        + Number(!changed.contentChanged),
      mutationSnapshotsCreated: this.counts.mutationSnapshotsCreated + 1,
    });
    this.publish({
      ...this.current,
      localGeneration,
      componentRevisions,
      localMutation: snapshot,
      pending: { localGeneration, componentRevisions, mutation: snapshot },
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
        ? {
            localGeneration: this.current.localGeneration,
            componentRevisions: this.current.componentRevisions,
            mutation: this.current.localMutation,
          }
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
        ? { localGeneration, componentRevisions: this.current.componentRevisions, mutation: latest }
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
    const snapshot = createMutationSnapshot(mutation);
    const previous = this.current.localMutation;
    const componentRevisions = previous
      ? Object.freeze({
          content: this.current.componentRevisions.content
            + Number(previous.content !== snapshot.content),
          metadata: this.current.componentRevisions.metadata
            + Number(!componentValuesEqual(previous.meta, snapshot.meta)),
          settings: this.current.componentRevisions.settings
            + Number(!componentValuesEqual(previous.documentSettings, snapshot.documentSettings)),
        })
      : EMPTY_COMPONENT_REVISIONS;
    this.publish({
      ...this.current,
      acknowledgedRevision: revision,
      acknowledgedModified: typeof snapshot.meta.modified === 'string'
        ? snapshot.meta.modified
        : this.current.acknowledgedModified,
      acknowledgedGeneration: this.current.localGeneration,
      componentRevisions,
      localMutation: snapshot,
      inFlight: null,
      pending: null,
      error: null,
      conflict: null,
      externalChange: null,
    });
    this.settleFlushWaiters();
  }

  public flushThrough(generation = this.current.localGeneration): Promise<void> {
    this.counts = Object.freeze({
      ...this.counts,
      flushBarriers: this.counts.flushBarriers + 1,
    });
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
      componentRevisions: this.current.pending.componentRevisions,
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
