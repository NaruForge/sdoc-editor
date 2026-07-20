import { useEffect, useRef } from 'react';
import { type TauriAdapter, type TauriMessageHandler } from '../adapters/tauriMessaging';

/**
 * Hook that replaces useVSCodeMessaging for Tauri.
 * Provides the same interface: postMessage function + message handler callback.
 */
export function useTauriMessaging(
  adapter: TauriAdapter,
  onMessage: TauriMessageHandler
): { postMessage: (msg: Record<string, unknown> & { type: string }) => Promise<void> } {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const unsubscribe = adapter.onMessage((msg) => {
      handlerRef.current(msg);
    });
    return unsubscribe;
  }, [adapter]);

  return {
    postMessage: adapter.postMessage,
  };
}
