import { useEffect, useRef } from 'react';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/types/messages';

// VS Code API type definition
interface VSCodeAPI {
  postMessage(message: WebviewToExtensionMessage): void;
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
    // Expose globally so native NodeViews (non-React) can also post messages
    window.vscode = vscodeApi;
  }
  return vscodeApi;
};

export interface MessageHandler {
  (message: ExtensionToWebviewMessage): void;
}

export const useVSCodeMessaging = (handler: MessageHandler) => {
  const handlerRef = useRef(handler);

  // Keep handler ref up to date
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  // Set up message listener
  useEffect(() => {
    const messageListener = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      handlerRef.current(message);
    };

    window.addEventListener('message', messageListener);

    // Send ready signal
    getVSCodeAPI().postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', messageListener);
    };
  }, []);

  return {
    postMessage: (message: WebviewToExtensionMessage) => getVSCodeAPI().postMessage(message),
  };
};
