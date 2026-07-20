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

type SettingsChangedPayload = Partial<ResolvedEditorSettings>;
interface DrawioFileUpdatedPayload {
  relativePath: string;
  filePath: string;
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

export type TauriInboundMessage =
  | { type: 'settingsChanged'; settings: SettingsChangedPayload }
  | { type: 'importMarkdownText'; text: string }
  | { type: 'importHtml'; html: string }
  | { type: 'imageSaved'; imagePath: string; webviewUri: string; imageName: string }
  | { type: 'drawioCreated'; drawioPath: string; webviewUri: string; fileName: string }
  | { type: 'imageInserted'; imagePath: string; webviewUri: string; fileName: string }
  | { type: 'drawioFileUpdated'; relativePath: string; filePath: string; timestamp: number }
  | { type: 'imageReplaced'; pos: number; imagePath: string; webviewUri: string; fileName: string }
  | { type: 'showJsonViewer' };

export interface TauriMessageHandler {
  (message: TauriInboundMessage): void;
}

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
export function createTauriAdapter() {
  const listeners: TauriMessageHandler[] = [];
  const unlistenFns: UnlistenFn[] = [];

  // Listen for backend events
  const setupListeners = async () => {
    const u1 = await listen<SettingsChangedPayload>('settings-changed', (event) => {
      for (const handler of listeners) {
        handler({ type: 'settingsChanged', settings: event.payload });
      }
    });
    unlistenFns.push(u1);

    const u2 = await listen<DrawioFileUpdatedPayload>('drawio-file-updated', (event) => {
      for (const handler of listeners) {
        handler({
          type: 'drawioFileUpdated',
          relativePath: event.payload.relativePath,
          filePath: event.payload.filePath,
          timestamp: event.payload.timestamp,
        });
      }
    });
    unlistenFns.push(u2);
  };

  setupListeners();

  return {
    postMessage: async (msg: Record<string, unknown> & { type: string }) => {
      // Route messages to appropriate Tauri commands
      switch (msg.type) {
        case 'ready':
          // No-op in Tauri — initialization is handled by App component
          break;

        case 'edit':
          await invoke('save_document', {
            content: msg.content,
            metaUpdates: null,
          });
          break;

        case 'updateMeta':
          await invoke('save_document', {
            content: msg.content || null,
            metaUpdates: msg.meta,
          });
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
          if (typeof msg.pos !== 'number') {
            throw new Error('replaceImage requires a numeric position');
          }
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

        default:
          console.warn('Unknown message type:', msg.type);
      }
    },

    onMessage: (handler: TauriMessageHandler) => {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },

    cleanup: () => {
      for (const unlisten of unlistenFns) {
        unlisten();
      }
      unlistenFns.length = 0;
      listeners.length = 0;
    },
  };
}

export type TauriAdapter = ReturnType<typeof createTauriAdapter>;
