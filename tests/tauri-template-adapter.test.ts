import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToEditorMessage } from '../shared/types/messages';
import type { PersonalTemplateDiscovery } from '../tauri-app/src/templateService';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (value: string) => value,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { createTauriAdapter } from '../tauri-app/src/adapters/tauriMessaging';

const personalDiscovery = (
  storageId: string,
  fingerprint: string,
  name: string,
): PersonalTemplateDiscovery => ({
  libraryPath: 'C:/isolated/.sdoc/templates',
  storageScope: 'local-user-home',
  candidates: [{
    storageId,
    fileName: `${storageId}.sdoc`,
    rawSource: JSON.stringify({
      sdoc: '1.0',
      meta: {
        title: name,
        template: { id: `user:${storageId}`, name },
      },
      doc: { type: 'doc', content: [] },
    }),
    fingerprint,
    sizeBytes: 256,
  }],
  diagnostics: [],
});

describe('Tauri template adapter', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockClear();
  });

  it.each(['savePersonalTemplate', 'updatePersonalTemplate', 'duplicatePersonalTemplate'] as const)(
    'rejects stale %s document identity before invoking a native mutation',
    async (type) => {
      const adapter = createTauriAdapter();
      adapter.setDocumentSession('doc-a', 4);
      const current = adapter.getDocumentSession();
      const messages: HostToEditorMessage[] = [];
      adapter.subscribe((message) => messages.push(message));

      await adapter.postMessage({
        type,
        requestId: `${type}-1`,
        sessionId: current!.sessionId,
        documentId: 'doc-a',
        baseRevision: 3,
        metadata: { name: 'Personal' },
        ...(type === 'savePersonalTemplate' ? {} : {
          templateId: 'user:11111111-1111-4111-8111-111111111111',
          revisionToken: 'sha256:old',
        }),
      });

      expect(messages.at(-1)).toMatchObject({
        type: 'templateOperationFinished',
        requestId: `${type}-1`,
        result: 'failed',
        error: { code: 'document-changed' },
      });
      expect(mocks.invoke).not.toHaveBeenCalled();
      adapter.dispose();
    },
  );

  it('keeps the newest discovery map when catalog requests finish in reverse order', async () => {
    let resolveFirst!: (value: PersonalTemplateDiscovery) => void;
    let resolveSecond!: (value: PersonalTemplateDiscovery) => void;
    const firstDiscovery = new Promise<PersonalTemplateDiscovery>((resolve) => { resolveFirst = resolve; });
    const secondDiscovery = new Promise<PersonalTemplateDiscovery>((resolve) => { resolveSecond = resolve; });
    let discoveryCall = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'list_personal_template_candidates') {
        discoveryCall += 1;
        return discoveryCall === 1 ? firstDiscovery : secondDiscovery;
      }
      if (command === 'update_personal_template') return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const adapter = createTauriAdapter();
    const first = adapter.postMessage({ type: 'requestTemplateCatalog', requestId: 'catalog-1' });
    const second = adapter.postMessage({ type: 'requestTemplateCatalog', requestId: 'catalog-2' });
    resolveSecond(personalDiscovery(
      '22222222-2222-4222-8222-222222222222', 'sha256:new', 'Newest',
    ));
    await second;
    resolveFirst(personalDiscovery(
      '11111111-1111-4111-8111-111111111111', 'sha256:old', 'Stale',
    ));
    await first;

    adapter.setDocumentSession('doc-a', 7);
    const current = adapter.getDocumentSession()!;
    const messages: HostToEditorMessage[] = [];
    adapter.subscribe((message) => messages.push(message));
    await adapter.postMessage({
      type: 'updatePersonalTemplate',
      requestId: 'update-1',
      sessionId: current.sessionId,
      documentId: current.documentId,
      baseRevision: current.revision,
      templateId: 'user:22222222-2222-4222-8222-222222222222',
      revisionToken: 'sha256:new',
      metadata: { name: 'Updated newest' },
    });

    expect(mocks.invoke).toHaveBeenCalledWith('update_personal_template', expect.objectContaining({
      templateId: 'user:22222222-2222-4222-8222-222222222222',
      expectedFingerprint: 'sha256:new',
    }));
    expect(messages.at(-1)).toMatchObject({
      type: 'templateOperationFinished', requestId: 'update-1', result: 'completed',
    });
    adapter.dispose();
  });

  it('recovers a rejected native mutation as a safe failed result', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'list_personal_template_candidates') {
        return Promise.resolve(personalDiscovery(
          '33333333-3333-4333-8333-333333333333', 'sha256:current', 'Current',
        ));
      }
      if (command === 'update_personal_template') return Promise.reject(new Error('raw private path'));
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const adapter = createTauriAdapter();
    await adapter.postMessage({ type: 'requestTemplateCatalog', requestId: 'catalog' });
    adapter.setDocumentSession('doc-a', 8);
    const current = adapter.getDocumentSession()!;
    const messages: HostToEditorMessage[] = [];
    adapter.subscribe((message) => messages.push(message));

    await adapter.postMessage({
      type: 'updatePersonalTemplate',
      requestId: 'update-failed',
      sessionId: current.sessionId,
      documentId: current.documentId,
      baseRevision: current.revision,
      templateId: 'user:33333333-3333-4333-8333-333333333333',
      revisionToken: 'sha256:current',
      metadata: { name: 'Still safe' },
    });

    expect(messages.at(-1)).toEqual({
      type: 'templateOperationFinished',
      requestId: 'update-failed',
      operation: 'update',
      result: 'failed',
      templateId: 'user:33333333-3333-4333-8333-333333333333',
      error: { code: 'operation-failed', message: 'The template action could not be completed.' },
    });
    adapter.dispose();
  });
});
