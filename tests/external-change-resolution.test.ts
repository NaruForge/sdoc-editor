import { describe, expect, it } from 'vitest';
import {
  DocumentSyncCoordinator,
  type DocumentMutation,
  type DocumentMutationRequest,
} from '../shared/persistence/DocumentSyncCoordinator';
import {
  keepLocalThroughAcknowledgement,
  reloadExternalChangeAfterReplacement,
} from '../shared/persistence/externalChangeResolution';

const mutation = (title: string): DocumentMutation => ({
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }],
  },
  meta: { title },
  documentSettings: null,
});

const createSync = (sent: DocumentMutationRequest[]): DocumentSyncCoordinator =>
  new DocumentSyncCoordinator({
    identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
    createEditId: () => 'keep-local',
    send: (request) => { sent.push(request); },
  });

describe('external change host resolution contract', () => {
  it('keeps the conflict pending until the matching persistence acknowledgement arrives', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = createSync(sent);
    const local = mutation('local draft');
    sync.adoptReplacement(4, local);
    sync.observeExternalChange(5, mutation('external'));

    let settled = false;
    const resolution = keepLocalThroughAcknowledgement(sync, 5).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(settled).toBe(false);
    expect(sync.acknowledge({
      sessionId: 'other-session',
      documentId: 'doc-a',
      editId: 'keep-local',
      revision: 6,
    })).toBe(false);
    await Promise.resolve();
    expect(settled).toBe(false);

    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'keep-local',
      revision: 6,
    })).toBe(true);
    await expect(resolution).resolves.toBeNull();
    expect(sync.state.localMutation).toEqual(local);
  });

  it('rejects a failed keep while preserving the local draft for retry', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = createSync(sent);
    const local = mutation('local draft');
    sync.adoptReplacement(4, local);
    sync.observeExternalChange(5, mutation('external'));

    const resolution = keepLocalThroughAcknowledgement(sync, 5);
    sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'keep-local',
      revision: 5,
      code: 'WRITE_FAILED',
      message: 'private host detail',
    });

    await expect(resolution).rejects.toThrow('private host detail');
    expect(sync.state.localMutation).toEqual(local);
    expect(sync.state.acknowledgedGeneration).toBe(0);
  });

  it('adopts reload only after replacement succeeds', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = createSync(sent);
    const local = mutation('local draft');
    const external = mutation('external');
    sync.adoptReplacement(4, local);

    await expect(reloadExternalChangeAfterReplacement({
      sync,
      revision: 5,
      snapshot: external,
      replace: () => false,
    })).rejects.toThrow('could not be loaded');
    expect(sync.state.acknowledgedRevision).toBe(4);
    expect(sync.state.localMutation).toEqual(local);

    await reloadExternalChangeAfterReplacement({
      sync,
      revision: 5,
      snapshot: external,
      replace: async () => true,
    });
    expect(sync.state.acknowledgedRevision).toBe(5);
    expect(sync.state.localMutation).toEqual(external);
  });
});
