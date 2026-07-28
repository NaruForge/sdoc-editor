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
import type { DocumentMutation } from '@shared/persistence/DocumentSyncCoordinator';
import { parseDocumentContract } from '@shared/document/documentContract';
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
import { classifyTauriSaveError } from './tauriPersistenceErrors';
import { DEFAULT_EDITOR_TRANSLATOR, type EditorTranslator } from '@shared/editor/i18n';
import {
  projectTemplateCatalogDiagnostics,
  projectTemplateCatalogDiagnostic,
} from '@shared/template/catalogView';
import type { TemplateDiagnostic } from '@shared/template';
import { createFileOperationError } from '@shared/editor/fileOperations';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type DiagramRenderFailureCode,
} from '@shared/diagramRenderer';

const DIAGRAM_FAILURE_CODES: readonly DiagramRenderFailureCode[] = [
  'disabled',
  'invalid-endpoint',
  'blocked-address',
  'source-too-large',
  'timeout',
  'offline',
  'rate-limited',
  'server-error',
  'redirect',
  'response-too-large',
  'invalid-response',
  'cancelled',
];

function diagramFailureCode(value: unknown): DiagramRenderFailureCode {
  return typeof value === 'string'
    && DIAGRAM_FAILURE_CODES.includes(value as DiagramRenderFailureCode)
    ? value as DiagramRenderFailureCode
    : 'offline';
}

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
  setFlushHandler(handler: (() => void | Promise<void>) | null): void;
  setEditorEditableHandler(handler: ((editable: boolean) => void) | null): void;
  setEditorEditable(editable: boolean): void;
  flushAndWait(): Promise<void>;
  acceptExternalChange(): Promise<{ revision: number; snapshot: DocumentMutation }>;
}

export function createTauriAdapter(translate: EditorTranslator = DEFAULT_EDITOR_TRANSLATOR): TauriAdapter {
  const listeners: TauriMessageHandler[] = [];
  const unlistenFns: UnlistenFn[] = [];
  let disposed = false;
  let session: { sessionId: string; documentId: string; revision: number } | null = null;
  let workspaceFolder: string | null = null;
  let availableTemplates = new Map<string, SdocTemplate>();
  let personalTemplateFingerprints = new Map<string, string>();
  let latestDrawioGeneration = 0;
  let flushHandler: (() => void | Promise<void>) | null = null;
  let editorEditableHandler: ((editable: boolean) => void) | null = null;
  const saveQueue = new RecoverableSerialQueue();

  const emit = (message: HostToEditorMessage): void => {
    for (const handler of listeners) handler(message);
  };

  const toExternalMutation = (
    value: TauriActiveDocumentSnapshot,
  ): { revision: number; snapshot: DocumentMutation } => {
    const contract = parseDocumentContract(value.envelope);
    if (!contract.ok) {
      throw new Error(contract.diagnostics.map((item) => item.message).join('; '));
    }
    const { settings, ...meta } = contract.envelope.meta;
    return {
      revision: value.revision,
      snapshot: {
        content: contract.envelope.doc,
        meta,
        documentSettings: settings ?? null,
      },
    };
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
    await flushHandler?.();
    await saveQueue.whenIdle();
    return readSnapshot(requireIdentity());
  };

  const refreshTemplateCatalog = async (requestId: string): Promise<void> => {
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
      sourceLabel: template.descriptor.source === 'builtin'
        ? 'Structured Doc Editor'
        : template.descriptor.source === 'workspace'
          ? 'Workspace templates'
          : 'Local · ~/.sdoc/templates',
      preview: buildTemplateStructuralPreview(template),
      ...(discovery.personalFingerprints.has(template.descriptor.id)
        ? { revisionToken: discovery.personalFingerprints.get(template.descriptor.id) }
        : {}),
    }));
    emit({
      type: 'templateCatalog',
      requestId,
      templates,
      diagnostics: [
        ...projectTemplateCatalogDiagnostics(discovery.catalog.diagnostics, 'catalog'),
        ...discovery.nativeDiagnostics.map((diagnostic, index) =>
          projectTemplateCatalogDiagnostic({
            code: 'read-failed',
            targetPath: diagnostic.path,
            message: 'Template discovery failed.',
          } satisfies TemplateDiagnostic, 'catalog', index)),
      ],
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
    const description = window.prompt(translate('template.descriptionPrompt'), current.description ?? '');
    if (description === null) return undefined;
    const category = window.prompt(translate('template.categoryPrompt'), current.category ?? '');
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

    const u3 = await listen<{ folder: string }>('workspace-changed', () => {
      const observedSession = session ? { ...session } : null;
      if (!observedSession) return;
      void invoke<TauriActiveDocumentSnapshot | null>('read_external_document_snapshot', {
        documentId: observedSession.documentId,
      }).then((external) => {
        if (!external || !session || session.sessionId !== observedSession.sessionId) return;
        const converted = toExternalMutation(external);
        emit({
          type: 'externalChange',
          sessionId: observedSession.sessionId,
          documentId: observedSession.documentId,
          revision: converted.revision,
          snapshot: converted.snapshot,
        });
      }).catch((error: unknown) => {
        console.warn('Failed to inspect external document change', error);
      });
    });
    retainListener(u3);
  };

  setupListeners();

  return {
    kind: 'tauri',
    setDocumentSession(documentId: string, revision: number) {
      session = { sessionId: crypto.randomUUID(), documentId, revision };
      latestDrawioGeneration = 0;
    },
    getDocumentSession() {
      return session ? { ...session } : null;
    },
    setWorkspaceFolder(value: string | null) {
      workspaceFolder = value;
    },
    setFlushHandler(handler: (() => void | Promise<void>) | null) {
      flushHandler = handler;
    },
    setEditorEditableHandler(handler: ((editable: boolean) => void) | null) {
      editorEditableHandler = handler;
    },
    setEditorEditable(editable: boolean) {
      editorEditableHandler?.(editable);
    },
    async flushAndWait() {
      await flushHandler?.();
      await saveQueue.whenIdle();
    },
    async acceptExternalChange() {
      if (!session) throw new Error('No active document session');
      const accepted = await invoke<TauriActiveDocumentSnapshot>('accept_external_document', {
        documentId: session.documentId,
      });
      if (!session || accepted.documentId !== session.documentId) {
        throw new Error('External document identity changed.');
      }
      session = { ...session, revision: accepted.revision };
      return toExternalMutation(accepted);
    },
    postMessage: async (msg: EditorToHostMessage) => {
      // Route messages to appropriate Tauri commands
      switch (msg.type) {
        case 'ready':
          await refreshTemplateCatalog('initial');
          {
            const rawSettings = await invoke<unknown>('get_settings');
            const record = typeof rawSettings === 'object' && rawSettings !== null
              ? rawSettings as Record<string, unknown>
              : {};
            const rawDiagram = typeof record.diagramRenderer === 'object'
              && record.diagramRenderer !== null
              ? record.diagramRenderer as Record<string, unknown>
              : {};
            emit({
              type: 'diagramRendererSettings',
              settings: {
                enabled: typeof rawDiagram.enabled === 'boolean'
                  ? rawDiagram.enabled : DEFAULT_DIAGRAM_RENDERER_SETTINGS.enabled,
                endpoint: typeof rawDiagram.endpoint === 'string'
                  ? rawDiagram.endpoint : DEFAULT_DIAGRAM_RENDERER_SETTINGS.endpoint,
                allowPrivateNetwork: typeof rawDiagram.allowPrivateNetwork === 'boolean'
                  ? rawDiagram.allowPrivateNetwork
                  : DEFAULT_DIAGRAM_RENDERER_SETTINGS.allowPrivateNetwork,
              },
            });
          }
          break;

        case 'edit':
          if (!session) throw new Error('No active document session');
          {
            const requestSession = { ...session };
            void saveQueue.enqueue(async () => {
              const saved = await invoke<{ documentId: string; revision: number }>('save_document', {
                content: msg.mutation.content,
                metaUpdates: {
                  ...msg.mutation.meta,
                  settings: msg.mutation.documentSettings,
                },
                documentId: requestSession.documentId,
                revision: msg.baseRevision,
              });
              if (!session || session.sessionId !== requestSession.sessionId
                || session.documentId !== saved.documentId) return;
              session = { ...session, revision: saved.revision };
              emit({
                type: 'editAcknowledged',
                sessionId: msg.sessionId,
                documentId: msg.documentId,
                editId: msg.editId,
                revision: saved.revision,
              });
            }, (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              const code = classifyTauriSaveError(message);
              if (code !== 'EXTERNAL_CHANGE') {
                emit({
                  type: 'editRejected',
                  sessionId: msg.sessionId,
                  documentId: msg.documentId,
                  editId: msg.editId,
                  revision: requestSession.revision,
                  code,
                  message,
                });
                return;
              }
              void invoke<TauriActiveDocumentSnapshot | null>('read_external_document_snapshot', {
                documentId: requestSession.documentId,
              }).then((external) => {
                const converted = external ? toExternalMutation(external) : null;
                emit({
                  type: 'editRejected',
                  sessionId: msg.sessionId,
                  documentId: msg.documentId,
                  editId: msg.editId,
                  revision: converted?.revision ?? requestSession.revision,
                  code: 'EXTERNAL_CHANGE',
                  message,
                  ...(converted ? { hostSnapshot: converted.snapshot } : {}),
                });
                if (converted) {
                  emit({
                    type: 'externalChange',
                    sessionId: msg.sessionId,
                    documentId: msg.documentId,
                    revision: converted.revision,
                    snapshot: converted.snapshot,
                  });
                }
              }).catch(() => {
                emit({
                  type: 'editRejected',
                  sessionId: msg.sessionId,
                  documentId: msg.documentId,
                  editId: msg.editId,
                  revision: requestSession.revision,
                  code: 'EXTERNAL_CHANGE',
                  message,
                });
              });
            }).catch(() => {
              // The coordinator is notified through editRejected above. Keep the
              // adapter send promise from racing that structured rejection.
            });
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
          try {
            const selected = await open({
              multiple: false,
              filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            });
            if (!selected) {
              emit({
                type: 'fileOperationStatus',
                sessionId: msg.sessionId,
                state: { phase: 'cancelled', requestId: msg.requestId },
              });
              break;
            }
            const text: string = await invoke('read_import_file', {
              path: typeof selected === 'string' ? selected : selected,
            });
            if (!window.confirm('Importing this file will replace the current document. Continue?')) {
              emit({
                type: 'fileOperationStatus',
                sessionId: msg.sessionId,
                state: { phase: 'cancelled', requestId: msg.requestId },
              });
              break;
            }
            emit({
              type: 'importMarkdownText',
              requestId: msg.requestId,
              sessionId: msg.sessionId,
              documentId: msg.documentId,
              text,
            });
            emit({
              type: 'fileOperationStatus',
              sessionId: msg.sessionId,
              state: { phase: 'succeeded', requestId: msg.requestId, result: 'completed' },
            });
          } catch {
            emit({
              type: 'fileOperationStatus',
              sessionId: msg.sessionId,
              state: {
                phase: 'failed',
                requestId: msg.requestId,
                error: createFileOperationError('IMPORT_FAILED', 'The Markdown file could not be imported.', true),
              },
            });
          }
          break;
        }

        case 'importHtml': {
          try {
            const selected = await open({
              multiple: false,
              filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
            });
            if (!selected) {
              emit({
                type: 'fileOperationStatus',
                sessionId: msg.sessionId,
                state: { phase: 'cancelled', requestId: msg.requestId },
              });
              break;
            }
            const text: string = await invoke('read_import_file', {
              path: typeof selected === 'string' ? selected : selected,
            });
            if (!window.confirm('Importing this file will replace the current document. Continue?')) {
              emit({
                type: 'fileOperationStatus',
                sessionId: msg.sessionId,
                state: { phase: 'cancelled', requestId: msg.requestId },
              });
              break;
            }
            emit({
              type: 'importHtml',
              requestId: msg.requestId,
              sessionId: msg.sessionId,
              documentId: msg.documentId,
              html: text,
            });
            emit({
              type: 'fileOperationStatus',
              sessionId: msg.sessionId,
              state: { phase: 'succeeded', requestId: msg.requestId, result: 'completed' },
            });
          } catch {
            emit({
              type: 'fileOperationStatus',
              sessionId: msg.sessionId,
              state: {
                phase: 'failed',
                requestId: msg.requestId,
                error: createFileOperationError('IMPORT_FAILED', 'The HTML file could not be imported.', true),
              },
            });
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
        case 'flushFailed':
        case 'fileOperationApplied':
          break;

        case 'openDocument':
          console.warn('Cross-document navigation is not available through the Tauri adapter yet:', msg.path);
          break;

        case 'browseSdocFiles':
          console.warn('Cross-document browsing is not available through the Tauri adapter yet.');
          break;

        case 'requestTemplateCatalog':
          await refreshTemplateCatalog(msg.requestId);
          break;

        case 'applyTemplate': {
          if (!session || msg.sessionId !== session.sessionId
            || msg.documentId !== session.documentId || msg.baseRevision !== session.revision) {
            emit({ type: 'templateApplicationFinished', requestId: msg.requestId, result: 'failed' });
            break;
          }
          const template = availableTemplates.get(msg.templateId);
          if (!template) {
            await refreshTemplateCatalog(`apply-refresh-${msg.requestId}`);
            emit({ type: 'templateApplicationFinished', requestId: msg.requestId, result: 'failed' });
            break;
          }
          try {
            const result = await applyTemplateToActiveTauriDocument(template, {
              flushAndWait: async () => {
                await flushHandler?.();
                await saveQueue.whenIdle();
              },
              getIdentity: requireIdentity,
              readSnapshot,
              confirm: async () => window.confirm(translate('template.applyConfirm')),
              save: async (request) => {
                const saved = await invoke<TauriDocumentIdentity>('save_document', request);
                if (session) session = { ...session, ...saved };
                return saved;
              },
            });
            if (result.applied && result.identity && result.envelope && session) {
              const { settings: documentSettings, ...persistedMeta } = result.envelope.meta;
              emit({
                type: 'replaceDocument',
                sessionId: session.sessionId,
                documentId: result.identity.documentId,
                revision: result.identity.revision,
                reason: 'confirmed-template',
                snapshot: {
                  content: result.envelope.doc,
                  meta: persistedMeta,
                  documentSettings: documentSettings ?? null,
                },
              });
              emit({
                type: 'docSettingsChanged',
                docSettings: documentSettings ?? null,
              });
            }
            emit({
              type: 'templateApplicationFinished',
              requestId: msg.requestId,
              result: result.applied ? 'applied' : 'cancelled',
            });
          } catch (error: unknown) {
            emit({ type: 'templateApplicationFinished', requestId: msg.requestId, result: 'failed' });
            console.error('Template application failed', error);
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
              : translate('template.untitled');
            const metadata = promptMetadata(translate('template.personalNamePrompt'), { name: contractTitle });
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
            await refreshTemplateCatalog(`operation-${msg.requestId}`);
            finishOperation(msg.requestId, 'save', true, templateId);
          } catch {
            finishOperation(msg.requestId, 'save', false, templateId, 'The template could not be saved.');
          }
          break;
        }

        case 'updatePersonalTemplate': {
          try {
            const template = availableTemplates.get(msg.templateId);
            if (!template) throw new Error('Selected personal template no longer exists.');
            const metadata = promptMetadata(translate('template.editNamePrompt'), template.descriptor);
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
            await refreshTemplateCatalog(`operation-${msg.requestId}`);
            finishOperation(msg.requestId, 'update', true, msg.templateId);
          } catch {
            finishOperation(msg.requestId, 'update', false, msg.templateId, 'The template could not be updated.');
          }
          break;
        }

        case 'duplicatePersonalTemplate': {
          let duplicateId: string | undefined;
          try {
            await refreshTemplateCatalog(`operation-${msg.requestId}`);
            const template = availableTemplates.get(msg.templateId);
            if (!template
              || personalTemplateFingerprints.get(msg.templateId) !== msg.revisionToken) {
              throw new Error('Selected personal template changed. Refresh and try again.');
            }
            const metadata = promptMetadata(translate('template.duplicateNamePrompt'), {
              name: translate('template.copySuffix', { name: template.descriptor.name }),
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
              sourceLabel: '.sdoc/templates',
            });
            await invoke('create_personal_template', {
              templateId: duplicateId,
              envelope: duplicate.envelope,
            });
            await refreshTemplateCatalog(`operation-${msg.requestId}`);
            finishOperation(msg.requestId, 'duplicate', true, duplicateId);
          } catch {
            finishOperation(msg.requestId, 'duplicate', false, duplicateId, 'The template could not be duplicated.');
          }
          break;
        }

        case 'deletePersonalTemplate': {
          try {
            const template = availableTemplates.get(msg.templateId);
            if (!template) throw new Error('Selected personal template no longer exists.');
            if (!window.confirm(translate('template.deleteConfirm', { name: template.descriptor.name }))) {
              finishOperation(msg.requestId, 'delete', false, msg.templateId);
              break;
            }
            await invoke('trash_personal_template', {
              templateId: msg.templateId,
              expectedFingerprint: msg.revisionToken,
            });
            await refreshTemplateCatalog(`operation-${msg.requestId}`);
            finishOperation(msg.requestId, 'delete', true, msg.templateId);
          } catch {
            finishOperation(msg.requestId, 'delete', false, msg.templateId, 'The template could not be deleted.');
          }
          break;
        }

        case 'openPersonalTemplateFolder':
          try {
            await invoke('reveal_personal_template_library');
            finishOperation(msg.requestId, 'open-folder', true);
          } catch {
            finishOperation(msg.requestId, 'open-folder', false, undefined, 'The template folder could not be opened.');
          }
          break;

        case 'export':
          console.warn('Tauri exports are handled by the editor export service.');
          break;

        case 'renderDiagram': {
          try {
            const result = await invoke<{
              dataUrl: string;
              width: number;
              height: number;
            }>('render_diagram', {
              requestId: msg.requestId,
              language: msg.language,
              source: msg.source,
            });
            emit({
              type: 'diagramRenderResult',
              requestId: msg.requestId,
              result: { status: 'ready', ...result },
            });
          } catch (error: unknown) {
            const value = typeof error === 'object' && error !== null
              ? error as Record<string, unknown>
              : {};
            emit({
              type: 'diagramRenderResult',
              requestId: msg.requestId,
              result: {
                status: 'error',
                code: diagramFailureCode(value.code),
                message: 'The diagram renderer could not complete the request.',
                retryable: value.retryable === true,
              },
            });
          }
          break;
        }

        case 'cancelDiagramRender':
          await invoke('cancel_diagram_render', { requestId: msg.requestId });
          break;

        case 'updateDiagramRendererSettings':
          await invoke('update_settings', { updates: { diagramRenderer: msg.settings } });
          emit({ type: 'diagramRendererSettings', settings: msg.settings });
          break;

        case 'testDiagramRendererConnection': {
          try {
            const result = await invoke<{
              dataUrl: string;
              width: number;
              height: number;
            }>('test_diagram_renderer', {
              requestId: msg.requestId,
              settings: msg.settings,
            });
            emit({
              type: 'diagramRenderResult',
              requestId: msg.requestId,
              result: { status: 'ready', ...result },
            });
          } catch (error: unknown) {
            const value = typeof error === 'object' && error !== null
              ? error as Record<string, unknown>
              : {};
            emit({
              type: 'diagramRenderResult',
              requestId: msg.requestId,
              result: {
                status: 'error',
                code: diagramFailureCode(value.code),
                message: 'The diagram renderer connection test failed.',
                retryable: value.retryable === true,
              },
            });
          }
          break;
        }

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
