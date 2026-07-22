/**
 * Tauri IPC adapter — replaces VS Code's acquireVsCodeApi() / postMessage / onMessage pattern.
 *
 * The frontend code communicates through this adapter instead of directly calling
 * VS Code APIs. This allows sharing all components between VS Code extension and Tauri app.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ResolvedEditorSettings } from '@shared/types';
import type { EditorHostBridge, HostMessageHandler } from '@shared/editor/hostBridge';
import type { EditorToHostMessage, HostToEditorMessage } from '@shared/types/messages';
import { RecoverableSerialQueue } from '@shared/persistence/RecoverableSerialQueue';

type SettingsChangedPayload = Partial<ResolvedEditorSettings>;
interface DrawioFileUpdatedPayload {
  documentId: string;
  generation: number;
  relativePath: string;
  timestamp: number;
}
interface SavedImageResult {
  imagePath: string;
  imageName: string;
}
interface CopiedImageResult {
  imagePath: string;
  fileName: string;
}
interface DrawioFileResult {
  drawioPath: string;
  fileName: string;
  filePath: string;
}

export type TauriInboundMessage = HostToEditorMessage;
export type TauriMessageHandler = HostMessageHandler;

/**
 * Convert a relative image/drawio path to an asset URL displayable in the webview.
 */
export async function resolveAssetUrl(relativePath: string): Promise<string> {
  const absPath: string = await invoke('resolve_asset_path', { relativePath });
  return convertFileSrc(absPath);
}

/**
 * Replaces useVSCodeMessaging — provides postMessage and onMessage via Tauri IPC.
 */
export interface TauriAdapter extends EditorHostBridge {
  setDocumentSession(documentId: string, revision: number): void;
  setFlushHandler(handler: (() => void) | null): void;
  flushAndWait(): Promise<void>;
}

export function createTauriAdapter(): TauriAdapter {
  const listeners: TauriMessageHandler[] = [];
  const unlistenFns: UnlistenFn[] = [];
  let disposed = false;
  let session: { documentId: string; revision: number } | null = null;
  let latestDrawioGeneration = 0;
  let flushHandler: (() => void) | null = null;
  const saveQueue = new RecoverableSerialQueue();

  const retainListener = (unlisten: UnlistenFn) => {
    if (disposed) {
      unlisten();
      return;
    }
    unlistenFns.push(unlisten);
  };

  // Listen for backend events
  const setupListeners = async () => {
    const u1 = await listen<SettingsChangedPayload>('settings-changed', (event) => {
      for (const handler of listeners) {
        handler({ type: 'settingsChanged', settings: event.payload });
      }
    });
    retainListener(u1);

    const u2 = await listen<DrawioFileUpdatedPayload>('drawio-file-updated', (event) => {
      if (!session || event.payload.documentId !== session.documentId) return;
      if (event.payload.generation < latestDrawioGeneration) return;
      latestDrawioGeneration = event.payload.generation;
      void resolveAssetUrl(event.payload.relativePath).then((assetUrl) => {
        if (!session || event.payload.documentId !== session.documentId
          || event.payload.generation !== latestDrawioGeneration) return;
        for (const handler of listeners) {
          handler({
            type: 'drawioFileUpdated',
            documentId: event.payload.documentId,
            generation: event.payload.generation,
            relativePath: event.payload.relativePath,
            newWebviewUri: `${assetUrl}?t=${event.payload.timestamp}`,
          });
        }
      }).catch((error: unknown) => {
        console.warn('Rejected Draw.io watcher update', error);
      });
    });
    retainListener(u2);
  };

  setupListeners();

  return {
    kind: 'tauri',
    setDocumentSession(documentId: string, revision: number) {
      session = { documentId, revision };
      latestDrawioGeneration = 0;
    },
    setFlushHandler(handler: (() => void) | null) {
      flushHandler = handler;
    },
    flushAndWait() {
      flushHandler?.();
      return saveQueue.whenIdle();
    },
    postMessage: async (msg: EditorToHostMessage) => {
      // Route messages to appropriate Tauri commands
      switch (msg.type) {
        case 'ready':
          // No-op in Tauri — initialization is handled by App component
          break;

        case 'edit':
          if (!session) throw new Error('No active document session');
          await saveQueue.enqueue(async () => {
            if (!session) throw new Error('No active document session');
            session = await invoke<{ documentId: string; revision: number }>('save_document', {
              content: msg.content,
              metaUpdates: msg.meta ?? null,
              documentId: session.documentId,
              revision: session.revision,
            });
          }, () => {});
          break;

        case 'updateMeta':
          if (!session) throw new Error('No active document session');
          await saveQueue.enqueue(async () => {
            if (!session) throw new Error('No active document session');
            session = await invoke<{ documentId: string; revision: number }>('save_document', {
              content: null, metaUpdates: msg.meta,
              documentId: session.documentId, revision: session.revision,
            });
          }, () => {});
          break;

        case 'updateDocSettings':
          if (!session) throw new Error('No active document session');
          await saveQueue.enqueue(async () => {
            if (!session) throw new Error('No active document session');
            session = await invoke<{ documentId: string; revision: number }>('save_document', {
              content: null, metaUpdates: { settings: msg.settings },
              documentId: session.documentId, revision: session.revision,
            });
          }, () => {});
          for (const handler of listeners) {
            handler({ type: 'docSettingsChanged', docSettings: msg.settings });
          }
          break;

        case 'saveImage': {
          const result = await invoke<SavedImageResult>('save_image', {
            imageName: msg.imageName,
            imageData: msg.imageData,
            extension: msg.extension,
          });
          const assetUrl = await resolveAssetUrl(result.imagePath);
          for (const handler of listeners) {
            handler({
              type: 'imageSaved',
              imagePath: result.imagePath,
              webviewUri: assetUrl,
              imageName: result.imageName,
            });
          }
          break;
        }

        case 'insertExistingImage': {
          const selected = await open({
            multiple: false,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }],
          });
          if (selected) {
            const result = await invoke<CopiedImageResult>('copy_image_to_doc', {
              sourcePath: typeof selected === 'string' ? selected : selected,
            });
            const assetUrl = await resolveAssetUrl(result.imagePath);
            for (const handler of listeners) {
              handler({
                type: 'imageInserted',
                imagePath: result.imagePath,
                webviewUri: assetUrl,
                fileName: result.fileName,
              });
            }
          }
          break;
        }

        case 'replaceImage': {
          const selected = await open({
            multiple: false,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }],
          });
          if (selected) {
            const result = await invoke<CopiedImageResult>('copy_image_to_doc', {
              sourcePath: typeof selected === 'string' ? selected : selected,
            });
            const assetUrl = await resolveAssetUrl(result.imagePath);
            for (const handler of listeners) {
              handler({
                type: 'imageReplaced',
                pos: msg.pos,
                imagePath: result.imagePath,
                webviewUri: assetUrl,
                fileName: result.fileName,
              });
            }
          }
          break;
        }

        case 'createDrawio': {
          const result = await invoke<DrawioFileResult>('create_drawio_file', {
            fileName: msg.fileName,
          });
          const assetUrl = await resolveAssetUrl(result.drawioPath);
          for (const handler of listeners) {
            handler({
              type: 'drawioCreated',
              drawioPath: result.drawioPath,
              webviewUri: assetUrl,
              fileName: result.fileName,
            });
          }
          // Also open in draw.io desktop
          await invoke('open_drawio_external', { path: result.filePath });
          break;
        }

        case 'importDrawio': {
          const selected = await open({
            multiple: false,
            filters: [{ name: 'Draw.io Files', extensions: ['drawio.svg', 'drawio'] }],
          });
          if (selected) {
            const result = await invoke<DrawioFileResult>('copy_drawio_to_doc', {
              sourcePath: typeof selected === 'string' ? selected : selected,
            });
            const assetUrl = await resolveAssetUrl(result.drawioPath);
            for (const handler of listeners) {
              handler({
                type: 'drawioCreated',
                drawioPath: result.drawioPath,
                webviewUri: assetUrl,
                fileName: result.fileName,
              });
            }
          }
          break;
        }

        case 'openDrawio': {
          const absPath: string = await invoke('resolve_asset_path', {
            relativePath: msg.drawioPath,
          });
          await invoke('open_drawio_external', { path: absPath });
          break;
        }

        case 'importMarkdown': {
          const selected = await open({
            multiple: false,
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          });
          if (selected) {
            const text: string = await invoke('read_import_file', {
              path: typeof selected === 'string' ? selected : selected,
            });
            // Import is handled on the frontend side using shared converter
            for (const handler of listeners) {
              handler({ type: 'importMarkdownText', text });
            }
          }
          break;
        }

        case 'importHtml': {
          const selected = await open({
            multiple: false,
            filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
          });
          if (selected) {
            const text: string = await invoke('read_import_file', {
              path: typeof selected === 'string' ? selected : selected,
            });
            for (const handler of listeners) {
              handler({ type: 'importHtml', html: text });
            }
          }
          break;
        }

        case 'viewJson': {
          // In Tauri, we can't open VS Code — instead show JSON in a dialog or new window
          // For now, emit event that App can handle
          for (const handler of listeners) {
            handler({ type: 'showJsonViewer' });
          }
          break;
        }

        case 'flushComplete':
          break;

        case 'openDocument':
          console.warn('Cross-document navigation is not available through the Tauri adapter yet:', msg.path);
          break;

        case 'browseSdocFiles':
          console.warn('Cross-document browsing is not available through the Tauri adapter yet.');
          break;

        case 'initializeEmptyDocument':
          console.warn('Empty document initialization is currently available only in the VS Code host.');
          break;

        case 'export':
          console.warn('Tauri exports are handled by the editor export service.');
          break;

        case 'selectCssFile':
        case 'clearCssFile':
          console.warn(`${msg.type} is not available in the desktop app yet.`);
          break;

        default:
          assertNever(msg);
      }
    },

    subscribe: (handler: TauriMessageHandler) => {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },

    dispose: () => {
      disposed = true;
      for (const unlisten of unlistenFns) {
        unlisten();
      }
      unlistenFns.length = 0;
      listeners.length = 0;
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported editor message: ${JSON.stringify(value)}`);
}
