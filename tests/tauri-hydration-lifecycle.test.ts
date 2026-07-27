import { describe, expect, it, vi } from 'vitest';
import { DocumentHydrationCoordinator } from '../tauri-app/src/documentHydration';
import {
  DocumentSyncCoordinator,
  type DocumentMutation,
  type DocumentMutationRequest,
} from '../shared/persistence/DocumentSyncCoordinator';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('Tauri document hydration lifecycle', () => {
  it('starts only one hydration for the same document session', async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const apply = vi.fn();
    const coordinator = new DocumentHydrationCoordinator<string>();

    const first = coordinator.hydrate('session-a', load, apply);
    const duplicate = coordinator.hydrate('session-a', load, apply);
    expect(load).toHaveBeenCalledOnce();
    pending.resolve('hydrated');
    await Promise.all([first, duplicate]);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('discards an older completion after the document session changes', async () => {
    const old = deferred<string>();
    const current = deferred<string>();
    const apply = vi.fn();
    const coordinator = new DocumentHydrationCoordinator<string>();

    const oldHydration = coordinator.hydrate('session-a', () => old.promise, apply);
    const currentHydration = coordinator.hydrate('session-b', () => current.promise, apply);
    current.resolve('current');
    await currentHydration;
    old.resolve('old');
    await oldHydration;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('current');
  });

  it('discards completion after cancellation', async () => {
    const pending = deferred<string>();
    const apply = vi.fn();
    const coordinator = new DocumentHydrationCoordinator<string>();
    const hydration = coordinator.hydrate('session-a', () => pending.promise, apply);
    coordinator.cancel();
    pending.resolve('late');
    await hydration;
    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps the portable snapshot authoritative while rendering hydrated asset URLs', async () => {
    const portable: DocumentMutation = {
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: './images/example.png' } }],
      },
      meta: {},
      documentSettings: null,
    };
    const sent: DocumentMutationRequest[] = [];
    const sync = new DocumentSyncCoordinator({
      identity: { sessionId: 'session-a', documentId: 'doc-a', revision: 2 },
      createEditId: () => 'keep-portable',
      send: (request) => { sent.push(request); },
    });
    const coordinator = new DocumentHydrationCoordinator<DocumentMutation['content']>();
    const applyToEditor = vi.fn();

    await coordinator.hydrate(
      'session-a',
      async () => ({
        ...portable.content,
        content: [{ type: 'image', attrs: { src: 'asset://example.png', relativePath: './images/example.png' } }],
      }),
      (hydrated) => {
        applyToEditor(hydrated);
        sync.adoptReplacement(2, portable);
      },
    );
    sync.observeExternalChange(3, {
      ...portable,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    sync.keepLocal(3);

    expect(applyToEditor).toHaveBeenCalledWith(expect.objectContaining({
      content: [expect.objectContaining({
        attrs: expect.objectContaining({ src: 'asset://example.png' }),
      })],
    }));
    expect(sent[0].mutation).toEqual(portable);
  });
});
