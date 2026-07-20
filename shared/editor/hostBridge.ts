import type { EditorToHostMessage, HostToEditorMessage } from '../types/messages';

export type HostKind = 'vscode' | 'tauri';
export type HostMessageHandler = (message: HostToEditorMessage) => void;

/**
 * The only host boundary visible to editor UI code.
 *
 * Implementations may use VS Code postMessage or Tauri IPC internally, but
 * shared editor modules remain unaware of either host API.
 */
export interface EditorHostBridge {
  readonly kind: HostKind;
  postMessage(message: EditorToHostMessage): Promise<void>;
  subscribe(handler: HostMessageHandler): () => void;
  dispose(): void;
}
