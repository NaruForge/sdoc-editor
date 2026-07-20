import { useEffect, useRef } from 'react';
import type { EditorHostBridge, HostMessageHandler } from '@shared/editor/hostBridge';
import type { EditorToHostMessage } from '@shared/types/messages';
import { isHostToEditorMessage } from '@shared/types/messageGuards';

// VS Code API type definition
interface VSCodeAPI {
  postMessage(message: EditorToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VSCodeAPI;
  }
}

let vscodeApi: VSCodeAPI | undefined;

const getVSCodeAPI = (): VSCodeAPI => {
  if (!vscodeApi) {
    vscodeApi = window.acquireVsCodeApi();
  }
  return vscodeApi;
};

const vscodeBridge: EditorHostBridge = {
  kind: 'vscode',
  async postMessage(message) {
    getVSCodeAPI().postMessage(message);
  },
  subscribe(handler) {
    const listener = (event: MessageEvent<unknown>) => {
      if (isHostToEditorMessage(event.data)) handler(event.data);
      else console.warn('Ignoring malformed Structured Doc host message', event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  },
  dispose() {},
};

export const useVSCodeMessaging = (handler: HostMessageHandler) => {
  const handlerRef = useRef(handler);

  // Keep handler ref up to date
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  // Set up message listener
  useEffect(() => {
    const unsubscribe = vscodeBridge.subscribe((message) => handlerRef.current(message));

    // Send ready signal
    void vscodeBridge.postMessage({ type: 'ready' });

    return unsubscribe;
  }, []);

  return {
    postMessage: (message: EditorToHostMessage) => vscodeBridge.postMessage(message),
  };
};
