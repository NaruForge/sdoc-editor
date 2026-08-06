import type { EditorToHostMessage, HostToEditorMessage } from '../types/messages';

export type HostKind = 'vscode';
export type HostMessageHandler = (message: HostToEditorMessage) => void;

/**
 * The only host boundary visible to editor UI code.
 *
 * The implementation uses VS Code postMessage while shared editor modules
 * remain unaware of the host API.
 */
export interface EditorHostBridge {
  readonly kind: HostKind;
  postMessage(message: EditorToHostMessage): Promise<void>;
  subscribe(handler: HostMessageHandler): () => void;
  dispose(): void;
}
