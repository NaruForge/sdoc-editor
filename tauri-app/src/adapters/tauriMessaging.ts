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
  SavePersonalTemplateMessage,
  TemplateErrorCode,
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
import {
  DEFAULT_EDITOR_TRANSLATOR,
  readUiLanguagePreference,
  resolveUiLanguagePreference,
  type EditorTranslator,
  type UiLanguagePreference,
} from '@shared/editor/i18n';
import {
  projectTemplateCatalogDiagnostics,
  projectTemplateCatalogDiagnostic,
} from '@shared/template/catalogView';
import type { TemplateDiagnostic } from '@shared/template';
import { createFileOperationError } from '@shared/editor/fileOperations';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type DiagramRenderFailureCode,
  type DiagramRendererSettings,
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

function readDiagramRendererSettings(value: unknown): DiagramRendererSettings {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const rawDiagram = typeof record.diagramRenderer === 'object'
    && record.diagramRenderer !== null
    ? record.diagramRenderer as Record<string, unknown>
    : record;
  const consent = rawDiagram.consent === 'granted' || rawDiagram.consent === 'declined'
    || rawDiagram.consent === 'undecided'
    ? rawDiagram.consent
    : DEFAULT_DIAGRAM_RENDERER_SETTINGS.consent;
  return {
    consent,
    endpoint: typeof rawDiagram.endpoint === 'string'
      ? rawDiagram.endpoint : DEFAULT_DIAGRAM_RENDERER_SETTINGS.endpoint,
    allowPrivateNetwork: typeof rawDiagram.allowPrivateNetwork === 'boolean'
      ? rawDiagram.allowPrivateNetwork
      : DEFAULT_DIAGRAM_RENDERER_SETTINGS.allowPrivateNetwork,
  };
}

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

type TemplateRequestIdentity = Pick<
  SavePersonalTemplateMessage,
  'sessionId' | 'documentId' | 'baseRevision'
>;

export const matchesTemplateRequestIdentity = (
  request: TemplateRequestIdentity,
  current: { sessionId: string; documentId: string; revision: number } | null,
): boolean => Boolean(current
  && request.sessionId === current.sessionId
  && request.documentId === current.documentId
  && request.baseRevision === current.revision);

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

export function createTauriAdapter(_translate: EditorTranslator = DEFAULT_EDITOR_TRANSLATOR): TauriAdapter {
  const listeners: TauriMessageHandler[] = [];
  const unlistenFns: UnlistenFn[] = [];
  let disposed = false;
  let session: { sessionId: string; documentId: string; revision: number } | null = null;
  let workspaceFolder: string | null = null;
  let availableTemplates = new Map<string, SdocTemplate>();
  let personalTemplateFingerprints = new Map<string, string>();
  let templateCatalogGeneration = 0;
  let latestDrawioGeneration = 0;
  let flushHandler: (() => void | Promise<void>) | null = null;
  let editorEditableHandler: ((editable: boolean) => void) | null = null;
  const saveQueue = new RecoverableSerialQueue();

  const emit = (message: HostToEditorMessage): void => {
    for (const handler of listeners) handler(message);
  };

  const emitUiLanguage = (preference: UiLanguagePreference): void => {
    emit({
      type: 'uiLanguageChanged',
      preference,
      locale: resolveUiLanguagePreference(preference, navigator.language),
    });
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
    const generation = ++templateCatalogGeneration;
    try {
      const discovery = await loadTauriTemplateCatalog(
        workspaceFolder,
        () => invoke<WorkspaceTemplateDiscovery>('list_workspace_template_candidates'),
        () => invoke<PersonalTemplateDiscovery>('list_personal_template_candidates'),
      );
      if (generation === templateCatalogGeneration) {
        availableTemplates = new Map(
          discovery.catalog.templates.map((template) => [template.descriptor.id, template]),
        );
        personalTemplateFingerprints = new Map(discovery.personalFingerprints);
      }
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
    } catch (error) {
      console.error('Template catalog discovery failed', error);
      emit({
        type: 'templateCatalogFailed',
        requestId,
        error: { code: 'catalog-unavailable', message: 'The template catalog could not be loaded.' },
      });
    }
  };

  const finishOperation = (
    requestId: string,
    operation: PersonalTemplateOperation,
    result: 'completed' | 'cancelled' | 'failed',
    templateId?: string,
    errorCode?: TemplateErrorCode,
  ): void => emit({
    type: 'templateOperationFinished',
    requestId,
    operation,
    result,
    ...(templateId ? { templateId } : {}),
    ...(errorCode ? {
      error: { code: errorCode, message: 'The template action could not be completed.' },
    } : {}),
  });

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
          {
            const rawSettings = await invoke<unknown>('get_settings');
            const record = typeof rawSettings === 'object' && rawSettings !== null
              ? rawSettings as Record<string, unknown>
              : {};
            emit({
              type: 'diagramRendererSettings',
              settings: readDiagramRendererSettings(rawSettings),
            });
            emitUiLanguage(readUiLanguagePreference(record.uiLanguage));
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
            emit({
              type: 'templateApplicationFinished', requestId: msg.requestId, result: 'failed',
              error: { code: 'document-changed', message: 'The document changed.' },
            });
            break;
          }
          const expectedSession = { ...session };
          const expectedIdentity = {
            documentId: expectedSession.documentId,
            revision: expectedSession.revision,
          };
          const template = availableTemplates.get(msg.templateId);
          if (!template) {
            emit({
              type: 'templateApplicationFinished', requestId: msg.requestId, result: 'failed',
              error: { code: 'template-unavailable', message: 'The selected template is unavailable.' },
            });
            break;
          }
          try {
            const result = await applyTemplateToActiveTauriDocument(template, {
              flushAndWait: async () => {
                await flushHandler?.();
                await saveQueue.whenIdle();
              },
              getIdentity: () => expectedIdentity,
              readSnapshot,
              save: async (request) => {
                if (!session || session.sessionId !== expectedSession.sessionId
                  || session.documentId !== expectedSession.documentId
                  || session.revision !== expectedSession.revision) {
                  throw new Error('Document identity or revision changed.');
                }
                const saved = await invoke<TauriDocumentIdentity>('save_document', request);
                if (!session || session.sessionId !== expectedSession.sessionId) {
                  throw new Error('Document session changed.');
                }
                session = { ...session, ...saved };
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
            emit({
              type: 'templateApplicationFinished', requestId: msg.requestId, result: 'failed',
              error: { code: 'operation-failed', message: 'The template could not be applied.' },
            });
            console.error('Template application failed', error);
          }
          break;
        }

        case 'savePersonalTemplate': {
          let templateId: string | undefined;
          if (!matchesTemplateRequestIdentity(msg, session)) {
            finishOperation(msg.requestId, 'save', 'failed', undefined, 'document-changed');
            break;
          }
          try {
            const snapshot = await readSnapshotAfterFlush();
            if (!session || msg.sessionId !== session.sessionId
              || snapshot.documentId !== msg.documentId || snapshot.revision !== msg.baseRevision) {
              finishOperation(msg.requestId, 'save', 'failed', undefined, 'document-changed');
              break;
            }
            const template = await saveActiveDocumentAsPersonalTemplate(msg.metadata, {
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
            finishOperation(msg.requestId, 'save', 'completed', templateId);
          } catch {
            finishOperation(msg.requestId, 'save', 'failed', templateId, 'operation-failed');
          }
          break;
        }

        case 'updatePersonalTemplate': {
          if (!matchesTemplateRequestIdentity(msg, session)) {
            finishOperation(msg.requestId, 'update', 'failed', msg.templateId, 'document-changed');
            break;
          }
          try {
            const template = availableTemplates.get(msg.templateId);
            if (!template || template.descriptor.source !== 'user') {
              finishOperation(msg.requestId, 'update', 'failed', msg.templateId, 'template-unavailable');
              break;
            }
            if (personalTemplateFingerprints.get(msg.templateId) !== msg.revisionToken) {
              finishOperation(msg.requestId, 'update', 'failed', msg.templateId, 'template-changed');
              break;
            }
            const updated = updatePersonalTemplateMetadata(template, msg.metadata);
            await invoke('update_personal_template', {
              templateId: msg.templateId,
              expectedFingerprint: msg.revisionToken,
              envelope: updated.envelope,
            });
            finishOperation(msg.requestId, 'update', 'completed', msg.templateId);
          } catch {
            finishOperation(msg.requestId, 'update', 'failed', msg.templateId, 'operation-failed');
          }
          break;
        }

        case 'duplicatePersonalTemplate': {
          let duplicateId: string | undefined;
          if (!matchesTemplateRequestIdentity(msg, session)) {
            finishOperation(msg.requestId, 'duplicate', 'failed', undefined, 'document-changed');
            break;
          }
          try {
            const template = availableTemplates.get(msg.templateId);
            if (!template || template.descriptor.source !== 'user') {
              finishOperation(msg.requestId, 'duplicate', 'failed', undefined, 'template-unavailable');
              break;
            }
            if (personalTemplateFingerprints.get(msg.templateId) !== msg.revisionToken) {
              finishOperation(msg.requestId, 'duplicate', 'failed', undefined, 'template-changed');
              break;
            }
            duplicateId = `user:${crypto.randomUUID()}`;
            const duplicate = createPersonalTemplateSnapshot(template.envelope, {
              id: duplicateId,
              ...msg.metadata,
              titleNodeId: template.descriptor.titleNodeId,
              sourceLabel: '.sdoc/templates',
            });
            await invoke('create_personal_template', {
              templateId: duplicateId,
              envelope: duplicate.envelope,
            });
            finishOperation(msg.requestId, 'duplicate', 'completed', duplicateId);
          } catch {
            finishOperation(msg.requestId, 'duplicate', 'failed', duplicateId, 'operation-failed');
          }
          break;
        }

        case 'deletePersonalTemplate': {
          try {
            const template = availableTemplates.get(msg.templateId);
            if (!template || template.descriptor.source !== 'user') {
              finishOperation(msg.requestId, 'delete', 'failed', msg.templateId, 'template-unavailable');
              break;
            }
            if (personalTemplateFingerprints.get(msg.templateId) !== msg.revisionToken) {
              finishOperation(msg.requestId, 'delete', 'failed', msg.templateId, 'template-changed');
              break;
            }
            await invoke('trash_personal_template', {
              templateId: msg.templateId,
              expectedFingerprint: msg.revisionToken,
            });
            finishOperation(msg.requestId, 'delete', 'completed', msg.templateId);
          } catch {
            finishOperation(msg.requestId, 'delete', 'failed', msg.templateId, 'operation-failed');
          }
          break;
        }

        case 'openPersonalTemplateFolder':
          try {
            await invoke('reveal_personal_template_library');
            finishOperation(msg.requestId, 'open-folder', 'completed');
          } catch {
            finishOperation(msg.requestId, 'open-folder', 'failed', undefined, 'operation-failed');
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
          await invoke('update_settings', {
            updates: {
              diagramRenderer: {
                endpoint: msg.settings.endpoint,
                allowPrivateNetwork: msg.settings.allowPrivateNetwork,
              },
            },
          });
          emit({
            type: 'diagramRendererSettings',
            settings: readDiagramRendererSettings(await invoke<unknown>('get_settings')),
          });
          break;

        case 'resolveDiagramRendererConsent':
          try {
            await invoke('update_settings', {
              updates: { diagramRenderer: { consent: msg.consent } },
            });
            const rawSettings = await invoke<unknown>('get_settings');
            emit({
              type: 'diagramRendererConsentResult',
              requestId: msg.requestId,
              result: {
                status: 'resolved',
                settings: readDiagramRendererSettings(rawSettings),
              },
            });
          } catch {
            emit({
              type: 'diagramRendererConsentResult',
              requestId: msg.requestId,
              result: {
                status: 'error',
                message: 'The external diagram rendering decision could not be saved.',
              },
            });
          }
          break;

        case 'updateUiLanguage':
          await invoke('update_settings', { updates: { uiLanguage: msg.preference } });
          emitUiLanguage(msg.preference);
          break;

        // Text-focus routing is owned by the VS Code host so that its Ctrl+B
        // keybinding only wins while the ProseMirror body is focused.
        case 'editorTextFocusChanged':
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
