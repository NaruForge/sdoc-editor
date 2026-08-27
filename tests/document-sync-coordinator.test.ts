import { describe, expect, it, vi } from 'vitest';
import {
  DocumentSyncCoordinator,
  SaveCoordinator,
  readDocumentMutationBestEffort,
  type DocumentMutation,
  type DocumentMutationRequest,
} from '../shared/persistence/DocumentSyncCoordinator';

const content = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const mutation = (text: string): DocumentMutation => ({
  content: content(text),
  meta: { title: text },
  documentSettings: null,
});

describe('DocumentSyncCoordinator', () => {
  it('tracks content, metadata, and settings revisions independently without local stringify comparisons', () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: (() => {
        let id = 0;
        return () => `edit-${++id}`;
      })(),
      send: (request) => { sent.push(request); },
    });
    const initial = mutation('initial');
    sync.adoptReplacement(4, initial);

    const stringify = vi.spyOn(JSON, 'stringify');
    const metadataGeneration = sync.submitMetadata({ title: 'renamed' });
    const settingsGeneration = sync.submitDocumentSettings({ pdfScale: 80 });
    const nextContent = content('edited');
    const contentGeneration = sync.submitContent(nextContent);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();

    expect([metadataGeneration, settingsGeneration, contentGeneration]).toEqual([1, 2, 3]);
    expect(sync.state.componentRevisions).toEqual({ content: 1, metadata: 1, settings: 1 });
    expect(sync.state.localMutation?.content).toBe(nextContent);
    expect(sync.state.localMutation?.meta).toEqual({ title: 'renamed' });
    expect(sync.state.localMutation?.documentSettings).toEqual({ pdfScale: 80 });
    expect(sync.operationCounts).toEqual({
      contentSubmissions: 1,
      metadataSubmissions: 1,
      settingsSubmissions: 1,
      contentSnapshotsCreated: 1,
      contentSnapshotsReused: 2,
      mutationSnapshotsCreated: 3,
      flushBarriers: 0,
      localStringifyComparisons: 0,
    });
    expect(sent).toHaveLength(1);
  });

  it('reuses the exact immutable content graph for metadata-only and settings-only submissions', () => {
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 1 },
      send: () => {},
    });
    const initial = mutation('immutable body');
    sync.adoptReplacement(1, initial);
    const adoptedContent = sync.state.localMutation?.content;

    sync.submitMetadata({ title: 'new title' });
    expect(sync.state.localMutation?.content).toBe(adoptedContent);
    sync.submitDocumentSettings({ pdfScale: 90 });
    expect(sync.state.localMutation?.content).toBe(adoptedContent);
    expect(Object.isFrozen(adoptedContent)).toBe(true);
    expect(Object.isFrozen(adoptedContent?.content?.[0])).toBe(true);
    expect(() => {
      if (adoptedContent?.content?.[0]) adoptedContent.content[0].type = 'heading';
    }).toThrow(TypeError);
  });

  it('does not traverse the owned content graph for metadata or settings snapshots', () => {
    let nestedContentReads = 0;
    const paragraph = { type: 'paragraph' } as Record<string, unknown>;
    Object.defineProperty(paragraph, 'content', {
      enumerable: true,
      get: () => {
        nestedContentReads += 1;
        return [{ type: 'text', text: 'large cached graph sentinel' }];
      },
    });
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 1 },
      send: () => {},
    });
    sync.adoptReplacement(1, {
      content: { type: 'doc', content: [paragraph] } as DocumentMutation['content'],
      meta: { title: 'initial' },
      documentSettings: null,
    });
    nestedContentReads = 0;

    sync.submitMetadata({ title: 'renamed' });
    sync.submitDocumentSettings({ pdfScale: 75 });

    expect(nestedContentReads).toBe(0);
    expect(sync.operationCounts.contentSnapshotsCreated).toBe(0);
    expect(sync.operationCounts.contentSnapshotsReused).toBe(2);
  });

  it('waits for an already-submitted generation without creating another mutation snapshot', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 2 },
      createEditId: () => 'edit-1',
      send: (request) => { sent.push(request); },
    });
    sync.adoptReplacement(2, mutation('initial'));
    const generation = sync.submitContent(content('pending save'));
    const countsBeforeBarrier = sync.operationCounts;
    const barrier = sync.flushThrough(generation);

    expect(sync.operationCounts).toEqual({
      ...countsBeforeBarrier,
      flushBarriers: countsBeforeBarrier.flushBarriers + 1,
    });
    expect(sent).toHaveLength(1);
    expect(sync.state.localGeneration).toBe(generation);
    sync.acknowledge({
      sessionId: 'session-a', documentId: 'doc-a', editId: 'edit-1', revision: 3,
    });
    await barrier;
    expect(sent).toHaveLength(1);
    expect(sync.operationCounts.mutationSnapshotsCreated)
      .toBe(countsBeforeBarrier.mutationSnapshotsCreated);
  });

  it('coalesces component revisions with the latest snapshot while preserving the in-flight snapshot', () => {
    const sent: DocumentMutationRequest[] = [];
    let edit = 0;
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 7 },
      createEditId: () => `edit-${++edit}`,
      send: (request) => { sent.push(request); },
    });
    sync.adoptReplacement(7, mutation('initial'));

    sync.submitContent(content('typed'));
    const firstContent = sent[0].mutation.content;
    expect(sync.state.inFlight?.mutation).toBe(sync.state.localMutation);
    sync.submitMetadata({ title: 'renamed' });
    sync.submitDocumentSettings({ pdfScale: 85 });

    expect(sent[0].componentRevisions).toEqual({ content: 1, metadata: 0, settings: 0 });
    expect(sent[0].mutation.content).toBe(firstContent);
    expect(sync.state.pending?.componentRevisions)
      .toEqual({ content: 1, metadata: 1, settings: 1 });
    expect(sync.state.pending?.mutation.content).toBe(firstContent);
    expect(sync.state.pending?.mutation).toBe(sync.state.localMutation);

    sync.acknowledge({
      sessionId: 'session-a', documentId: 'doc-a', editId: 'edit-1', revision: 8,
    });
    expect(sent).toHaveLength(2);
    expect(sent[1].componentRevisions).toEqual({ content: 1, metadata: 1, settings: 1 });
    expect(sent[1].mutation.content).toBe(firstContent);
  });

  it('retains semantic comparison only for parse-equal external representations', () => {
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 3 },
      send: () => {},
    });
    sync.adoptReplacement(3, mutation('same'));
    const external = mutation('same');
    const stringify = vi.spyOn(JSON, 'stringify');

    expect(sync.observeExternalChange(4, external)).toBe(false);
    expect(stringify).toHaveBeenCalled();
    stringify.mockRestore();
    expect(sync.operationCounts.localStringifyComparisons).toBe(0);
  });

  it('reconciles the host-owned modified time without creating a no-op save mutation', () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => 'edit-1',
      send: (request) => { sent.push(request); },
    });
    const documentSettings = { pdfScale: 80 };
    const local: DocumentMutation = {
      ...mutation('draft'),
      meta: { title: 'draft', modified: '2026-08-09T00:00:00.000Z' },
      documentSettings,
    };
    const reconciled = {
      ...local,
      meta: { ...local.meta, modified: '2026-08-10T00:00:00.000Z' },
    };

    expect(sync.submit(local)).toBe(1);
    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 5,
      modified: reconciled.meta.modified,
    })).toBe(true);

    expect(sync.state.localMutation).toEqual(reconciled);
    expect(sync.state.localMutation?.content).toBe(local.content);
    expect(sync.state.localMutation?.documentSettings).toBe(documentSettings);
    expect(sync.submit(reconciled)).toBe(1);
    expect(sync.state.localGeneration).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('reconciles a newer pending snapshot before dispatching it once', () => {
    const sent: DocumentMutationRequest[] = [];
    let nextId = 0;
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => `edit-${++nextId}`,
      send: (request) => { sent.push(request); },
    });
    const initialModified = '2026-08-09T00:00:00.000Z';
    const acknowledgedModified = '2026-08-10T00:00:00.000Z';
    sync.submit({
      ...mutation('first body'),
      meta: { title: 'first body', modified: initialModified },
    });
    sync.submit({
      ...mutation('newer body'),
      meta: { title: 'newer body', modified: initialModified },
    });

    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 5,
      modified: acknowledgedModified,
    })).toBe(true);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      editId: 'edit-2',
      baseRevision: 5,
      localGeneration: 2,
      mutation: {
        content: content('newer body'),
        meta: { title: 'newer body', modified: acknowledgedModified },
        documentSettings: null,
      },
    });
    expect(sync.state.localMutation).toEqual(sent[1].mutation);
    expect(sync.state.pending).toBeNull();
  });

  it('publishes immutable snapshots and accepts the authoritative modified time only from the matching ack', () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 2 },
      createEditId: () => 'edit-current',
      send: (request) => { sent.push(request); },
    });
    const observed: Array<ReturnType<typeof sync.getSnapshot>> = [];
    const unsubscribe = sync.subscribe(() => observed.push(sync.getSnapshot()));

    sync.submit(mutation('draft'));
    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'older-edit',
      revision: 3,
      modified: '2026-08-06T00:00:00.000Z',
    })).toBe(false);
    expect(sync.state.acknowledgedModified).toBeUndefined();

    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-current',
      revision: 3,
      modified: '2026-08-06T01:00:00.000Z',
    })).toBe(true);
    expect(sync.state.acknowledgedModified).toBe('2026-08-06T01:00:00.000Z');
    expect(observed.at(-1)).toBe(sync.getSnapshot());
    expect(Object.isFrozen(sync.getSnapshot())).toBe(true);

    unsubscribe();
    const count = observed.length;
    sync.observeExternalChange(4, mutation('external'));
    expect(observed).toHaveLength(count);
    expect(sent).toHaveLength(1);
  });

  it('keeps one edit in flight and coalesces later input to the latest snapshot', () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: (() => {
        let id = 0;
        return () => `edit-${++id}`;
      })(),
      send: (request) => { sent.push(request); },
    });

    expect(sync.submit(mutation('A'))).toBe(1);
    expect(sync.submit(mutation('AB'))).toBe(2);
    expect(sync.submit(mutation('A'))).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ editId: 'edit-1', baseRevision: 4, localGeneration: 1 });

    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 5,
    })).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      editId: 'edit-2',
      baseRevision: 5,
      localGeneration: 3,
      mutation: mutation('A'),
    });
  });

  it('ignores stale and cross-document responses without changing the local draft', () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 2 },
      createEditId: () => 'current-edit',
      send: (request) => { sent.push(request); },
    });
    sync.submit(mutation('latest deletion'));

    expect(sync.acknowledge({
      sessionId: 'session-b', documentId: 'doc-a', editId: 'current-edit', revision: 3,
    })).toBe(false);
    expect(sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'older-edit',
      revision: 2,
      code: 'STALE_REVISION',
      message: 'stale',
      hostSnapshot: mutation('old text'),
    })).toBe(false);
    expect(sync.state.localMutation).toEqual(mutation('latest deletion'));
    expect(sync.state.error).toBeNull();
    expect(sync.state.acknowledgedRevision).toBe(2);
    expect(sent).toHaveLength(1);
  });

  it('preserves the newest local snapshot after rejection and retries only on request', () => {
    const sent: DocumentMutationRequest[] = [];
    let nextId = 0;
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 8 },
      createEditId: () => `edit-${++nextId}`,
      send: (request) => { sent.push(request); },
    });
    sync.submit(mutation('A'));
    sync.submit(mutation('latest B'));

    expect(sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 9,
      code: 'EXTERNAL_CHANGE',
      message: 'changed outside the editor',
      hostSnapshot: mutation('host version'),
    })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sync.state.localMutation).toEqual(mutation('latest B'));
    expect(sync.state.conflict?.hostSnapshot).toEqual(mutation('host version'));

    sync.retry({ revision: 9 });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      editId: 'edit-2',
      baseRevision: 9,
      localGeneration: 2,
      mutation: mutation('latest B'),
    });
  });

  it('settles flush barriers only when the captured generation is acknowledged', async () => {
    const sent: DocumentMutationRequest[] = [];
    let nextId = 0;
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 1 },
      createEditId: () => `edit-${++nextId}`,
      send: (request) => { sent.push(request); },
    });
    const generationA = sync.submit(mutation('A'));
    const barrierA = sync.flushThrough(generationA);
    sync.submit(mutation('AB'));
    let completed = false;
    void barrierA.then(() => { completed = true; });

    await Promise.resolve();
    expect(completed).toBe(false);
    sync.acknowledge({
      sessionId: 'session-a', documentId: 'doc-a', editId: 'edit-1', revision: 2,
    });
    await barrierA;
    expect(completed).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('clears an external-change notice covered by the matching acknowledgement', () => {
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => 'edit-1',
      send: () => {},
    });
    sync.submit(mutation('local'));
    sync.observeExternalChange(5, mutation('host echo'));

    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 5,
    })).toBe(true);
    expect(sync.state.externalChange).toBeNull();
  });

  it('retains an external change newer than the matching acknowledgement', () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => 'edit-1',
      send: (request) => { sent.push(request); },
    });
    sync.submit(mutation('local'));
    sync.submit(mutation('newest local'));
    sync.observeExternalChange(6, mutation('newer external'));

    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 5,
    })).toBe(true);
    expect(sync.state.externalChange).toEqual({
      revision: 6,
      hostSnapshot: mutation('newer external'),
    });
    expect(sent).toHaveLength(1);
  });

  it('advances past an N+1 parse-equal host snapshot without opening a banner', () => {
    const local = mutation('same body');
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => 'edit-1',
      send: () => {},
    });
    sync.submit(local);

    expect(sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 5,
    })).toBe(true);
    expect(sync.observeExternalChange(6, local)).toBe(false);
    expect(sync.state.externalChange).toBeNull();
    expect(sync.state.acknowledgedRevision).toBe(6);
  });

  it('advances a host-verified representation-only revision without a snapshot conflict', () => {
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      send: () => {},
    });
    sync.adoptReplacement(4, mutation('same body'));

    expect(sync.advanceAcknowledgedRevision(5)).toBe(true);
    expect(sync.advanceAcknowledgedRevision(5)).toBe(false);
    expect(sync.state.acknowledgedRevision).toBe(5);
    expect(sync.state.externalChange).toBeNull();
  });

  it('uses a save barrier captured at request time without blocking later typing', async () => {
    let nextId = 0;
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 0 },
      createEditId: () => `edit-${++nextId}`,
      send: (request) => { sent.push(request); },
    });
    const save = new SaveCoordinator(sync);
    sync.submit(mutation('save me'));
    const action = vi.fn(async () => 'saved');
    const saving = save.afterAcknowledged(action);
    sync.submit(mutation('keep typing'));

    sync.acknowledge({
      sessionId: 'session-a', documentId: 'doc-a', editId: 'edit-1', revision: 1,
    });
    await expect(saving).resolves.toBe('saved');
    expect(action).toHaveBeenCalledOnce();
    expect(sent[1].mutation).toEqual(mutation('keep typing'));
  });

  it('does not turn a Heading or paragraph external snapshot into a replacement effect', () => {
    const local: DocumentMutation = {
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, id: 'heading-a' }, content: [{ type: 'text', text: '삭제 유지' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'paragraph deletion' }] },
        ],
      },
      meta: {},
      documentSettings: null,
    };
    const host: DocumentMutation = {
      ...local,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, id: 'heading-a' }, content: [{ type: 'text', text: '삭제 복원됨' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'paragraph restored' }] },
        ],
      },
    };
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      send: () => {},
    });
    sync.submit(local);

    expect(sync.observeExternalChange(5, host)).toBe(true);
    expect(sync.state.localMutation).toEqual(local);
    expect(sync.state.externalChange?.hostSnapshot).toEqual(host);
    expect(sync.state.acknowledgedRevision).toBe(4);
  });

  it('keeps a newer external body change as a conflict after modified-time reconciliation', () => {
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => 'edit-1',
      send: () => {},
    });
    sync.submit({
      ...mutation('local body'),
      meta: { title: 'local body', modified: '2026-08-09T00:00:00.000Z' },
    });
    sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 5,
      modified: '2026-08-10T00:00:00.000Z',
    });
    const external = {
      ...mutation('external body'),
      meta: { title: 'external body', modified: '2026-08-10T01:00:00.000Z' },
    };

    expect(sync.observeExternalChange(6, external)).toBe(true);
    expect(sync.state.externalChange).toEqual({ revision: 6, hostSnapshot: external });
    expect(sync.state.localMutation).toMatchObject({
      content: content('local body'),
      meta: { title: 'local body', modified: '2026-08-10T00:00:00.000Z' },
    });
  });

  it('persists the seeded pristine snapshot and keeps its barrier pending until ack', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => 'keep-pristine',
      send: (request) => { sent.push(request); },
    });
    sync.adoptReplacement(4, mutation('pristine local'));
    sync.observeExternalChange(5, mutation('external'));

    const keptGeneration = sync.keepLocal(5);
    let completed = false;
    const barrier = sync.flushThrough(keptGeneration);
    void barrier.then(() => { completed = true; });
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(keptGeneration).toBe(1);
    expect(completed).toBe(false);
    expect(sent[0]).toMatchObject({
      editId: 'keep-pristine',
      baseRevision: 5,
      localGeneration: 1,
      mutation: mutation('pristine local'),
    });
    sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'keep-pristine',
      revision: 6,
    });
    await barrier;
    expect(completed).toBe(true);
  });

  it('keeps the local snapshot available when a keep-mine write is rejected', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 4 },
      createEditId: () => 'keep-failed',
      send: (request) => { sent.push(request); },
    });
    const local = mutation('local draft');
    sync.adoptReplacement(4, local);
    sync.observeExternalChange(5, mutation('external'));

    const keptGeneration = sync.keepLocal(5);
    const barrier = sync.flushThrough(keptGeneration);
    sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'keep-failed',
      revision: 5,
      code: 'WRITE_FAILED',
      message: 'write failed',
    });

    await expect(barrier).rejects.toThrow('write failed');
    expect(sent).toHaveLength(1);
    expect(sync.state.localMutation).toEqual(local);
    expect(sync.state.acknowledgedGeneration).toBe(0);
    expect(sync.state.error?.code).toBe('WRITE_FAILED');
  });

  it('keeps rejecting repeated save barriers until an errored mutation is retried', async () => {
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 1 },
      createEditId: () => 'failed-edit',
      send: () => {},
    });
    sync.submit(mutation('unsaved'));
    sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'failed-edit',
      revision: 1,
      code: 'WRITE_FAILED',
      message: 'disk full',
    });

    await expect(sync.flushThrough()).rejects.toThrow('disk full');
    await expect(sync.flushThrough()).rejects.toThrow('disk full');
    expect(sync.state.localMutation).toEqual(mutation('unsaved'));
  });

  it('retries a transient failure only when a new save action is requested', async () => {
    const sent: DocumentMutationRequest[] = [];
    let nextId = 0;
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 1 },
      createEditId: () => `edit-${++nextId}`,
      send: (request) => { sent.push(request); },
    });
    sync.submit(mutation('unsaved'));
    sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-1',
      revision: 1,
      code: 'WRITE_FAILED',
      message: 'disk temporarily unavailable',
    });
    expect(sent).toHaveLength(1);

    const saving = new SaveCoordinator(sync).afterAcknowledged(async () => 'saved');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ editId: 'edit-2', baseRevision: 1 });
    sync.acknowledge({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'edit-2',
      revision: 2,
    });

    await expect(saving).resolves.toBe('saved');
  });

  it('does not retry an external conflict through an ordinary save action', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 1 },
      createEditId: () => 'external-edit',
      send: (request) => { sent.push(request); },
    });
    sync.submit(mutation('mine'));
    sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'external-edit',
      revision: 2,
      code: 'EXTERNAL_CHANGE',
      message: 'changed outside',
      hostSnapshot: mutation('theirs'),
    });

    await expect(new SaveCoordinator(sync).afterAcknowledged(async () => {}))
      .rejects.toThrow('changed outside');
    expect(sent).toHaveLength(1);
  });

  it('does not retry a stale revision through an ordinary save action', async () => {
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 1 },
      createEditId: () => 'stale-edit',
      send: (request) => { sent.push(request); },
    });
    sync.submit(mutation('mine'));
    sync.reject({
      sessionId: 'session-a',
      documentId: 'doc-a',
      editId: 'stale-edit',
      revision: 2,
      code: 'STALE_REVISION',
      message: 'document changed during write',
      hostSnapshot: mutation('theirs'),
    });

    await expect(new SaveCoordinator(sync).afterAcknowledged(async () => {}))
      .rejects.toThrow('document changed during write');
    expect(sent).toHaveLength(1);
    expect(sync.state.error?.code).toBe('STALE_REVISION');
    expect(sync.state.externalChange?.hostSnapshot).toEqual(mutation('theirs'));
  });

  it('omits an unreadable host snapshot instead of stranding a rejection', () => {
    expect(readDocumentMutationBestEffort(() => {
      throw new SyntaxError('incomplete external JSON');
    })).toBeUndefined();
    expect(readDocumentMutationBestEffort(() => mutation('valid host')))
      .toEqual(mutation('valid host'));
  });
});
