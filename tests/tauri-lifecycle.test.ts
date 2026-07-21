import { describe, expect, it, vi } from 'vitest';
import { closeTauriApplication, createCloseRequestHandler } from '../tauri-app/src/applicationLifecycle';

describe('Tauri application lifecycle', () => {
  it('flushes and stops watchers before exiting', async () => {
    const calls: string[] = [];

    await closeTauriApplication({
      flush: vi.fn(async () => { calls.push('flush'); }),
      stopWatchers: vi.fn(async () => { calls.push('stop-watchers'); }),
      exit: vi.fn(async () => { calls.push('exit'); }),
    });

    expect(calls).toEqual(['flush', 'stop-watchers', 'exit']);
  });

  it('does not exit when flushing fails', async () => {
    const stopWatchers = vi.fn(async () => {});
    const exit = vi.fn(async () => {});

    await expect(closeTauriApplication({
      flush: vi.fn(async () => { throw new Error('save failed'); }),
      stopWatchers,
      exit,
    })).rejects.toThrow('save failed');

    expect(stopWatchers).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('prevents every repeated close request and runs one close operation at a time', async () => {
    let finishClose: (() => void) | undefined;
    const close = vi.fn(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    const onError = vi.fn();
    const handler = createCloseRequestHandler(close, onError);
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };

    const firstRequest = handler(firstEvent);
    await handler(secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    finishClose?.();
    await firstRequest;
    expect(onError).not.toHaveBeenCalled();
  });
});
