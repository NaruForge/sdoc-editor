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
import type {
  EditorToHostMessage,
  HostToEditorMessage,
  ManagedTemplateDescriptor,
  PersonalTemplateOperation,
} from '@shared/types/messages';
import { RecoverableSerialQueue } from '@shared/persistence/RecoverableSerialQueue';
import {
  buildTemplateStructuralPreview,
  createPersonalTemplateSnapshot,
  updatePersonalTemplateMetadata,
  type SdocTemplate,
} from '@shared/template';
import {
  applyTemplateToActiveTauriDocument,
  loadTauriTemplateCatalog,
  saveActiveDocumentAsPersonalTemplate,
  type PersonalTemplateDiscovery,
  type TauriActiveDocumentSnapshot,
  type TauriDocumentIdentity,
  type WorkspaceTemplateDiscovery,
} from '../templateService';

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
  getDocumentSession(): { sessionId: string; documentId: string; revision: number } | null;
  setWorkspaceFolder(workspaceFolder: string | null): void;
  setFlushHandler(handler: (() => void) | null): void;
  flushAndWait(): Promise<void>;
}

export function createTauriAdapter(): TauriAdapter {
  const listeners: TauriMessageHandler[] = [];
  const unlistenFns: UnlistenFn[] = [];
  let disposed = false;
  let session: { sessionId: string; documentId: string; revision: number } | null = null;
  let workspaceFolder: string | null = null;
  let availableTemplates = new Map<string, SdocTemplate>();
  let personalTemplateFingerprints = new Map<string, string>();
  let latestDrawioGeneration = 0;
  let flushHandler: (() => void) | null = null;
  const saveQueue = new RecoverableSerialQueue();

  const emit = (message: HostToEditorMessage): void => {
    for (const handler of listeners) handler(message);
  };

  const requireIdentity = (): TauriDocumentIdentity => {
    if (!session) throw new Error('No active document session');
    return { documentId: session.documentId, revision: session.revision };
  };

  const readSnapshot = (identity: TauriDocumentIdentity) =>
    invoke<TauriActiveDocumentSnapshot>('read_active_document_snapshot', {
      documentId: identity.documentId,
      revision: identity.revision,
    });
  const readSnapshotAfterFlush = async (): Promise<TauriActiveDocumentSnapshot> => {
    flushHandler?.();
    await saveQueue.whenIdle();
    return readSnapshot(requireIdentity());
  };

  const refreshTemplateCatalog = async (): Promise<void> => {
    const discovery = await loadTauriTemplateCatalog(
      workspaceFolder,
      () => invoke<WorkspaceTemplateDiscovery>('list_workspace_template_candidates'),
      () => invoke<PersonalTemplateDiscovery>('list_personal_template_candidates'),
    );
    availableTemplates = new Map(
      discovery.catalog.templates.map((template) => [template.descriptor.id, template]),
    );
    personalTemplateFingerprints = new Map(discovery.personalFingerprints);
    const templates: ManagedTemplateDescriptor[] = discovery.catalog.templates.map((template) => ({
      ...template.descriptor,
      preview: buildTemplateStructuralPreview(template),
      ...(discovery.personalFingerprints.has(template.descriptor.id)
        ? { revisionToken: discovery.personalFingerprints.get(template.descriptor.id) }
        : {}),
    }));
    emit({
      type: 'templateCatalog',
      templates,
      diagnosticCount: discovery.nativeDiagnostics.length + discovery.catalog.diagnostics.length,
      personalRootPath: discovery.personalRootPath,
      personalRootScope: 'local',
    });
  };

  const finishOperation = (
    requestId: string,
    operation: PersonalTemplateOperation,
    succeeded: boolean,
    templateId?: string,
    message?: string,
  ): void => emit({
    type: 'templateOperationFinished',
    requestId,
    operation,
    succeeded,
    ...(templateId ? { templateId } : {}),
    ...(message ? { message } : {}),
  });

  const promptMetadata = (
    title: string,
    current: { name: string; description?: string; category?: string },
  ): { name: string; description?: string; category?: string } | undefined => {
    const name = window.prompt(title, current.name);
    if (name === null) return undefined;
    const description = window.prompt('템플릿 설명(선택)', current.description ?? '');
    if (description === null) return undefined;
    const category = window.prompt('템플릿 분류(선택)', current.category ?? '');
    if (category === null) return undefined;
    return {
      name,
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
    };
  };

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
      session = { sessionId: documentId, documentId, revision };
      latestDrawioGeneration = 0;
    },
    getDocumentSession() {
      return session ? { ...session } : null;
    },
    setWorkspaceFolder(value: string | null) {
      workspaceFolder = value;
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
          await refreshTemplateCatalog();
          break;

        case 'edit':
          if (!session) throw new Error('No active document session');
          await saveQueue.enqueue(async () => {
            if (!session) throw new Error('No active document session');
            const saved = await invoke<{ documentId: string; revision: number }>('save_document', {
              content: msg.content,
              metaUpdates: msg.meta ?? null,
              documentId: session.documentId,
              revision: session.revision,
            });
            session = { ...session, ...saved };
          }, () => {});
          break;

        case 'updateMeta':
          if (!session) throw new Error('No active document session');
          await saveQueue.enqueue(async () => {
            if (!session) throw new Error('No active document session');
            const saved = await invoke<{ documentId: string; revision: number }>('save_document', {
              content: null, metaUpdates: msg.meta,
              documentId: session.documentId, revision: session.revision,
            });
            session = { ...session, ...saved };
          }, () => {});
          break;

        case 'updateDocSettings':
          if (!session) throw new Error('No active document session');
          await saveQueue.enqueue(async () => {
            if (!session) throw new Error('No active document session');
            const saved = await invoke<{ documentId: string; revision: number }>('save_document', {
              content: null, metaUpdates: { settings: msg.settings },
              documentId: session.documentId, revision: session.revision,
            });
            session = { ...session, ...saved };
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

        case 'requestTemplateCatalog':
          await refreshTemplateCatalog();
          break;

        case 'applyTemplate': {
          if (!session || msg.sessionId !== session.sessionId
            || msg.documentId !== session.documentId || msg.baseRevision !== session.revision) {
            emit({ type: 'templateApplicationFinished', applied: false });
            break;
          }
          const template = availableTemplates.get(msg.templateId);
          if (!template) {
            await refreshTemplateCatalog();
            emit({ type: 'templateApplicationFinished', applied: false });
            break;
          }
          try {
            const result = await applyTemplateToActiveTauriDocument(template, {
              flushAndWait: async () => {
                flushHandler?.();
                await saveQueue.whenIdle();
              },
              getIdentity: requireIdentity,
              readSnapshot,
              confirm: async () => window.confirm(
                '이 템플릿을 적용하면 현재 본문과 문서 설정이 교체됩니다. 계속하시겠습니까?',
              ),
              save: async (request) => {
                const saved = await invoke<TauriDocumentIdentity>('save_document', request);
                if (session) session = { ...session, ...saved };
                return saved;
              },
            });
            if (result.applied && result.identity && result.envelope && session) {
              emit({
                type: 'update',
                sessionId: session.sessionId,
                documentId: result.identity.documentId,
                revision: result.identity.revision,
                content: result.envelope.doc,
              });
              emit({
                type: 'docSettingsChanged',
                docSettings: result.envelope.meta.settings ?? null,
              });
            }
            emit({ type: 'templateApplicationFinished', applied: result.applied });
          } catch (error: unknown) {
            emit({ type: 'templateApplicationFinished', applied: false });
            throw error;
          }
          break;
        }

        case 'savePersonalTemplate': {
          let templateId: string | undefined;
          try {
            const identity = requireIdentity();
            if (!session || msg.sessionId !== session.sessionId
              || identity.documentId !== msg.documentId || identity.revision !== msg.baseRevision) {
              throw new Error('Document identity or revision changed.');
            }
            const snapshot = await readSnapshotAfterFlush();
            const contractTitle = typeof snapshot.envelope === 'object' && snapshot.envelope !== null
              && 'meta' in snapshot.envelope
              && typeof snapshot.envelope.meta === 'object' && snapshot.envelope.meta !== null
              && 'title' in snapshot.envelope.meta && typeof snapshot.envelope.meta.title === 'string'
              ? snapshot.envelope.meta.title
              : '새 템플릿';
            const metadata = promptMetadata('개인 템플릿 이름', { name: contractTitle });
            if (!metadata) {
              finishOperation(msg.requestId, 'save', false);
              break;
            }
            const template = await saveActiveDocumentAsPersonalTemplate(metadata, {
              createId: () => crypto.randomUUID(),
              flushAndWait: async () => {},
              getIdentity: () => ({ documentId: snapshot.documentId, revision: snapshot.revision }),
              readSnapshot: async () => snapshot,
              create: (id, envelope) => invoke('create_personal_template', {
                templateId: id,
                envelope,
              }).then(() => undefined),
            });
            templateId = template.descriptor.id;
            await refreshTemplateCatalog();
            finishOperation(msg.requestId, 'save', true, templateId);
          } catch (error: unknown) {
            finishOperation(msg.requestId, 'save', false, templateId, String(error));
          }
          break;
        }

        case 'updatePersonalTemplate': {
          try {
            const template = availableTemplates.get(msg.templateId);
            if (!template) throw new Error('Selected personal template no longer exists.');
            const metadata = promptMetadata('개인 템플릿 이름 수정', template.descriptor);
            if (!metadata) {
              finishOperation(msg.requestId, 'update', false, msg.templateId);
              break;
            }
            const updated = updatePersonalTemplateMetadata(template, metadata);
            await invoke('update_personal_template', {
              templateId: msg.templateId,
              expectedFingerprint: msg.revisionToken,
              envelope: updated.envelope,
            });
            await refreshTemplateCatalog();
            finishOperation(msg.requestId, 'update', true, msg.templateId);
          } catch (error: unknown) {
            finishOperation(msg.requestId, 'update', false, msg.templateId, String(error));
          }
          break;
        }

        case 'duplicatePersonalTemplate': {
          let duplicateId: string | undefined;
          try {
            await refreshTemplateCatalog();
            const template = availableTemplates.get(msg.templateId);
            if (!template
              || personalTemplateFingerprints.get(msg.templateId) !== msg.revisionToken) {
              throw new Error('Selected personal template changed. Refresh and try again.');
            }
            const metadata = promptMetadata('복제할 템플릿 이름', {
              name: `${template.descriptor.name} 복사본`,
              description: template.descriptor.description,
              category: template.descriptor.category,
            });
            if (!metadata) {
              finishOperation(msg.requestId, 'duplicate', false);
              break;
            }
            duplicateId = `user:${crypto.randomUUID()}`;
            const duplicate = createPersonalTemplateSnapshot(template.envelope, {
              id: duplicateId,
              ...metadata,
              titleNodeId: template.descriptor.titleNodeId,
              sourceLabel: '이 PC의 공유 저장소',
            });
            await invoke('create_personal_template', {
              templateId: duplicateId,
              envelope: duplicate.envelope,
            });
            await refreshTemplateCatalog();
            finishOperation(msg.requestId, 'duplicate', true, duplicateId);
          } catch (error: unknown) {
            finishOperation(msg.requestId, 'duplicate', false, duplicateId, String(error));
          }
          break;
        }

        case 'deletePersonalTemplate': {
          try {
            const template = availableTemplates.get(msg.templateId);
            if (!template) throw new Error('Selected personal template no longer exists.');
            if (!window.confirm(`'${template.descriptor.name}' 템플릿을 삭제하시겠습니까?`)) {
              finishOperation(msg.requestId, 'delete', false, msg.templateId);
              break;
            }
            await invoke('trash_personal_template', {
              templateId: msg.templateId,
              expectedFingerprint: msg.revisionToken,
            });
            await refreshTemplateCatalog();
            finishOperation(msg.requestId, 'delete', true, msg.templateId);
          } catch (error: unknown) {
            finishOperation(msg.requestId, 'delete', false, msg.templateId, String(error));
          }
          break;
        }

        case 'openPersonalTemplateFolder':
          try {
            await invoke('reveal_personal_template_library');
            finishOperation(msg.requestId, 'open-folder', true);
          } catch (error: unknown) {
            finishOperation(msg.requestId, 'open-folder', false, undefined, String(error));
          }
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
