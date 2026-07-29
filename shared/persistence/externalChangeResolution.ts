import {
  type DocumentMutation,
  type DocumentSyncCoordinator,
  type DocumentSyncState,
} from './DocumentSyncCoordinator';

export type PendingExternalChange = DocumentSyncState['externalChange'];

/**
 * Rebases the local draft and resolves only after the exact queued generation is acknowledged.
 * A newer external change observed while the write is in flight is returned to the host UI.
 */
export const keepLocalThroughAcknowledgement = async (
  sync: DocumentSyncCoordinator,
  revision: number,
): Promise<PendingExternalChange> => {
  const generation = sync.keepLocal(revision);
  await sync.flushThrough(generation);
  return sync.state.externalChange;
};

export interface ReloadExternalChangeOptions {
  readonly sync?: DocumentSyncCoordinator | null;
  readonly revision: number;
  readonly snapshot: DocumentMutation;
  readonly replace: () => boolean | Promise<boolean>;
}

/**
 * Adopts an external baseline only after the editor confirms that replacement completed.
 */
export const reloadExternalChangeAfterReplacement = async ({
  sync,
  revision,
  snapshot,
  replace,
}: ReloadExternalChangeOptions): Promise<void> => {
  if (!await replace()) {
    throw new Error('The external document could not be loaded.');
  }
  sync?.adoptReplacement(revision, snapshot);
};
