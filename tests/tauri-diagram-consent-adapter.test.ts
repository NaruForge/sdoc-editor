import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToEditorMessage } from '../shared/types/messages';

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

describe('Tauri diagram consent adapter', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockClear();
  });

  it('does not let a regular renderer settings update mutate host-owned consent', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'get_settings') {
        return Promise.resolve({
          diagramRenderer: {
            consent: 'declined',
            endpoint: 'https://renderer.example.com',
            allowPrivateNetwork: false,
          },
        });
      }
      return Promise.resolve(undefined);
    });
    const adapter = createTauriAdapter();
    const messages: HostToEditorMessage[] = [];
    adapter.subscribe((message) => messages.push(message));

    await adapter.postMessage({
      type: 'updateDiagramRendererSettings',
      settings: {
        consent: 'granted',
        endpoint: 'https://renderer.example.com',
        allowPrivateNetwork: false,
      },
    });

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'update_settings', {
      updates: {
        diagramRenderer: {
          endpoint: 'https://renderer.example.com',
          allowPrivateNetwork: false,
        },
      },
    });
    expect(messages.at(-1)).toEqual({
      type: 'diagramRendererSettings',
      settings: {
        consent: 'declined',
        endpoint: 'https://renderer.example.com',
        allowPrivateNetwork: false,
      },
    });
    adapter.dispose();
  });

  it('acknowledges consent only after persisting and reading it back', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'get_settings') {
        return Promise.resolve({
          diagramRenderer: {
            consent: 'granted',
            endpoint: 'https://kroki.io',
            allowPrivateNetwork: false,
          },
        });
      }
      return Promise.resolve(undefined);
    });
    const adapter = createTauriAdapter();
    const messages: HostToEditorMessage[] = [];
    adapter.subscribe((message) => messages.push(message));

    await adapter.postMessage({
      type: 'resolveDiagramRendererConsent',
      requestId: 'consent-1',
      consent: 'granted',
    });

    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'update_settings',
      'get_settings',
    ]);
    expect(messages.at(-1)).toMatchObject({
      type: 'diagramRendererConsentResult',
      requestId: 'consent-1',
      result: { status: 'resolved', settings: { consent: 'granted' } },
    });
    adapter.dispose();
  });
});
