import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { computeRevision } from '../shared/document/operations/sha256';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import {
  ExpectedDocumentChanges,
  hasTextDocumentContentChanges,
  shouldReportExternalDocumentChange,
} from './utils/expectedDocumentChanges';
import {
  createFullDocumentTextEdit,
  isDocumentTextEditApplicationConfirmed,
  isDocumentTextEditSourceCurrent,
  measureDocumentTextEdits,
  planSdocDocumentTextEdits,
  RevisionBoundSdocModifiedTokenCache,
  serializePrettySdocWithModifiedToken,
  type DocumentTextEditSource,
  type SdocModifiedTokenCacheAuthority,
} from './utils/documentTextEdit';
import { convertMarkdownToJson } from '../shared/converter';
import { generateFontFaceCSS } from './utils/fontUtils';
import { convertImagePathsToWebviewUris, convertWebviewUrisToRelativePaths } from './utils/imageUtils';
import {
  unwrapSdoc as sharedUnwrapSdoc,
  normalizeDocument,
} from '../shared/document/sdocUtils';
import {
  getCaptionPreset,
  HOST_SETTING_DEFAULTS,
  resolveDocumentSettingsSnapshot,
  resolveEditorSettings,
} from '../shared/settingsResolver';
import type {
  DocumentSettings,
  SdocEnvelope,
  SdocMeta,
  TiptapNode,
} from '../shared/types';
import type {
  EditorToHostMessage,
  PersonalTemplateOperation,
  TemplateErrorCode,
  TemplateOperationError,
} from '../shared/types/messages';
import { isEditorToHostMessage } from '../shared/types/messageGuards';
import { VsCodeAssetService } from './services/VsCodeAssetService';
import {
  projectStandaloneExportSettings,
  VsCodeExportService,
  type ExportFormat,
  type PreparedDocumentExport,
} from './services/VsCodeExportService';
import {
  FileOperationPlanError,
  FileOperationPlanRegistry,
} from './services/FileOperationPlanRegistry';
import { RecoverableSerialQueue } from '../shared/persistence/RecoverableSerialQueue';
import {
  readDocumentMutationBestEffort,
  type DocumentComponentRevisions,
  type DocumentMutation,
} from '../shared/persistence/DocumentSyncCoordinator';
import { areDocumentMutationsSemanticallyEqual } from '../shared/editor/externalChanges/mutationDiff';
import {
  assertPersistedDocument,
  assertPersistedDocumentMetadata,
  parseDocumentContract,
  parseDocumentTextContract,
  readDocumentSettings,
  type DocumentTextContractResult,
} from '../shared/document/documentContract';
import { dehydrateDocumentAssets } from '../shared/document/runtimeAssets';
import {
  prepareExportDiagrams,
  type DiagramPreparationResult,
} from '../shared/export/diagramPreparation';
import { canRecoverInvalidDocument } from '../shared/persistence/invalidDocumentRecovery';
import {
  canApplyTemplateToCurrentDocument,
  commitCurrentDocumentTemplateApplication,
  isFilesystemBackedScheme,
  isUninitializedSdocText,
  isWorkspaceTemplatePath,
  prepareCurrentDocumentTemplateApplication,
  suggestSdocFileName,
  validateDocumentTitle,
  VsCodeTemplateService,
  type CurrentDocumentIdentity,
  type WorkspaceTemplateRoot,
} from './services/VsCodeTemplateService';
import {
  buildTemplateStructuralPreview,
  createPersonalTemplateSnapshot,
  suggestTemplateTitleNodeId,
  updatePersonalTemplateMetadata,
  type SdocTemplate,
  type TemplateDiagnostic,
} from '../shared/template';
import {
  projectTemplateCatalogDiagnostic,
  projectTemplateCatalogDiagnostics,
} from '../shared/template/catalogView';
import {
  createFileOperationError,
  type FileOperationArtifactId,
  type FileOperationIntent,
  type FileOperationPlanView,
  type FileOperationResultAction,
  type FileOperationState,
} from '../shared/editor/fileOperations';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type DiagramRendererConsent,
  type DiagramRendererSettings,
} from '../shared/diagramRenderer';
import { ExtensionHostPerformanceProbe } from './performance/ExtensionHostPerformanceProbe';
import {
  DIAGRAM_RENDERER_CONSENT_STATE_KEY,
  KrokiDiagramService,
  KrokiRenderError,
  resolvePersistedDiagramRendererConsent,
} from './services/KrokiDiagramService';
import { MAX_CUSTOM_CSS_BYTES } from './utils/cssUtils';
import { resolveContainedRegularFile } from './utils/containedFile';
import { MAX_DOCUMENT_BYTES, MAX_IMPORT_BYTES } from '../shared/resourceLimits';
import {
  readUiLanguagePreference,
  resolveUiLanguagePreference,
  type UiLanguagePreference,
} from '../shared/editor/i18n/locale';
import {
  EditorTextFocusCoordinator,
  type EditorTextFocusIdentity,
} from './editorTextFocusCoordinator';
import {
  recoverFromUiLanguageWriteFailure,
  updateUiLanguagePreference,
} from './uiLanguagePreferenceUpdate';
import { RevisionBoundCanonicalPersistenceCache } from './utils/canonicalPersistenceSnapshot';

type HostFileOperationPayload =
  | {
    kind: 'export';
    prepared: PreparedDocumentExport;
  }
  | {
    kind: 'import';
    sourceUri: vscode.Uri;
    sourceText: string;
    imported: { kind: 'markdown'; content: TiptapNode } | { kind: 'html'; html: string };
    checkpoint: DocumentMutation;
  };

type HostFileOperationArtifact =
  | { kind: 'export'; uri: vscode.Uri; openKind: 'external' | 'html' | 'text' }
  | {
    kind: 'import-checkpoint';
    mutation: DocumentMutation;
    intent: Extract<FileOperationIntent, { kind: 'import' }>;
    expectedCurrentFingerprint: string;
  };

interface PersistedDocumentUpdateResult {
  modified: string;
  envelope: SdocEnvelope;
}

async function readBoundedWorkspaceFile(
  uri: vscode.Uri,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const info = await vscode.workspace.fs.stat(uri);
  if ((info.type & vscode.FileType.File) === 0) {
    throw new Error(`${label} is not a regular file.`);
  }
  if (info.size > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes.toLocaleString('en-US')} byte limit.`);
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes.toLocaleString('en-US')} byte limit.`);
  }
  return bytes;
}

function summarizeImportedHtml(html: string): {
  outline: { level: number; title: string }[];
  topLevelBlockCount: number;
  warnings: string[];
} {
  const outline = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)]
    .map((match) => ({
      level: Number(match[1]),
      title: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((item) => item.title.length > 0);
  const topLevelBlockCount = [...html.matchAll(
    /<(?:p|h[1-6]|ul|ol|blockquote|pre|table|figure|hr)\b/gi,
  )].length;
  const warnings: string[] = [];
  if (/<(?:script|style|iframe|object|embed|form)\b/i.test(html)) {
    warnings.push('Unsupported or unsafe HTML elements will be removed during import.');
  }
  return { outline, topLevelBlockCount, warnings };
}

class DocumentEditConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DocumentEditConflictError';
  }
}

export class SdocEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly SDOC_VERSION = '1.0';
  private static readonly EDITOR_TEXT_FOCUS_CONTEXT = 'structuredDocEditor.editorTextFocus';
  private static readonly TOGGLE_BOLD_COMMAND = 'structuredDocEditor.toggleBold';
  private static watcherGeneration = 0;
  private static instance: SdocEditorProvider | undefined;
  private readonly assetService = new VsCodeAssetService();
  private readonly exportService: VsCodeExportService;
  private readonly performanceProbe: ExtensionHostPerformanceProbe;
  private readonly fileOperations = new FileOperationPlanRegistry<
    HostFileOperationPayload,
    HostFileOperationArtifact
  >();

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SdocEditorProvider(context);
    SdocEditorProvider.instance = provider;
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      'structuredDocEditor.sdoc',
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    const toggleBoldRegistration = vscode.commands.registerCommand(
      SdocEditorProvider.TOGGLE_BOLD_COMMAND,
      // Winning VS Code's keybinding resolution prevents the workbench sidebar
      // command. The original DOM keyboard event still reaches ProseMirror,
      // which owns the single document mutation and preserves its selection.
      () => undefined,
    );
    const testRegistrations = context.extensionMode === vscode.ExtensionMode.Test
      ? [
        vscode.commands.registerCommand(
          'structuredDocEditor.test.getActiveFileOperation',
          () => provider.getActiveTestSession().getFileOperationSnapshot(),
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.getActivePersistenceState',
          () => provider.getActiveTestSession().getPersistenceSnapshot(),
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.prepareActiveImport',
          (source: string, format: 'markdown' | 'html' = 'markdown') => {
            if (format !== 'markdown' && format !== 'html') {
              throw new Error('Unsupported test import format.');
            }
            return provider.getActiveTestSession().prepareFileOperation(
              randomUUID(),
              { kind: 'import', format },
              vscode.Uri.parse(source),
            );
          },
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.confirmActiveFileOperation',
          () => provider.getActiveTestSession().confirmFileOperation(),
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.runActiveResultAction',
          (action: FileOperationResultAction, artifactId?: string) =>
            provider.getActiveTestSession().runResultAction(action, artifactId),
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.resetActivePerformanceReport',
          () => {
            provider.getActiveTestSession();
            provider.performanceProbe.reset();
          },
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.getActivePerformanceReport',
          () => {
            provider.getActiveTestSession();
            return provider.performanceProbe.report({
              vscodeVersion: vscode.version,
              nodeVersion: process.versions.node,
              platform: process.platform,
              architecture: process.arch,
            });
          },
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.applyActiveLocalizedMutation',
          (blockIndex: number) => {
            if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
              throw new Error('The localized test block index is invalid.');
            }
            const session = provider.getActiveTestSession();
            return session.panel.webview.postMessage({
              type: 'testApplyLocalizedMutation',
              sessionId: session.sessionId,
              documentId: session.document.uri.toString(),
              blockIndex,
            });
          },
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.applyActiveMetadataMutation',
          (title: string) => {
            if (typeof title !== 'string' || title.length === 0 || title.length > 200) {
              throw new Error('The metadata test title is invalid.');
            }
            const session = provider.getActiveTestSession();
            return session.panel.webview.postMessage({
              type: 'testApplyMetadataMutation',
              sessionId: session.sessionId,
              documentId: session.document.uri.toString(),
              title,
            });
          },
        ),
      ]
      : [];
    return vscode.Disposable.from(
      providerRegistration,
      toggleBoldRegistration,
      ...testRegistrations,
      { dispose: () => provider.dispose() },
    );
  }

  public static async exportActiveDocument(format: ExportFormat): Promise<void> {
    const provider = SdocEditorProvider.instance;
    if (!provider) throw new Error('Structured Doc Editor is not active.');
    await provider.exportActive(format);
  }

  public static async flushActiveDocument(): Promise<void> {
    const provider = SdocEditorProvider.instance;
    if (!provider) return;
    await provider.flushActive();
  }

  /** Exact snapshots expected from our own WorkspaceEdit, never a blind event counter. */
  private readonly expectedDocumentChanges = new ExpectedDocumentChanges();
  private pendingFlushResolvers = new Map<string, {
    sessionId: string;
    documentId: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly editorSessions = new Map<string, {
    document: vscode.TextDocument;
    panel: vscode.WebviewPanel;
    sessionId: string;
    prepareFileOperation: (
      requestId: string,
      intent: FileOperationIntent,
      sourceUri?: vscode.Uri,
    ) => Promise<void>;
    getFileOperationSnapshot: () => {
      state: FileOperationState;
      plan?: FileOperationPlanView;
    };
    getPersistenceSnapshot: () => {
      phase: 'dirty' | 'saving' | 'saved' | 'failed';
      revision: number;
      isDirty: boolean;
      externalChangeCount: number;
    };
    confirmFileOperation: () => void;
    runResultAction: (
      action: FileOperationResultAction,
      artifactId?: string,
    ) => Promise<void>;
  }>();
  private readonly uiReadySessionIds = new Set<string>();

  public static async waitForActiveEditorUiReady(timeoutMs = 10_000): Promise<boolean> {
    const provider = SdocEditorProvider.instance;
    if (!provider) throw new Error('Structured Doc Editor is not active.');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const activeSession = [...provider.editorSessions.values()]
        .find((session) => session.panel.active);
      if (activeSession && provider.uiReadySessionIds.has(activeSession.sessionId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for the Structured Doc webview UI to render.');
  }
  private readonly diagramRendererRuntimes = new Map<vscode.WebviewPanel, {
    service: KrokiDiagramService;
    requests: Map<string, AbortController>;
  }>();
  private readonly editorTextFocus = new EditorTextFocusCoordinator<vscode.WebviewPanel>();
  private focusContextUpdates: Promise<unknown> = Promise.resolve();
  private diagramRendererConsentInitialization: Promise<DiagramRendererConsent> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.exportService = new VsCodeExportService(context);
    this.performanceProbe = new ExtensionHostPerformanceProbe(
      context.extensionMode === vscode.ExtensionMode.Test,
    );
    this.setEditorTextFocusContext(false);
  }

  private setEditorTextFocusContext(value: boolean): void {
    this.focusContextUpdates = this.focusContextUpdates
      .then(() => vscode.commands.executeCommand(
        'setContext',
        SdocEditorProvider.EDITOR_TEXT_FOCUS_CONTEXT,
        value,
      ))
      .catch((error: unknown) => {
        console.error('Failed to update Structured Doc editor text focus context', error);
      });
  }

  private updateEditorTextFocus(
    panel: vscode.WebviewPanel,
    identity: EditorTextFocusIdentity,
    focused: boolean,
  ): void {
    if (this.editorTextFocus.update(panel, identity, focused, panel.active)) {
      this.setEditorTextFocusContext(this.editorTextFocus.currentLease !== undefined);
    }
  }

  private releaseEditorTextFocus(
    panel: vscode.WebviewPanel,
    identity: EditorTextFocusIdentity,
  ): void {
    if (this.editorTextFocus.release(panel, identity)) {
      this.setEditorTextFocusContext(false);
    }
  }

  private dispose(): void {
    this.editorTextFocus.clear();
    // Extension reloads must also reset a context key left by an interrupted host.
    this.setEditorTextFocusContext(false);
    if (SdocEditorProvider.instance === this) {
      SdocEditorProvider.instance = undefined;
    }
  }

  private readDiagramRendererConsent(): DiagramRendererConsent {
    const stored = this.context.globalState.get<unknown>(DIAGRAM_RENDERER_CONSENT_STATE_KEY);
    return stored === 'undecided' || stored === 'granted' || stored === 'declined'
      ? stored
      : 'undecided';
  }

  private ensureDiagramRendererConsent(): Promise<DiagramRendererConsent> {
    if (this.diagramRendererConsentInitialization) return this.diagramRendererConsentInitialization;
    const stored = this.context.globalState.get<unknown>(DIAGRAM_RENDERER_CONSENT_STATE_KEY);
    const config = vscode.workspace.getConfiguration('structuredDocEditor.diagramRenderer');
    const legacyEnabled = config.inspect<unknown>('enabled')?.globalValue;
    const resolution = resolvePersistedDiagramRendererConsent(stored, legacyEnabled);
    if (!resolution.needsMigration) {
      this.diagramRendererConsentInitialization = Promise.resolve(resolution.consent);
      return this.diagramRendererConsentInitialization;
    }
    const initialization = Promise.resolve(this.context.globalState.update(
      DIAGRAM_RENDERER_CONSENT_STATE_KEY,
      resolution.consent,
    ))
      .then(() => this.readDiagramRendererConsent())
      .catch((error: unknown) => {
        console.error('Failed to migrate diagram renderer consent', error);
        return 'undecided' as const;
      });
    this.diagramRendererConsentInitialization = initialization;
    return initialization;
  }

  private readDiagramRendererSettings(): DiagramRendererSettings {
    const config = vscode.workspace.getConfiguration('structuredDocEditor.diagramRenderer');
    const userValue = <T,>(key: string, fallback: T): T => {
      const inspected = config.inspect<T>(key);
      return inspected?.globalValue ?? fallback;
    };
    return {
      consent: this.readDiagramRendererConsent(),
      endpoint: userValue('endpoint', DEFAULT_DIAGRAM_RENDERER_SETTINGS.endpoint),
      allowPrivateNetwork: userValue(
        'allowPrivateNetwork',
        DEFAULT_DIAGRAM_RENDERER_SETTINGS.allowPrivateNetwork,
      ),
    };
  }

  private synchronizeDiagramRendererRuntimes(
    settings: DiagramRendererSettings,
    abortActive: boolean,
  ): void {
    for (const [panel, runtime] of this.diagramRendererRuntimes) {
      runtime.service.updateSettings(settings);
      if (abortActive) {
        runtime.requests.forEach((controller) => controller.abort());
        runtime.requests.clear();
      }
      void panel.webview.postMessage({ type: 'diagramRendererSettings', settings });
    }
  }

  private readUiLanguagePreference(): UiLanguagePreference {
    const config = vscode.workspace.getConfiguration('structuredDocEditor.ui');
    const inspected = config.inspect<unknown>('language');
    return readUiLanguagePreference(inspected?.globalValue);
  }

  private resolveUiLocale() {
    return resolveUiLanguagePreference(
      this.readUiLanguagePreference(),
      vscode.env.language,
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    await this.ensureDiagramRendererConsent();
    // Setup webview
    const documentDir = vscode.Uri.joinPath(document.uri, '..');

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media', 'fonts'),
        vscode.Uri.joinPath(documentDir, 'images'),
        vscode.Uri.joinPath(documentDir, 'drawio'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    const sessionId = randomUUID();
    const documentId = document.uri.toString();
    const editorIdentity = { sessionId, documentId };
    const modifiedTokenCache = new RevisionBoundSdocModifiedTokenCache();
    const canonicalPersistenceCache = new RevisionBoundCanonicalPersistenceCache();
    const modifiedTokenAuthority: SdocModifiedTokenCacheAuthority = {
      sessionId,
      documentId,
      documentIdentity: document,
    };
    const invalidatePersistenceCaches = (): void => {
      modifiedTokenCache.invalidate();
      canonicalPersistenceCache.invalidate();
    };
    let latestFileOperationState: FileOperationState = { phase: 'idle' };
    let latestFileOperationPlan: FileOperationPlanView | undefined;
    const unavailableTestSeam = (): never => {
      throw new Error('The Structured Doc file-operation test seam is not ready.');
    };
    this.editorSessions.set(documentId, {
      document,
      panel: webviewPanel,
      sessionId,
      prepareFileOperation: async () => unavailableTestSeam(),
      getFileOperationSnapshot: () => ({
        state: latestFileOperationState,
        ...(latestFileOperationPlan ? { plan: latestFileOperationPlan } : {}),
      }),
      getPersistenceSnapshot: () => ({
        phase: latestSavePhase,
        revision: latestSaveRevision,
        isDirty: document.isDirty,
        externalChangeCount,
      }),
      confirmFileOperation: unavailableTestSeam,
      runResultAction: unavailableTestSeam,
    });
    let writeBlockedReason: string | undefined;
    let hasLoadedValidDocument = false;
    let readOnlyWarningShown = false;
    let templateApplicationPending = false;
    let templateManagementPending = false;
    let sessionDisposed = false;
    let activeFileOperationRequestId: string | undefined;
    let latestImportCheckpointArtifactId: FileOperationArtifactId | undefined;
    let saveGeneration = 0;
    let latestSavePhase: 'dirty' | 'saving' | 'saved' | 'failed' = document.isDirty
      ? 'dirty'
      : 'saved';
    let latestSaveRevision = document.version;
    let externalChangeCount = 0;
    let lastLocalMutation: DocumentMutation | undefined;
    let availableTemplates = new Map<string, SdocTemplate>();
    let personalTemplateFingerprints = new Map<string, string>();
    let templateCatalogGeneration = 0;
    const personalRootScope = vscode.env.remoteName ? 'remote' : 'local';
    const templateService = new VsCodeTemplateService({
      personalSourceLabel: vscode.env.remoteName
        ? `Remote (${vscode.env.remoteName}) · extension host home`
        : 'Local · extension host home',
    });
    const diagramService = new KrokiDiagramService(this.readDiagramRendererSettings());
    const diagramRequests = new Map<string, AbortController>();
    const filePreflightRequests = new Map<string, AbortController>();
    const handledResultActionIds = new Set<string>();
    this.diagramRendererRuntimes.set(webviewPanel, {
      service: diagramService,
      requests: diagramRequests,
    });
    const pendingImportAcks = new Map<string, {
      resolve: (applied: boolean) => void;
      timer: NodeJS.Timeout;
    }>();
    const waitForImportApplied = (requestId: string): Promise<boolean> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingImportAcks.delete(requestId);
          reject(new Error('Timed out waiting for the imported document to be applied.'));
        }, 10_000);
        pendingImportAcks.set(requestId, { resolve, timer });
      });
    const settleImportApplied = (requestId: string, applied: boolean): void => {
      const pending = pendingImportAcks.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingImportAcks.delete(requestId);
      pending.resolve(applied);
    };
    const claimFileOperation = (requestId: string): boolean => {
      if (activeFileOperationRequestId !== undefined) return false;
      activeFileOperationRequestId = requestId;
      return true;
    };
    const releaseFileOperation = (requestId: string): void => {
      if (activeFileOperationRequestId === requestId) activeFileOperationRequestId = undefined;
    };
    const prepareDiagramImages = async (
      format: ExportFormat,
      sourceDocument: TiptapNode,
      signal?: AbortSignal,
    ): Promise<DiagramPreparationResult | undefined> => {
      if (format !== 'html' && format !== 'pdf' && format !== 'slides') {
        return undefined;
      }
      return prepareExportDiagrams([{
        kind: 'document',
        scopeId: documentId,
        document: sourceDocument,
      }], {
        signal,
        render: async ({ language, source, signal: renderSignal }) => {
          const rendered = await diagramService.render(language, source, { signal: renderSignal });
          return { dataUrl: rendered.dataUrl };
        },
      });
    };

    const postFileOperationFailure = async (
      requestId: string,
      code: string,
      message: string,
      retryable: boolean,
      intent?: FileOperationIntent,
    ): Promise<void> => {
      latestFileOperationState = {
        phase: 'failed',
        requestId,
        error: createFileOperationError(code, message, retryable),
        ...(intent ? { intent } : {}),
      };
      await webviewPanel.webview.postMessage({
        type: 'fileOperationStatus',
        sessionId,
        documentId,
        state: {
          phase: 'failed',
          requestId,
          error: latestFileOperationState.phase === 'failed'
            ? latestFileOperationState.error
            : createFileOperationError(code, message, retryable),
          ...(intent ? { intent } : {}),
        },
      });
    };

    const postResultActionStatus = async (
      requestId: string,
      actionRequestId: string,
      action: FileOperationResultAction,
      status: 'completed' | 'failed',
      error?: ReturnType<typeof createFileOperationError>,
    ): Promise<void> => {
      await webviewPanel.webview.postMessage({
        type: 'fileOperationResultActionStatus',
        requestId,
        actionRequestId,
        sessionId,
        documentId,
        action,
        status,
        ...(error ? { error } : {}),
      });
    };

    const beginFileOperationPreflight = async (
      requestId: string,
      intent: FileOperationIntent,
      selectedImportUri?: vscode.Uri,
    ): Promise<void> => {
      if (!claimFileOperation(requestId)) {
        await postFileOperationFailure(
          requestId,
          'FILE_OPERATION_BUSY',
          'Another file operation is already running.',
          false,
          intent,
        );
        return;
      }
      this.fileOperations.rememberRetryIntent(sessionId, requestId, intent);
      const controller = new AbortController();
      let registeredPlanId: string | undefined;
      filePreflightRequests.set(requestId, controller);
      try {
        latestFileOperationPlan = undefined;
        latestFileOperationState = {
          phase: 'preflighting',
          requestId,
          intent,
          stage: intent.kind === 'export'
            ? 'Preparing immutable export snapshot…'
            : 'Choose a source file…',
        };
        await webviewPanel.webview.postMessage({
          type: 'fileOperationStatus',
          sessionId,
          documentId,
          state: {
            phase: 'preflighting',
            requestId,
            intent,
            stage: latestFileOperationState.phase === 'preflighting'
              ? latestFileOperationState.stage
              : undefined,
          },
        });
        await this.flushEditor(webviewPanel.webview, sessionId, documentId);
        controller.signal.throwIfAborted();
        if (intent.kind === 'export') {
          const prepared = await this.exportService.prepareDocumentExport(document, intent.format, {
            signal: controller.signal,
            diagramPreparation: (signal, sourceDocument) =>
              prepareDiagramImages(intent.format, sourceDocument, signal),
          });
          const { planId } = this.fileOperations.registerPlan({
            sessionId, requestId, intent,
            sourceFingerprint: prepared.sourceFingerprint,
            targetFingerprint: prepared.targetFingerprint,
            payload: { kind: 'export', prepared },
          });
          registeredPlanId = planId;
          controller.signal.throwIfAborted();
          const effectiveSettings = projectStandaloneExportSettings(
            prepared.settingsSnapshot,
            intent.format,
          );
          const plan: FileOperationPlanView = {
            planId, intent,
            source: {
              displayName: path.basename(document.uri.fsPath),
              sizeBytes: new TextEncoder().encode(prepared.sourceText).byteLength,
              revision: prepared.sourceVersion,
            },
            destination: {
              displayName: `${prepared.outputScope === 'workspace' ? 'Workspace' : 'Document folder'} · ${prepared.outputRelativePath}`,
              exists: prepared.targetExists,
              scope: prepared.outputScope,
              relativePath: prepared.outputRelativePath,
            },
            effectiveSettings,
            diagram: {
              failurePolicy: 'source-fallback',
              fallbackCount: prepared.diagramFallbackCount,
            },
            warnings: prepared.warnings,
            requiresConfirmation: true,
          };
          latestFileOperationPlan = plan;
          latestFileOperationState = {
            phase: 'awaiting-confirmation', requestId, intent, plan,
          };
          const delivered = await webviewPanel.webview.postMessage({
            type: 'fileOperationPreflight', requestId, sessionId, documentId,
            plan,
          });
          if (!delivered) throw new Error('The editor is unavailable for export confirmation.');
        } else {
          const selected = selectedImportUri ? [selectedImportUri] : await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: intent.format === 'markdown'
                ? { 'Markdown Files': ['md', 'markdown'] }
                : { 'HTML Files': ['html', 'htm'] },
            });
          if (!selected?.[0]) {
            releaseFileOperation(requestId);
            await webviewPanel.webview.postMessage({
              type: 'fileOperationStatus', sessionId, documentId,
              state: { phase: 'cancelled', requestId, intent },
            });
            return;
          }
          controller.signal.throwIfAborted();
          const sourceUri = selected[0];
          const bytes = await readBoundedWorkspaceFile(sourceUri, MAX_IMPORT_BYTES, 'Import source');
          controller.signal.throwIfAborted();
          const sourceText = new TextDecoder().decode(bytes);
          const imported = intent.format === 'markdown'
            ? {
              kind: 'markdown' as const,
              content: convertImagePathsToWebviewUris(
                convertMarkdownToJson(sourceText), documentDir, webviewPanel.webview,
              ),
            }
            : { kind: 'html' as const, html: sourceText };
          const htmlSummary = imported.kind === 'html' ? summarizeImportedHtml(sourceText) : undefined;
          const outline = imported.kind === 'markdown'
            ? (imported.content.content ?? []).flatMap((node) => {
              if (node.type !== 'heading') return [];
              const title = (node.content ?? [])
                .map((child) => typeof child.text === 'string' ? child.text : '')
                .join('').trim();
              return title ? [{
                level: typeof node.attrs?.level === 'number' ? node.attrs.level : 1,
                title,
              }] : [];
            })
            : htmlSummary?.outline ?? [];
          const { planId } = this.fileOperations.registerPlan({
            sessionId, requestId, intent,
            sourceFingerprint: computeRevision(sourceText),
            targetFingerprint: this.exportService.readSourceFingerprint(document),
            payload: {
              kind: 'import', sourceUri, sourceText, imported,
              checkpoint: readCurrentMutation(),
            },
          });
          registeredPlanId = planId;
          controller.signal.throwIfAborted();
          const plan: FileOperationPlanView = {
            planId, intent,
            source: { displayName: path.basename(sourceUri.fsPath), sizeBytes: bytes.byteLength },
            importPreview: {
              outline,
              topLevelBlockCount: imported.kind === 'markdown'
                ? imported.content.content?.length ?? 0
                : htmlSummary?.topLevelBlockCount ?? 0,
              replacement: 'body-only',
              preserved: ['metadata', 'settings'],
            },
            warnings: [
              'The document body will be replaced; metadata and settings are preserved.',
              ...(htmlSummary?.warnings ?? []),
            ],
            requiresConfirmation: true,
          };
          latestFileOperationPlan = plan;
          latestFileOperationState = {
            phase: 'awaiting-confirmation', requestId, intent, plan,
          };
          const delivered = await webviewPanel.webview.postMessage({
            type: 'fileOperationPreflight', requestId, sessionId, documentId,
            plan,
          });
          if (!delivered) throw new Error('The editor is unavailable for import confirmation.');
        }
      } catch (error) {
        if (registeredPlanId) {
          this.fileOperations.cancelPlan(sessionId, requestId, registeredPlanId);
        }
        releaseFileOperation(requestId);
        if (controller.signal.aborted) {
          await webviewPanel.webview.postMessage({
            type: 'fileOperationStatus', sessionId, documentId,
            state: { phase: 'cancelled', requestId, intent },
          });
        } else {
          console.error('Structured Doc file operation preflight failed', error);
          await postFileOperationFailure(
            requestId, 'PREFLIGHT_FAILED', 'The file operation could not be prepared.', true, intent,
          );
        }
      } finally {
        filePreflightRequests.delete(requestId);
      }
    };

    const readDocSettings = (): Partial<DocumentSettings> | undefined => {
      try {
        const text = document.getText();
        const parsed: unknown = text.trim() ? JSON.parse(text) : {};
        return readDocumentSettings(parsed);
      } catch {
        return undefined;
      }
    };

    const sendSettings = () => {
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      const docSettings = readDocSettings();
      const resolved = resolveEditorSettings(docSettings, undefined, {
        defaultImageAlignment: config.get<'left' | 'center' | 'right'>(
          'image.defaultAlignment', HOST_SETTING_DEFAULTS.defaultImageAlignment,
        ),
        exportImagePath: config.get<'relative' | 'absolute'>(
          'export.imagePath', HOST_SETTING_DEFAULTS.exportImagePath,
        ),
      });
      const preset = getCaptionPreset(resolved.captionStyle);
      webviewPanel.webview.postMessage({
        type: 'settingsChanged',
        settings: {
          captionStyle: resolved.captionStyle,
          imageCaptionPrefix: preset.figurePrefix,
          tableCaptionPrefix: preset.tablePrefix,
          equationCaptionPrefix: preset.equationPrefix,
          captionSeparator: preset.separator,
          tableNumberStyle: preset.tableNumberStyle,
          equationParens: preset.equationParens,
          captionNumbering: resolved.captionNumbering,
          equationNumbering: resolved.equationNumbering,
          crossRefIncludeCaption: resolved.crossRefIncludeCaption,
          headingNumbering: resolved.headingNumbering,
          headingStartNumber: resolved.headingStartNumber,
          headingDecoration: resolved.headingDecoration,
          headingH1Color: resolved.headingH1Color,
          headingH2Color: resolved.headingH2Color,
          headingH3Color: resolved.headingH3Color,
          headingH4Color: resolved.headingH4Color,
          headingH5Color: resolved.headingH5Color,
          headingH6Color: resolved.headingH6Color,
          defaultImageAlignment: resolved.defaultImageAlignment,
          exportImagePath: resolved.exportImagePath,
          pdfScale: resolved.pdfScale,
          selfContained: resolved.selfContained,
          slideBreakLevel: resolved.slideBreakLevel,
          slideTransition: resolved.slideTransition,
          showTitleSlide: resolved.showTitleSlide,
          outputDir: resolved.outputDir,
          fontWeightBody: config.get<string>('font.body', HOST_SETTING_DEFAULTS.fontWeightBody),
          fontWeightBold: config.get<string>('font.bold', HOST_SETTING_DEFAULTS.fontWeightBold),
          fontWeightH1: config.get<string>('font.h1', HOST_SETTING_DEFAULTS.fontWeightH1),
          fontWeightH2: config.get<string>('font.h2', HOST_SETTING_DEFAULTS.fontWeightH2),
          fontWeightH3: config.get<string>('font.h3', HOST_SETTING_DEFAULTS.fontWeightH3),
        },
      });
      // Also send raw doc-level settings so the Settings Panel knows what's overridden
      webviewPanel.webview.postMessage({
        type: 'docSettingsChanged',
        docSettings: docSettings || null,
      });
    };

    const sendUiLanguage = () => {
      webviewPanel.webview.postMessage({
        type: 'uiLanguageChanged',
        preference: this.readUiLanguagePreference(),
        locale: this.resolveUiLocale(),
      });
    };

    const contractFailureDetail = (
      contract: Extract<DocumentTextContractResult, { ok: false }>,
    ): string => contract.diagnostics
      .map((item) => `${item.path}: ${item.message}`)
      .join('; ') || 'The document is invalid.';

    const mutationFromEnvelope = (
      envelope: Extract<DocumentTextContractResult, { ok: true }>['envelope'],
    ): DocumentMutation => {
      const { settings: documentSettings, ...persistedMeta } = envelope.meta;
      return {
        content: convertImagePathsToWebviewUris(envelope.doc, documentDir, webviewPanel.webview),
        meta: persistedMeta,
        documentSettings: documentSettings ?? null,
      };
    };

    // Send initial document content with image paths converted
    const sendUpdate = () => {
      invalidatePersistenceCaches();
      const contract = parseDocumentTextContract(document.getText());
      if (!contract.ok) {
        writeBlockedReason = contractFailureDetail(contract);
        if (!readOnlyWarningShown) {
          readOnlyWarningShown = true;
          void vscode.window.showWarningMessage(
            `Structured Doc opened read-only to protect the original file: ${writeBlockedReason}`,
          );
        }
        void webviewPanel.webview.postMessage({
          type: 'init',
          locale: this.resolveUiLocale(),
          sessionId,
          documentId,
          revision: document.version,
          isDirty: document.isDirty,
          performanceEnabled: this.context.extensionMode === vscode.ExtensionMode.Test,
          documentState: {
            status: 'invalid',
            reason: contract.kind,
            diagnostics: contract.diagnostics,
          },
        });
      } else {
        writeBlockedReason = undefined;
        hasLoadedValidDocument = true;
        const snapshot = mutationFromEnvelope(contract.envelope);
        canonicalPersistenceCache.adopt(modifiedTokenAuthority, {
          revision: document.version,
          componentRevisions: { content: 0, metadata: 0, settings: 0 },
          metadata: snapshot.meta,
          documentSettings: snapshot.documentSettings,
        });
        lastLocalMutation = snapshot;
        void webviewPanel.webview.postMessage({
          type: 'init',
          locale: this.resolveUiLocale(),
          sessionId,
          documentId,
          revision: document.version,
          isDirty: document.isDirty,
          performanceEnabled: this.context.extensionMode === vscode.ExtensionMode.Test,
          documentState: { status: 'ready', snapshot },
        });
      }
      sendUiLanguage();
      sendSettings();
    };

    const readCurrentMutation = (): DocumentMutation => {
      const contract = parseDocumentTextContract(document.getText());
      if (!contract.ok) throw new Error(contractFailureDetail(contract));
      return mutationFromEnvelope(contract.envelope);
    };

    const tryReadCurrentMutation = (): DocumentMutation | undefined =>
      readDocumentMutationBestEffort(readCurrentMutation);

    const postExternalChange = (): void => {
      invalidatePersistenceCaches();
      const contract = parseDocumentTextContract(document.getText());
      if (!contract.ok) {
        if (!hasLoadedValidDocument) {
          sendUpdate();
          return;
        }
        writeBlockedReason = contractFailureDetail(contract);
        void webviewPanel.webview.postMessage({
          type: 'externalInvalidDocument',
          sessionId,
          documentId,
          revision: document.version,
          reason: contract.kind,
          diagnostics: contract.diagnostics,
          canRecoverFromLocal: hasLoadedValidDocument,
        });
        return;
      }
      if (!hasLoadedValidDocument) {
        sendUpdate();
        return;
      }
      writeBlockedReason = undefined;
      const snapshot = mutationFromEnvelope(contract.envelope);
      if (lastLocalMutation
        && areDocumentMutationsSemanticallyEqual(lastLocalMutation, snapshot)) {
        lastLocalMutation = snapshot;
        void webviewPanel.webview.postMessage({
          type: 'documentRevisionAdvanced',
          sessionId,
          documentId,
          revision: document.version,
        });
        return;
      }
      externalChangeCount += 1;
      void webviewPanel.webview.postMessage({
        type: 'externalChange', sessionId, documentId, revision: document.version,
        snapshot,
      });
    };

    const postExplicitReplacement = (
      reason: 'user-reload' | 'confirmed-template',
    ): void => {
      invalidatePersistenceCaches();
      const snapshot = readCurrentMutation();
      lastLocalMutation = snapshot;
      webviewPanel.webview.postMessage({
        type: 'replaceDocument',
        sessionId,
        documentId,
        revision: document.version,
        reason,
        snapshot,
      });
    };

    const currentDocumentIdentity = (): CurrentDocumentIdentity => ({
      sessionId,
      documentId,
      revision: document.version,
    });

    const workspaceTemplateRoots = (): WorkspaceTemplateRoot[] =>
      (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => isFilesystemBackedScheme(folder.uri.scheme))
        .map((folder) => ({
          identity: folder.uri.toString(),
          name: folder.name,
          rootPath: folder.uri.fsPath,
        }));

    const sendTemplateCatalog = async (requestId: string): Promise<void> => {
      const generation = ++templateCatalogGeneration;
      try {
        const discovery = await templateService.discover(workspaceTemplateRoots());
        if (generation === templateCatalogGeneration) {
          availableTemplates = new Map(
            discovery.catalog.templates.map((template) => [template.descriptor.id, template]),
          );
          personalTemplateFingerprints = new Map(discovery.personalFingerprints);
        }
      const diagnosticCount = discovery.hostDiagnostics.length + discovery.catalog.diagnostics.length;
      if (diagnosticCount > 0) {
        console.warn('Structured Doc template discovery diagnostics', {
          host: discovery.hostDiagnostics,
          contract: discovery.catalog.diagnostics,
        });
      }
        webviewPanel.webview.postMessage({
        type: 'templateCatalog',
        requestId,
        templates: discovery.catalog.templates.map((template) => ({
          ...template.descriptor,
          sourceLabel: template.descriptor.source === 'builtin'
            ? 'Structured Doc Editor'
            : template.descriptor.source === 'workspace'
              ? 'Workspace templates'
              : `${personalRootScope === 'remote' ? 'Remote' : 'Local'} · ~/.sdoc/templates`,
          preview: buildTemplateStructuralPreview(template),
          ...(discovery.personalFingerprints.has(template.descriptor.id)
            ? { revisionToken: discovery.personalFingerprints.get(template.descriptor.id) }
            : {}),
        })),
        diagnostics: [
          ...projectTemplateCatalogDiagnostics(discovery.catalog.diagnostics, 'catalog'),
          ...discovery.hostDiagnostics.map((diagnostic, index) => {
            const code: TemplateDiagnostic['code'] =
              diagnostic.code === 'invalid-json' ? 'malformed-document'
                : diagnostic.code === 'file-too-large' ? 'file-too-large'
                  : diagnostic.code === 'candidate-limit-exceeded' ? 'candidate-limit-exceeded'
                    : diagnostic.code === 'read-failed' ? 'read-failed'
                      : diagnostic.code === 'unsupported-file-type' ? 'unsupported-filesystem'
                        : 'unsafe-path';
            return projectTemplateCatalogDiagnostic({
              code,
              targetPath: diagnostic.targetPath,
              message: 'Template discovery failed.',
            }, 'catalog', index);
          }),
        ],
        personalRootScope,
        });
      } catch (error) {
        console.error('Structured Doc template catalog discovery failed', error);
        webviewPanel.webview.postMessage({
          type: 'templateCatalogFailed',
          requestId,
          error: {
            code: 'catalog-unavailable',
            message: 'The template catalog could not be loaded.',
          },
        });
      }
    };

    const applyTemplateToCurrentDocument = async (
      templateId: string,
      expected: CurrentDocumentIdentity,
    ): Promise<boolean> => {
      if (!canApplyTemplateToCurrentDocument(
        document.getText(), document.getText(), expected, currentDocumentIdentity(),
      )) {
        return false;
      }

      const template = availableTemplates.get(templateId);
      if (!template) {
        return false;
      }
      const defaultTitle = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
        || 'Untitled';
      const baselineText = document.getText();
      const prepared = prepareCurrentDocumentTemplateApplication({
        currentText: baselineText,
        template,
        defaultTitle,
      });
      const committed = await commitCurrentDocumentTemplateApplication({
        expectedText: baselineText,
        currentText: document.getText(),
        expected,
        current: currentDocumentIdentity(),
        preparedText: prepared.text,
        apply: async (text) => {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
            text,
          );
          await this.applyExpectedEdit(document, edit, text, {
            version: expected.revision,
            text: baselineText,
          });
        },
      });
      if (!committed) {
        return false;
      }
      postExplicitReplacement('confirmed-template');
      return true;
    };

    type PersonalTemplateRequest = Extract<EditorToHostMessage, {
      type:
        | 'savePersonalTemplate'
        | 'updatePersonalTemplate'
        | 'duplicatePersonalTemplate'
        | 'deletePersonalTemplate'
        | 'openPersonalTemplateFolder';
    }>;

    const templateRequestFailure = (code: TemplateErrorCode, message: string): never => {
      throw Object.assign(new Error(message), { templateErrorCode: code });
    };

    const classifyTemplateRequestError = (error: unknown): TemplateOperationError => {
      if (error instanceof Error && 'templateErrorCode' in error) {
        const code = (error as Error & { templateErrorCode: TemplateErrorCode }).templateErrorCode;
        return { code, message: 'The template action could not be completed.' };
      }
      return { code: 'operation-failed', message: 'The template action could not be completed.' };
    };

    const requireLiveTemplateRequest = (
      request: Extract<PersonalTemplateRequest, { sessionId: string }>,
    ): void => {
      const current = currentDocumentIdentity();
      if (request.sessionId !== current.sessionId
        || request.documentId !== current.documentId
        || request.baseRevision !== current.revision) {
        templateRequestFailure(
          'document-changed',
          'The document changed before the template operation started.',
        );
      }
    };

    const handlePersonalTemplateRequest = async (
      request: PersonalTemplateRequest,
    ): Promise<void> => {
      let operation: PersonalTemplateOperation;
      switch (request.type) {
        case 'savePersonalTemplate': operation = 'save'; break;
        case 'updatePersonalTemplate': operation = 'update'; break;
        case 'duplicatePersonalTemplate': operation = 'duplicate'; break;
        case 'deletePersonalTemplate': operation = 'delete'; break;
        case 'openPersonalTemplateFolder': operation = 'open-folder'; break;
      }
      let result: 'completed' | 'failed' = 'failed';
      let resultTemplateId: string | undefined;
      let resultError: TemplateOperationError | undefined;
      try {
        if ('sessionId' in request) {
          await messageQueue.whenIdle();
          requireLiveTemplateRequest(request);
        }
        if (request.type === 'openPersonalTemplateFolder') {
          const personalRoot = await templateService.ensurePersonalTemplateRoot();
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(personalRoot));
          result = 'completed';
          return;
        }
        if (request.type === 'deletePersonalTemplate') {
          const template = availableTemplates.get(request.templateId);
          if (!template || template.descriptor.source !== 'user') {
            return templateRequestFailure('template-unavailable', 'The selected personal template is no longer available.');
          }
          if (personalTemplateFingerprints.get(request.templateId) !== request.revisionToken) {
            templateRequestFailure('template-changed', 'The selected personal template changed.');
          }
          await templateService.trashPersonalTemplate(request.templateId, request.revisionToken);
          result = 'completed';
          resultTemplateId = request.templateId;
          return;
        }
        if (request.type === 'updatePersonalTemplate' || request.type === 'duplicatePersonalTemplate') {
          const template = availableTemplates.get(request.templateId);
          const currentFingerprint = personalTemplateFingerprints.get(request.templateId);
          if (!template || template.descriptor.source !== 'user') {
            return templateRequestFailure('template-unavailable', 'The selected personal template is no longer available.');
          }
          if (currentFingerprint !== request.revisionToken) {
            templateRequestFailure('template-changed', 'The selected personal template changed.');
          }
          const metadata = request.metadata;
          if (request.type === 'updatePersonalTemplate') {
            const updated = updatePersonalTemplateMetadata(template, metadata);
            await templateService.updatePersonalTemplate(
              request.templateId,
              request.revisionToken,
              updated.envelope,
            );
            resultTemplateId = request.templateId;
          } else {
            const newTemplateId = `user:${randomUUID()}`;
            const duplicate = createPersonalTemplateSnapshot(template.envelope, {
              id: newTemplateId,
              ...metadata,
              titleNodeId: template.descriptor.titleNodeId,
              sourceLabel: template.descriptor.sourceLabel,
            });
            await templateService.createPersonalTemplate(newTemplateId, duplicate.envelope);
            resultTemplateId = newTemplateId;
          }
          result = 'completed';
          return;
        }

        await messageQueue.whenIdle();
        requireLiveTemplateRequest(request);
        await this.flushEditor(webviewPanel.webview, sessionId, documentId);
        await messageQueue.whenIdle();
        const baselineIdentity = currentDocumentIdentity();
        const baselineText = document.getText();
        const metadata = request.metadata;
        if (document.getText() !== baselineText
          || currentDocumentIdentity().revision !== baselineIdentity.revision) {
          templateRequestFailure('document-changed', 'The document changed during the template operation.');
        }
        const source: unknown = isUninitializedSdocText(baselineText)
          ? { sdoc: '1.0', meta: {}, doc: { type: 'doc', content: [] } }
          : JSON.parse(baselineText);
        const contract = parseDocumentContract(source);
        if (!contract.ok || contract.legacy) {
          return templateRequestFailure('invalid-document', 'Only a valid SDOC 1.0 document can be saved as a personal template.');
        }
        const persistedSource = {
          ...contract.envelope,
          doc: dehydrateDocumentAssets(contract.envelope.doc),
        };
        const newTemplateId = `user:${randomUUID()}`;
        const snapshot = createPersonalTemplateSnapshot(persistedSource, {
          id: newTemplateId,
          ...metadata,
          titleNodeId: suggestTemplateTitleNodeId(contract.envelope),
          sourceLabel: templateService.personalTemplateRootPath,
        });
        await templateService.createPersonalTemplate(newTemplateId, snapshot.envelope);
        result = 'completed';
        resultTemplateId = newTemplateId;
      } catch (error) {
        resultError = classifyTemplateRequestError(error);
        console.error('Structured Doc template operation failed', error);
      } finally {
        templateManagementPending = false;
        webviewPanel.webview.postMessage({
          type: 'templateOperationFinished',
          requestId: request.requestId,
          operation,
          result,
          ...(resultTemplateId ? { templateId: resultTemplateId } : {}),
          ...(resultError ? { error: resultError } : {}),
        });
      }
    };

    // Handle messages from webview (sequential queue to preserve order)
    const messageQueue = new RecoverableSerialQueue();
    const handleEditorMessage = (message: unknown): void => {
      if (!isEditorToHostMessage(message)) {
        console.warn('Ignoring malformed Structured Doc editor message', message);
        return;
      }
      if (message.type === 'editorTextFocusChanged') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        const registeredSession = this.editorSessions.get(documentId);
        if (registeredSession?.panel !== webviewPanel
          || registeredSession.sessionId !== sessionId
          || registeredSession.document !== document) return;
        this.updateEditorTextFocus(webviewPanel, editorIdentity, message.focused);
        return;
      }
      const readOnlySafeMessages = new Set([
        'ready', 'flushComplete', 'viewJson', 'export', 'openDocument', 'browseSdocFiles',
        'fileOperationApplied', 'recoverInvalidDocument',
        'fileOperationPrepare', 'fileOperationExecute', 'fileOperationCancel',
        'fileOperationRetry', 'fileOperationResultAction',
        'requestTemplateCatalog',
        'createDocumentFromTemplate', 'openExistingDocument',
        'savePersonalTemplate', 'updatePersonalTemplate', 'duplicatePersonalTemplate',
        'deletePersonalTemplate', 'openPersonalTemplateFolder',
        'renderDiagram', 'cancelDiagramRender', 'updateDiagramRendererSettings',
        'resolveDiagramRendererConsent',
        'testDiagramRendererConnection', 'updateUiLanguage',
      ]);
      if (writeBlockedReason && !readOnlySafeMessages.has(message.type)) {
        if (message.type === 'edit') {
          const hostSnapshot = tryReadCurrentMutation();
          webviewPanel.webview.postMessage({
            type: 'editRejected',
            sessionId,
            documentId,
            editId: message.editId,
            revision: document.version,
            code: 'INVALID_DOCUMENT',
            message: writeBlockedReason,
            ...(hostSnapshot ? { hostSnapshot } : {}),
          });
          if (message.flushRequestId) {
            this.rejectFlush(message.flushRequestId, new Error(writeBlockedReason));
          }
        }
        vscode.window.showErrorMessage(`Document is read-only because it is invalid: ${writeBlockedReason}`);
        if (message.type === 'applyTemplate') {
          webviewPanel.webview.postMessage({
            type: 'templateApplicationFinished',
            requestId: message.requestId,
            result: 'failed',
          });
        }
        return;
      }
      // File preflight stays outside the serial queue because its flush acknowledgement
      // is itself an editor message and would otherwise wait behind this request.
      if (message.type === 'export') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        void beginFileOperationPreflight(message.requestId, {
          kind: 'export', format: message.format,
        });
        return;
      }
      if (message.type === 'importMarkdown' || message.type === 'importHtml') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        void beginFileOperationPreflight(message.requestId, {
          kind: 'import',
          format: message.type === 'importMarkdown' ? 'markdown' : 'html',
        });
        return;
      }
      if (message.type === 'fileOperationPrepare') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        void beginFileOperationPreflight(message.requestId, message.intent);
        return;
      }
      if (message.type === 'fileOperationExecute') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        if (activeFileOperationRequestId !== message.requestId) {
          void postFileOperationFailure(
            message.requestId,
            'PLAN_NOT_FOUND',
            'The prepared file operation is no longer active.',
            false,
          );
          return;
        }
        void (async () => {
          try {
            const plan = this.fileOperations.getPlan(sessionId, message.requestId, message.planId);
            latestFileOperationState = {
              phase: 'running', requestId: message.requestId,
              kind: plan.intent.kind, format: plan.intent.format,
              intent: plan.intent, planId: message.planId, stage: 'Starting export…',
            };
            await webviewPanel.webview.postMessage({
              type: 'fileOperationStatus', sessionId, documentId,
              state: {
                phase: 'running', requestId: message.requestId,
                kind: plan.intent.kind, format: plan.intent.format,
                intent: plan.intent, planId: message.planId, stage: 'Starting export…',
              },
            });
            const result = await this.fileOperations.executePlan({
              sessionId, requestId: message.requestId, planId: message.planId,
              readSourceFingerprint: async () => plan.payload.kind === 'export'
                ? this.exportService.readSourceFingerprint(document)
                : computeRevision(new TextDecoder().decode(await readBoundedWorkspaceFile(
                  plan.payload.sourceUri, MAX_IMPORT_BYTES, 'Import source',
                ))),
              readTargetFingerprint: async () => plan.payload.kind === 'export'
                ? this.exportService.readTargetFingerprint(plan.payload.prepared.outputUri)
                : this.exportService.readSourceFingerprint(document),
              onProgress: (stage) => {
                latestFileOperationState = {
                  phase: 'running', requestId: message.requestId,
                  kind: plan.intent.kind, format: plan.intent.format,
                  intent: plan.intent, planId: message.planId, stage,
                };
                void webviewPanel.webview.postMessage({
                  type: 'fileOperationStatus', sessionId, documentId,
                  state: {
                    phase: 'running', requestId: message.requestId,
                    kind: plan.intent.kind, format: plan.intent.format,
                    intent: plan.intent, planId: message.planId, stage,
                  },
                });
              },
              run: async (registered, signal, report) => {
                if (registered.payload.kind === 'import') {
                  signal.throwIfAborted();
                  report('Applying imported body…');
                  invalidatePersistenceCaches();
                  this.fileOperations.markCommitStarted(
                    sessionId, message.requestId, message.planId,
                  );
                  const imported = registered.payload.imported;
                  const applied = waitForImportApplied(message.requestId);
                  const delivered = await webviewPanel.webview.postMessage(imported.kind === 'markdown' ? {
                    type: 'importContent', requestId: message.requestId, sessionId, documentId,
                    confirmation: 'preflight-confirmed', content: imported.content,
                  } : {
                    type: 'importHtml', requestId: message.requestId, sessionId, documentId,
                    confirmation: 'preflight-confirmed', html: imported.html,
                  });
                  if (!delivered) settleImportApplied(message.requestId, false);
                  if (!await applied) {
                    throw new Error('The imported body was not applied.');
                  }
                  return { kind: 'import' as const, checkpoint: registered.payload.checkpoint };
                }
                const exportPayload = registered.payload;
                return {
                  kind: 'export' as const,
                  value: await this.exportService.executePreparedExport(
                    exportPayload.prepared,
                    {
                      signal,
                      onProgress: report,
                      validateTarget: async () => {
                        await this.exportService.validatePreparedOutputScope(exportPayload.prepared);
                        const current = await this.exportService.readTargetFingerprint(
                          exportPayload.prepared.outputUri,
                        );
                        if (current !== registered.targetFingerprint) {
                          throw new FileOperationPlanError(
                            'STALE_TARGET', 'The destination changed after preflight.',
                          );
                        }
                      },
                      onCommitStart: () => this.fileOperations.markCommitStarted(
                        sessionId, message.requestId, message.planId,
                      ),
                    },
                  ),
                };
              },
            });
            if (sessionDisposed) return;
            if (result.kind === 'import') {
              if (latestImportCheckpointArtifactId) {
                this.fileOperations.deleteArtifact(sessionId, latestImportCheckpointArtifactId);
              }
              const { artifactId } = this.fileOperations.registerArtifact(sessionId, {
                kind: 'import-checkpoint',
                mutation: result.checkpoint,
                intent: plan.intent.kind === 'import'
                  ? plan.intent
                  : { kind: 'import', format: 'markdown' },
                expectedCurrentFingerprint: this.exportService.readSourceFingerprint(document),
              });
              latestImportCheckpointArtifactId = artifactId;
              latestFileOperationState = {
                phase: 'succeeded', requestId: message.requestId,
                result: 'completed', intent: plan.intent,
                details: {
                  outcome: 'completed',
                  warnings: [],
                  availableActions: [
                    { action: 'undo', artifactId },
                    { action: 'repeat' },
                  ],
                },
              };
              await webviewPanel.webview.postMessage({
                type: 'fileOperationStatus', sessionId, documentId,
                state: {
                  phase: 'succeeded', requestId: message.requestId,
                  result: 'completed', intent: plan.intent,
                  details: {
                    outcome: 'completed',
                    warnings: [],
                    availableActions: [
                      { action: 'undo', artifactId },
                      { action: 'repeat' },
                    ],
                  },
                },
              });
              return;
            }
            if (result.value.outcome === 'cancelled' || !result.value.outputUri) {
              latestFileOperationState = {
                phase: 'cancelled', requestId: message.requestId, intent: plan.intent,
              };
              await webviewPanel.webview.postMessage({
                type: 'fileOperationStatus', sessionId, documentId,
                state: { phase: 'cancelled', requestId: message.requestId, intent: plan.intent },
              });
              return;
            }
            const { artifactId } = this.fileOperations.registerArtifact(sessionId, {
              kind: 'export',
              uri: result.value.outputUri,
              openKind: plan.payload.kind === 'export'
                ? plan.payload.prepared.openKind
                : 'text',
            });
            latestFileOperationState = {
              phase: 'succeeded', requestId: message.requestId,
              result: result.value.outcome, intent: plan.intent,
              details: {
                outcome: result.value.outcome,
                artifact: {
                  artifactId,
                  displayName: path.basename(result.value.outputUri.fsPath),
                  sizeBytes: result.value.sizeBytes ?? 0,
                },
                warnings: plan.payload.kind === 'export'
                  ? [...plan.payload.prepared.warnings]
                  : [],
                availableActions: [
                  { action: 'open', artifactId },
                  { action: 'reveal', artifactId },
                  { action: 'copy', artifactId },
                  { action: 'repeat' },
                ],
              },
            };
            await webviewPanel.webview.postMessage({
              type: 'fileOperationStatus', sessionId, documentId,
              state: {
                phase: 'succeeded', requestId: message.requestId,
                result: result.value.outcome, intent: plan.intent,
                details: {
                  outcome: result.value.outcome,
                  artifact: {
                    artifactId,
                    displayName: path.basename(result.value.outputUri.fsPath),
                    sizeBytes: result.value.sizeBytes ?? 0,
                  },
                  warnings: plan.payload.kind === 'export'
                    ? [...plan.payload.prepared.warnings]
                    : [],
                  availableActions: [
                    { action: 'open', artifactId },
                    { action: 'reveal', artifactId },
                    { action: 'copy', artifactId },
                    { action: 'repeat' },
                  ],
                },
              },
            });
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              latestFileOperationState = {
                phase: 'cancelled', requestId: message.requestId,
                intent: this.fileOperations.getRetryIntent(sessionId, message.requestId),
              };
              await webviewPanel.webview.postMessage({
                type: 'fileOperationStatus', sessionId, documentId,
                state: {
                  phase: 'cancelled', requestId: message.requestId,
                  intent: this.fileOperations.getRetryIntent(sessionId, message.requestId),
                },
              });
              return;
            }
            console.error('Structured Doc file operation execution failed', error);
            const retryIntent = this.fileOperations.getRetryIntent(sessionId, message.requestId);
            const code = error instanceof FileOperationPlanError
              ? error.code
              : retryIntent?.kind === 'import' ? 'IMPORT_FAILED' : 'EXPORT_FAILED';
            await postFileOperationFailure(
              message.requestId,
              code,
              retryIntent?.kind === 'import'
                ? 'The prepared import could not be completed.'
                : 'The prepared export could not be completed.',
              true,
              retryIntent,
            );
          } finally {
            releaseFileOperation(message.requestId);
          }
        })();
        return;
      }
      if (message.type === 'fileOperationCancel') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        const preflight = filePreflightRequests.get(message.requestId);
        preflight?.abort();
        const planCancelled = this.fileOperations.cancelPlan(
          sessionId,
          message.requestId,
          preflight ? undefined : message.planId,
        );
        const cancelled = Boolean(preflight) || planCancelled;
        if (!cancelled) return;
        releaseFileOperation(message.requestId);
        void webviewPanel.webview.postMessage({
          type: 'fileOperationStatus', sessionId, documentId,
          state: {
            phase: 'cancelled', requestId: message.requestId,
            intent: this.fileOperations.getRetryIntent(sessionId, message.requestId),
          },
        });
        return;
      }
      if (message.type === 'fileOperationRetry') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        const intent = this.fileOperations.getRetryIntent(sessionId, message.previousRequestId);
        if (!intent) {
          void postFileOperationFailure(
            message.requestId, 'PLAN_NOT_FOUND', 'The previous operation is unavailable.', false,
          );
        } else {
          void beginFileOperationPreflight(message.requestId, intent);
        }
        return;
      }
      if (message.type === 'fileOperationResultAction') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        if (handledResultActionIds.has(message.actionRequestId)) return;
        handledResultActionIds.add(message.actionRequestId);
        if (message.action === 'repeat') {
          const intent = this.fileOperations.getRetryIntent(sessionId, message.requestId);
          if (intent) {
            void beginFileOperationPreflight(message.actionRequestId, intent);
          } else {
            void postResultActionStatus(
              message.requestId,
              message.actionRequestId,
              message.action,
              'failed',
              createFileOperationError(
                'PLAN_NOT_FOUND', 'The previous operation is unavailable.', false,
              ),
            );
          }
          return;
        }
        void (async () => {
          if (message.action === 'undo') {
            if (!claimFileOperation(message.actionRequestId)) {
              throw new FileOperationPlanError(
                'PLAN_ALREADY_RUNNING', 'Another file operation is already running.',
              );
            }
            try {
              const lease = this.fileOperations.leaseArtifact(sessionId, message.artifactId);
              try {
                const artifact = lease.value;
                if (artifact.kind !== 'import-checkpoint') {
                  lease.release();
                  return;
                }
                if (this.exportService.readSourceFingerprint(document)
                  !== artifact.expectedCurrentFingerprint) {
                  throw new FileOperationPlanError(
                    'STALE_SOURCE', 'The document changed after the import completed.',
                  );
                }
                await webviewPanel.webview.postMessage({
                  type: 'fileOperationStatus', sessionId, documentId,
                  state: {
                    phase: 'running', requestId: message.actionRequestId,
                    kind: 'import', format: artifact.intent.format,
                    intent: artifact.intent,
                    stage: 'Restoring previous body…',
                  },
                });
                latestFileOperationState = {
                  phase: 'running', requestId: message.actionRequestId,
                  kind: 'import', format: artifact.intent.format,
                  intent: artifact.intent,
                  stage: 'Restoring previous body…',
                };
                const applied = waitForImportApplied(message.actionRequestId);
                invalidatePersistenceCaches();
                const delivered = await webviewPanel.webview.postMessage({
                  type: 'importContent', requestId: message.actionRequestId, sessionId, documentId,
                  confirmation: 'preflight-confirmed', content: artifact.mutation.content,
                });
                if (!delivered) settleImportApplied(message.actionRequestId, false);
                if (!await applied) {
                  throw new Error('The import checkpoint was not restored.');
                }
                lease.commit();
                if (latestImportCheckpointArtifactId === message.artifactId) {
                  latestImportCheckpointArtifactId = undefined;
                }
                latestFileOperationState = {
                  phase: 'succeeded', requestId: message.actionRequestId, result: 'completed',
                  intent: artifact.intent,
                  details: { outcome: 'completed', warnings: [], availableActions: [] },
                };
                await webviewPanel.webview.postMessage({
                  type: 'fileOperationStatus', sessionId, documentId,
                  state: {
                    phase: 'succeeded', requestId: message.actionRequestId, result: 'completed',
                    intent: artifact.intent,
                    details: { outcome: 'completed', warnings: [], availableActions: [] },
                  },
                });
              } catch (error) {
                lease.release();
                throw error;
              }
            } finally {
              releaseFileOperation(message.actionRequestId);
            }
            return;
          }
          const artifact = this.fileOperations.getArtifact(sessionId, message.artifactId);
          if (artifact.kind !== 'export') return;
          if (message.action === 'reveal') {
            await vscode.commands.executeCommand('revealFileInOS', artifact.uri);
          } else if (message.action === 'copy') {
            await vscode.env.clipboard.writeText(artifact.uri.fsPath);
          } else if (message.action === 'open') {
            if (artifact.openKind === 'external') await vscode.env.openExternal(artifact.uri);
            else if (artifact.openKind === 'html') {
              await vscode.commands.executeCommand('vscode.open', artifact.uri);
            } else {
              const opened = await vscode.workspace.openTextDocument(artifact.uri);
              await vscode.window.showTextDocument(opened, { preview: false });
            }
          }
          await postResultActionStatus(
            message.requestId,
            message.actionRequestId,
            message.action,
            'completed',
          );
        })().catch((error: unknown) => {
          console.error('Structured Doc result action failed', error);
          void postResultActionStatus(
            message.requestId,
            message.actionRequestId,
            message.action,
            'failed',
            createFileOperationError(
              error instanceof FileOperationPlanError ? error.code : 'RESULT_ACTION_FAILED',
              'The result action could not be completed.',
              true,
            ),
          );
        });
        return;
      }
      if (message.type === 'renderDiagram') {
        const controller = new AbortController();
        diagramRequests.get(message.requestId)?.abort();
        diagramRequests.set(message.requestId, controller);
        void diagramService.render(message.language, message.source, {
          signal: controller.signal,
        }).then((result) => {
          webviewPanel.webview.postMessage({
            type: 'diagramRenderResult',
            requestId: message.requestId,
            result: {
              status: 'ready',
              dataUrl: result.dataUrl,
              width: result.width,
              height: result.height,
            },
          });
        }).catch((error: unknown) => {
          const renderError = error instanceof KrokiRenderError
            ? error
            : new KrokiRenderError(
              'offline',
              'The diagram renderer could not be reached.',
              true,
            );
          webviewPanel.webview.postMessage({
            type: 'diagramRenderResult',
            requestId: message.requestId,
            result: {
              status: 'error',
              code: renderError.code,
              message: renderError.message,
              retryable: renderError.retryable,
            },
          });
        }).finally(() => {
          if (diagramRequests.get(message.requestId) === controller) {
            diagramRequests.delete(message.requestId);
          }
        });
        return;
      }
      if (message.type === 'cancelDiagramRender') {
        diagramRequests.get(message.requestId)?.abort();
        diagramRequests.delete(message.requestId);
        return;
      }
      if (message.type === 'updateDiagramRendererSettings') {
        const config = vscode.workspace.getConfiguration('structuredDocEditor.diagramRenderer');
        // Consent is host-owned globalState and is changed only through the
        // request-correlated resolveDiagramRendererConsent path below.
        void Promise.all([
          config.update('endpoint', message.settings.endpoint, vscode.ConfigurationTarget.Global),
          config.update(
            'allowPrivateNetwork',
            message.settings.allowPrivateNetwork,
            vscode.ConfigurationTarget.Global,
          ),
        ]).then(() => {
          const settings = this.readDiagramRendererSettings();
          diagramService.updateSettings(settings);
          webviewPanel.webview.postMessage({
            type: 'diagramRendererSettings',
            settings,
          });
        });
        return;
      }
      if (message.type === 'testDiagramRendererConnection') {
        const controller = new AbortController();
        diagramRequests.get(message.requestId)?.abort();
        diagramRequests.set(message.requestId, controller);
        const testService = new KrokiDiagramService({
          ...message.settings,
          consent: this.readDiagramRendererConsent(),
        });
        void testService.render('graphviz', 'digraph { ready }', {
          signal: controller.signal,
          timeoutMs: 3_000,
        })
          .then((result) => webviewPanel.webview.postMessage({
            type: 'diagramRenderResult',
            requestId: message.requestId,
            result: {
              status: 'ready',
              dataUrl: result.dataUrl,
              width: result.width,
              height: result.height,
            },
          }))
          .catch((error: unknown) => {
            const renderError = error instanceof KrokiRenderError
              ? error
              : new KrokiRenderError('offline', 'The endpoint could not be reached.', true);
            webviewPanel.webview.postMessage({
              type: 'diagramRenderResult',
              requestId: message.requestId,
              result: {
                status: 'error',
                code: renderError.code,
                message: renderError.message,
                retryable: renderError.retryable,
              },
            });
          })
          .finally(() => {
            if (diagramRequests.get(message.requestId) === controller) {
              diagramRequests.delete(message.requestId);
            }
          });
        return;
      }
      if (message.type === 'flushComplete') {
        if (message.sessionId === sessionId && message.documentId === documentId && message.requestId) {
          this.resolveFlush(message.requestId, message.sessionId);
        }
        return;
      }
      if (message.type === 'flushFailed') {
        if (message.sessionId === sessionId && message.documentId === documentId) {
          this.rejectFlush(message.requestId, new Error(message.message), message.sessionId);
        }
        return;
      }
      if (message.type === 'fileOperationApplied') {
        if (message.sessionId === sessionId && message.documentId === documentId) {
          settleImportApplied(message.requestId, message.applied);
        }
        return;
      }
      if (message.type === 'savePersonalTemplate'
        || message.type === 'updatePersonalTemplate'
        || message.type === 'duplicatePersonalTemplate'
        || message.type === 'deletePersonalTemplate'
        || message.type === 'openPersonalTemplateFolder') {
        if (templateManagementPending) {
          webviewPanel.webview.postMessage({
            type: 'templateOperationFinished',
            requestId: message.requestId,
            operation: message.type === 'savePersonalTemplate' ? 'save'
              : message.type === 'updatePersonalTemplate' ? 'update'
                : message.type === 'duplicatePersonalTemplate' ? 'duplicate'
                  : message.type === 'deletePersonalTemplate' ? 'delete'
                    : 'open-folder',
            result: 'failed',
            error: {
              code: 'operation-failed',
              message: 'Another template operation is already running.',
            },
          });
          return;
        }
        templateManagementPending = true;
        void handlePersonalTemplateRequest(message);
        return;
      }
      if (message.type === 'applyTemplate') {
        if (templateApplicationPending) {
          webviewPanel.webview.postMessage({
            type: 'templateApplicationFinished',
            requestId: message.requestId,
            result: 'failed',
            error: {
              code: 'operation-failed',
              message: 'Another template operation is already running.',
            },
          });
          return;
        }
        templateApplicationPending = true;
      }
      messageQueue.enqueue(async () => {
        switch (message.type) {
          case 'ready':
            if (hasLoadedValidDocument && writeBlockedReason) postExternalChange();
            else sendUpdate();
            webviewPanel.webview.postMessage({
              type: 'diagramRendererSettings',
              settings: this.readDiagramRendererSettings(),
            });
            break;
          case 'externalChangeAdopted': {
            if (message.sessionId !== sessionId || message.documentId !== documentId
              || message.revision !== document.version) break;
            invalidatePersistenceCaches();
            const snapshot = tryReadCurrentMutation();
            if (snapshot) lastLocalMutation = snapshot;
            break;
          }
          case 'uiReady': {
            const currentSession = this.editorSessions.get(documentId);
            if (message.sessionId === sessionId
              && message.documentId === documentId
              && currentSession?.panel === webviewPanel
              && currentSession.sessionId === sessionId) {
              this.uiReadySessionIds.add(sessionId);
            }
            break;
          }
          case 'webviewPerformanceMeasurement': {
            if (message.sessionId === sessionId && message.documentId === documentId) {
              this.performanceProbe.record(
                message.name,
                message.durationMs,
                message.operationCount,
              );
            }
            break;
          }
          case 'recoverInvalidDocument': {
            const rejectRecovery = async (detail: string): Promise<void> => {
              await webviewPanel.webview.postMessage({
                type: 'invalidDocumentRecoveryResult',
                requestId: message.requestId,
                sessionId,
                documentId,
                result: 'rejected',
                revision: document.version,
                message: detail,
              });
            };
            if (!canRecoverInvalidDocument({
              writeBlocked: Boolean(writeBlockedReason),
              hasLoadedValidDocument,
              sessionId,
              documentId,
              revision: document.version,
            }, message)) {
              await rejectRecovery('The invalid source changed or is not eligible for local recovery.');
              break;
            }
            try {
              invalidatePersistenceCaches();
              const update = await this.updateDocument(
                document,
                message.mutation,
                modifiedTokenCache,
                modifiedTokenAuthority,
                canonicalPersistenceCache,
              );
              lastLocalMutation = mutationFromEnvelope(update.envelope);
              writeBlockedReason = undefined;
              readOnlyWarningShown = false;
              hasLoadedValidDocument = true;
              await webviewPanel.webview.postMessage({
                type: 'invalidDocumentRecoveryResult',
                requestId: message.requestId,
                sessionId,
                documentId,
                result: 'recovered',
                revision: document.version,
                modified: update.modified,
              });
            } catch (error) {
              await rejectRecovery(error instanceof Error ? error.message : String(error));
            }
            break;
          }
          case 'resolveDiagramRendererConsent': {
            try {
              await this.context.globalState.update(
                DIAGRAM_RENDERER_CONSENT_STATE_KEY,
                message.consent,
              );
              if (this.readDiagramRendererConsent() !== message.consent) {
                throw new Error('The consent choice could not be verified after saving.');
              }
              const settings = this.readDiagramRendererSettings();
              this.synchronizeDiagramRendererRuntimes(
                settings,
                message.consent !== 'granted',
              );
              await webviewPanel.webview.postMessage({
                type: 'diagramRendererConsentResult',
                requestId: message.requestId,
                result: { status: 'resolved', settings },
              });
            } catch (error: unknown) {
              await webviewPanel.webview.postMessage({
                type: 'diagramRendererConsentResult',
                requestId: message.requestId,
                result: {
                  status: 'error',
                  message: error instanceof Error ? error.message : String(error),
                },
              });
            }
            break;
          }
          case 'updateUiLanguage': {
            const config = vscode.workspace.getConfiguration('structuredDocEditor.ui');
            await updateUiLanguagePreference(message.preference, {
              write: async (preference) => {
                await config.update(
                  'language',
                  preference,
                  vscode.ConfigurationTarget.Global,
                );
              },
              publishCurrent: sendUiLanguage,
              recoverFromWriteFailure: (error) => recoverFromUiLanguageWriteFailure(error, {
                report: (writeError) => {
                  console.error('Structured Doc UI language update failed', writeError);
                },
                showError: async (messageText, action) =>
                  vscode.window.showErrorMessage(messageText, action),
                openUserSettings: async () => {
                  await vscode.commands.executeCommand('workbench.action.openSettingsJson');
                },
              }),
            });
            break;
          }
          case 'requestTemplateCatalog':
            await sendTemplateCatalog(message.requestId);
            break;
          case 'createDocumentFromTemplate': {
            let creationResult: 'created' | 'cancelled' | 'failed' = 'failed';
            let creationError: TemplateOperationError | undefined;
            try {
              const template = availableTemplates.get(message.templateId);
              if (!template) {
                creationError = {
                  code: 'template-unavailable',
                  message: 'The selected template is no longer available.',
                };
              } else {
                const title = await vscode.window.showInputBox({
                  title: 'Create Structured Doc',
                  prompt: 'Enter the document title',
                  placeHolder: 'Document title',
                  value: template.descriptor.name,
                  validateInput: validateDocumentTitle,
                });
                if (title === undefined) {
                  creationResult = 'cancelled';
                } else {
                  const defaultWorkspace = vscode.workspace.workspaceFolders
                    ?.find((folder) => isFilesystemBackedScheme(folder.uri.scheme));
                  const defaultUri = defaultWorkspace
                    ? vscode.Uri.joinPath(defaultWorkspace.uri, suggestSdocFileName(title))
                    : vscode.Uri.file(path.resolve(suggestSdocFileName(title)));
                  const targetUri = await vscode.window.showSaveDialog({
                    defaultUri,
                    filters: { 'Structured Doc': ['sdoc'] },
                    saveLabel: 'Create .sdoc Document',
                    title: 'Create .sdoc Document',
                  });
                  if (!targetUri) {
                    creationResult = 'cancelled';
                  } else if (!isFilesystemBackedScheme(targetUri.scheme)) {
                    throw new Error('New documents require a filesystem-backed destination.');
                  } else {
                    await templateService.createExclusive(
                      template,
                      title,
                      targetUri.fsPath,
                      workspaceTemplateRoots(),
                    );
                    await vscode.commands.executeCommand(
                      'vscode.openWith',
                      targetUri,
                      'structuredDocEditor.sdoc',
                      { preview: false },
                    );
                    creationResult = 'created';
                  }
                }
              }
            } catch (error) {
              console.error('Structured Doc template document creation failed', error);
              creationError = {
                code: 'operation-failed',
                message: 'The template could not be used to create a document.',
              };
            }
            webviewPanel.webview.postMessage({
              type: 'templateCreationFinished',
              requestId: message.requestId,
              result: creationResult,
              ...(creationError ? { error: creationError } : {}),
            });
            break;
          }
          case 'openExistingDocument': {
            const uris = await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: { 'Structured Doc': ['sdoc', 'tiptap.json'] },
              title: 'Open existing document',
            });
            const target = uris?.[0];
            if (target) {
              await vscode.commands.executeCommand(
                'vscode.openWith',
                target,
                'structuredDocEditor.sdoc',
                { preview: false },
              );
            }
            break;
          }
          case 'applyTemplate': {
            let applied = false;
            let applicationError: TemplateOperationError | undefined;
            try {
              applied = await applyTemplateToCurrentDocument(message.templateId, {
                sessionId: message.sessionId,
                documentId: message.documentId,
                revision: message.baseRevision,
              });
              if (!applied) {
                applicationError = {
                  code: availableTemplates.has(message.templateId)
                    ? 'document-changed'
                    : 'template-unavailable',
                  message: 'The template could not be applied.',
                };
              }
            } catch (error) {
              console.error('Structured Doc template application failed', error);
              applicationError = {
                code: 'operation-failed',
                message: 'The template could not be applied.',
              };
            } finally {
              templateApplicationPending = false;
              webviewPanel.webview.postMessage({
                type: 'templateApplicationFinished',
                requestId: message.requestId,
                result: applied ? 'applied' : 'failed',
                ...(applicationError ? { error: applicationError } : {}),
              });
            }
            break;
          }
          case 'edit':
            if (message.sessionId !== sessionId || message.documentId !== documentId
              || message.baseRevision !== document.version) {
              invalidatePersistenceCaches();
              const hostSnapshot = tryReadCurrentMutation();
              webviewPanel.webview.postMessage({
                type: 'editRejected',
                sessionId,
                documentId,
                editId: message.editId,
                revision: document.version,
                code: 'STALE_REVISION',
                message: 'stale revision or document identity',
                ...(hostSnapshot ? { hostSnapshot } : {}),
              });
              if (message.flushRequestId) {
                this.rejectFlush(message.flushRequestId, new Error('Editor flush was rejected as stale.'));
              }
              break;
            }
            const checkpointToAckSpan = this.performanceProbe.start(
              'host-edit-received-to-ack-post',
            );
            try {
              const update = await this.updateDocument(
                document,
                message.mutation,
                modifiedTokenCache,
                modifiedTokenAuthority,
                canonicalPersistenceCache,
                message.componentRevisions,
              );
              lastLocalMutation = mutationFromEnvelope(update.envelope);
              latestSavePhase = 'dirty';
              latestSaveRevision = document.version;
              webviewPanel.webview.postMessage({
                type: 'editAcknowledged',
                sessionId,
                documentId,
                editId: message.editId,
                revision: document.version,
                modified: update.modified,
              });
              this.performanceProbe.finish(checkpointToAckSpan);
              if (message.flushRequestId) this.resolveFlush(message.flushRequestId, sessionId);
            } catch (error) {
              this.performanceProbe.finish(checkpointToAckSpan, 'error');
              const hostSnapshot = tryReadCurrentMutation();
              webviewPanel.webview.postMessage({
                type: 'editRejected',
                sessionId,
                documentId,
                editId: message.editId,
                revision: document.version,
                code: error instanceof DocumentEditConflictError
                  ? 'STALE_REVISION'
                  : 'WRITE_FAILED',
                message: error instanceof Error ? error.message : String(error),
                ...(hostSnapshot ? { hostSnapshot } : {}),
              });
              if (message.flushRequestId) {
                this.rejectFlush(message.flushRequestId, new Error('Editor flush failed to apply.'));
              }
              throw error;
            }
            break;
          case 'viewJson':
            await this.openJsonView(document);
            break;
          case 'saveImage':
            await this.assetService.saveImage(document, webviewPanel.webview, message);
            break;
          case 'createDrawio':
            await this.assetService.createDrawioFile(document, webviewPanel.webview, message);
            break;
          case 'importDrawio':
            await this.assetService.importDrawioFile(document, webviewPanel.webview);
            break;
          case 'openDrawio':
            await this.assetService.openDrawioFile(document, message);
            break;
          case 'insertExistingImage':
            await this.assetService.insertExistingImage(document, webviewPanel.webview);
            break;
          case 'replaceImage':
            await this.assetService.replaceImage(document, webviewPanel.webview, message.pos);
            break;
          case 'openDocument':
            await this.openLinkedDocument(document, message.path, message.anchor);
            break;
          case 'browseSdocFiles':
            await this.browseSdocFiles(document, webviewPanel.webview);
            break;
          case 'selectCssFile': {
            const selectedPath = await this.selectCssFile(document);
            if (selectedPath !== undefined) {
              webviewPanel.webview.postMessage({
                type: 'documentSettingSelected',
                key: message.target === 'slide' ? 'slideCssPath' : 'htmlCssPath',
                value: selectedPath,
              });
            }
            break;
          }
          case 'clearCssFile': {
            webviewPanel.webview.postMessage({
              type: 'documentSettingSelected',
              key: message.target === 'slide' ? 'slideCssPath' : 'htmlCssPath',
              value: null,
            });
            break;
          }
        }
      }, (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('Structured Doc message failed', error);
        vscode.window.showErrorMessage(`Structured Doc operation failed: ${detail}`);
      });
    };
    const editorMessageSubscription = webviewPanel.webview.onDidReceiveMessage(handleEditorMessage);

    const registeredSession = this.editorSessions.get(documentId);
    if (registeredSession?.panel === webviewPanel && registeredSession.sessionId === sessionId) {
      registeredSession.prepareFileOperation = beginFileOperationPreflight;
      registeredSession.confirmFileOperation = () => {
        const current = latestFileOperationState;
        if (current.phase !== 'awaiting-confirmation') {
          throw new Error('There is no file operation awaiting confirmation.');
        }
        handleEditorMessage({
          type: 'fileOperationExecute',
          requestId: current.requestId,
          sessionId,
          documentId,
          planId: current.plan.planId,
        });
      };
      registeredSession.runResultAction = async (action, artifactId) => {
        const deadline = Date.now() + 5_000;
        while (activeFileOperationRequestId !== undefined && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (activeFileOperationRequestId !== undefined) {
          throw new Error('The previous file operation has not released its execution lease.');
        }
        const current = latestFileOperationState;
        if (current.phase !== 'succeeded') {
          throw new Error('There is no completed file operation result.');
        }
        const matchingAction = current.details?.availableActions
          .find((candidate) => candidate.action === action);
        const resolvedArtifactId = artifactId ?? (matchingAction && 'artifactId' in matchingAction
          ? matchingAction.artifactId
          : undefined);
        if (action !== 'repeat' && !resolvedArtifactId) {
          throw new Error(`The completed result has no ${action} artifact.`);
        }
        handleEditorMessage({
          type: 'fileOperationResultAction',
          requestId: current.requestId,
          actionRequestId: randomUUID(),
          sessionId,
          documentId,
          action,
          ...(resolvedArtifactId ? { artifactId: resolvedArtifactId } : {}),
        });
      };
    }

    // Flush webview state before save to prevent data loss
    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      const generation = ++saveGeneration;
      this.performanceProbe.beginSave(generation);
      latestSavePhase = 'saving';
      latestSaveRevision = document.version;
      void webviewPanel.webview.postMessage({
        type: 'documentSaveState',
        sessionId,
        documentId,
        saveGeneration: generation,
        revision: document.version,
        phase: 'saving',
      });
      e.waitUntil(this.performanceProbe.measureAsync(
        'save-flush-barrier',
        () => this.flushEditor(webviewPanel.webview, sessionId, documentId, 1000),
      )
        .catch(async (error: unknown) => {
          this.performanceProbe.finishSave(generation, 'error');
          const message = error instanceof Error ? error.message : String(error);
          latestSavePhase = 'failed';
          latestSaveRevision = document.version;
          await webviewPanel.webview.postMessage({
            type: 'documentSaveState',
            sessionId,
            documentId,
            saveGeneration: generation,
            revision: document.version,
            phase: 'failed',
            message,
          });
          throw error;
        }));
    });
    const didSaveSubscription = vscode.workspace.onDidSaveTextDocument((savedDocument) => {
      if (savedDocument.uri.toString() !== document.uri.toString()) return;
      const generation = saveGeneration === 0 ? ++saveGeneration : saveGeneration;
      this.performanceProbe.finishSave(generation);
      const snapshot = tryReadCurrentMutation();
      latestSavePhase = 'saved';
      latestSaveRevision = savedDocument.version;
      void webviewPanel.webview.postMessage({
        type: 'documentSaveState',
        sessionId,
        documentId,
        saveGeneration: generation,
        revision: savedDocument.version,
        phase: 'saved',
        ...(typeof snapshot?.meta.modified === 'string'
          ? { modified: snapshot.meta.modified }
          : {}),
      });
    });

    // Handle external document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        if (hasTextDocumentContentChanges(e.contentChanges)) {
          invalidatePersistenceCaches();
        }
        // VS Code emits this event for dirty-state transitions during save too.
        // Only content changes can represent an editor or external mutation.
        if (!shouldReportExternalDocumentChange(
          e.contentChanges,
          this.expectedDocumentChanges,
          document.uri.toString(),
          document.getText(),
          document.version,
        )) {
          if (hasTextDocumentContentChanges(e.contentChanges)) {
            this.performanceProbe.record(
              'workspace-edit-content-change-count',
              0,
              e.contentChanges.length,
            );
          }
          return;
        }

        if (isUninitializedSdocText(document.getText())) {
          postExternalChange();
          return;
        }

        // Send updated content to webview
        try {
          postExternalChange();
        } catch {
          // Ignore parse errors during typing
        }
      }
    });

    // drawio.svg 파일 변경 감시 — draw.io 확장이 저장하면 웹뷰 이미지를 갱신
    const drawioWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(documentDir, 'drawio/**/*.drawio.svg')
    );

    const drawioGeneration = ++SdocEditorProvider.watcherGeneration;
    const pendingDrawioEvents = new Map<string, NodeJS.Timeout>();
    const notifyDrawioUpdated = (uri: vscode.Uri) => {
      const relativePath = `./${path.relative(documentDir.fsPath, uri.fsPath).replace(/\\/g, '/')}`;
      const previous = pendingDrawioEvents.get(relativePath);
      if (previous) clearTimeout(previous);
      // 캐시 버스팅: 타임스탬프를 쿼리 파라미터로 추가
      pendingDrawioEvents.set(relativePath, setTimeout(() => {
        pendingDrawioEvents.delete(relativePath);
        const webviewUri = webviewPanel.webview.asWebviewUri(uri);
        void webviewPanel.webview.postMessage({
          type: 'drawioFileUpdated', documentId, generation: drawioGeneration, relativePath,
          newWebviewUri: `${webviewUri.toString()}?t=${Date.now()}`,
        });
      }, 150));
    };

    drawioWatcher.onDidChange(notifyDrawioUpdated);
    drawioWatcher.onDidCreate(notifyDrawioUpdated);

    // Watch for settings changes
    const settingsSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('structuredDocEditor')) {
        sendSettings();
      }
      if (e.affectsConfiguration('structuredDocEditor.ui.language')) {
        sendUiLanguage();
      }
      if (e.affectsConfiguration('structuredDocEditor.diagramRenderer')) {
        const settings = this.readDiagramRendererSettings();
        diagramService.updateSettings(settings);
        webviewPanel.webview.postMessage({ type: 'diagramRendererSettings', settings });
      }
    });
    const viewStateSubscription = webviewPanel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active) {
        this.releaseEditorTextFocus(webviewPanel, editorIdentity);
      }
    });

    // Cleanup
    webviewPanel.onDidDispose(() => {
      sessionDisposed = true;
      this.releaseEditorTextFocus(webviewPanel, editorIdentity);
      if (this.editorSessions.get(documentId)?.panel === webviewPanel) {
        this.editorSessions.delete(documentId);
      }
      this.uiReadySessionIds.delete(sessionId);
      changeDocumentSubscription.dispose();
      willSaveSubscription.dispose();
      didSaveSubscription.dispose();
      drawioWatcher.dispose();
      pendingDrawioEvents.forEach((timer) => clearTimeout(timer));
      diagramRequests.forEach((controller) => controller.abort());
      diagramRequests.clear();
      filePreflightRequests.forEach((controller) => controller.abort());
      filePreflightRequests.clear();
      for (const requestId of pendingImportAcks.keys()) settleImportApplied(requestId, false);
      this.fileOperations.clearSession(sessionId);
      this.diagramRendererRuntimes.delete(webviewPanel);
      settingsSubscription.dispose();
      editorMessageSubscription.dispose();
      viewStateSubscription.dispose();
      this.expectedDocumentChanges.clear(document.uri.toString());
      invalidatePersistenceCaches();
      for (const [requestId, pending] of this.pendingFlushResolvers) {
        if (pending.sessionId !== sessionId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error('Editor was closed before its content could be flushed.'));
        this.pendingFlushResolvers.delete(requestId);
      }
    });
  }

  private async updateDocument(
    document: vscode.TextDocument,
    mutation: DocumentMutation,
    modifiedTokenCache: RevisionBoundSdocModifiedTokenCache,
    modifiedTokenAuthority: SdocModifiedTokenCacheAuthority,
    canonicalPersistenceCache: RevisionBoundCanonicalPersistenceCache,
    componentRevisions?: DocumentComponentRevisions,
  ): Promise<PersistedDocumentUpdateResult> {
    try {
      return await this.performanceProbe.measureAsync(
        'update-document-total',
        () => this.updateDocumentCore(
          document,
          mutation,
          modifiedTokenCache,
          modifiedTokenAuthority,
          canonicalPersistenceCache,
          componentRevisions,
        ),
        mutation.content.content?.length ?? 0,
      );
    } catch (error) {
      modifiedTokenCache.invalidate();
      canonicalPersistenceCache.invalidate();
      throw error;
    }
  }

  private async updateDocumentCore(
    document: vscode.TextDocument,
    mutation: DocumentMutation,
    modifiedTokenCache: RevisionBoundSdocModifiedTokenCache,
    modifiedTokenAuthority: SdocModifiedTokenCacheAuthority,
    canonicalPersistenceCache: RevisionBoundCanonicalPersistenceCache,
    componentRevisions?: DocumentComponentRevisions,
  ): Promise<PersistedDocumentUpdateResult> {
    const source: DocumentTextEditSource = {
      version: document.version,
      text: document.getText(),
    };
    const existingText = source.text;
    const canonicalReuse = componentRevisions
      ? canonicalPersistenceCache.resolve(
        modifiedTokenAuthority,
        source.version,
        componentRevisions,
      )
      : undefined;
    this.performanceProbe.record(
      'canonical-persistence-cache-hit',
      0,
      canonicalReuse ? 1 : 0,
    );
    this.performanceProbe.record(
      'canonical-metadata-reused',
      0,
      canonicalReuse?.reuse.metadata ? 1 : 0,
    );
    this.performanceProbe.record(
      'canonical-settings-reused',
      0,
      canonicalReuse?.reuse.settings ? 1 : 0,
    );
    this.performanceProbe.record(
      'canonical-content-reused',
      0,
      canonicalReuse?.reuse.normalizedContent ? 1 : 0,
    );

    let existingMetadata: Partial<SdocMeta>;
    if (canonicalReuse) {
      this.performanceProbe.record('parse-existing-envelope', 0, 0);
      existingMetadata = canonicalReuse.snapshot.metadata;
    } else {
      existingMetadata = this.performanceProbe.measure('parse-existing-envelope', () => {
        try {
          const { settings: _settings, ...metadata } = sharedUnwrapSdoc(
            existingText.trim() ? JSON.parse(existingText) : {},
          ).meta;
          return metadata;
        } catch {
          // intentionally ignored: parse errors during editing
          return {} satisfies SdocMeta;
        }
      }, existingText.length);
    }

    const { settings: _incomingSettings, ...incomingMetadata } = mutation.meta;
    const nextMetadata: Partial<SdocMeta> = canonicalReuse?.reuse.metadata
      ? canonicalReuse.snapshot.metadata
      : { ...existingMetadata, ...incomingMetadata };
    const documentSettings = canonicalReuse?.reuse.settings
      ? canonicalReuse.snapshot.documentSettings
      : mutation.documentSettings;
    const nextMeta: SdocMeta = { ...nextMetadata };
    if (documentSettings && Object.keys(documentSettings).length > 0) {
      nextMeta.settings = documentSettings;
    }

    // Persisted normalization is portable: document settings over versioned built-ins.
    const resolvedSnapshot = canonicalReuse?.reuse.resolvedSettings
      ? (this.performanceProbe.record('resolve-document-settings', 0, 0),
        canonicalReuse.snapshot.resolvedSettings!)
      : this.performanceProbe.measure(
        'resolve-document-settings',
        () => resolveDocumentSettingsSnapshot({
        context: 'standalone',
        documentSettings: nextMeta.settings,
        }),
      );
    const resolved = resolvedSnapshot.values;

    let synced: TiptapNode;
    if (canonicalReuse?.reuse.normalizedContent) {
      this.performanceProbe.record('dehydrate-document-assets', 0, 0);
      this.performanceProbe.record('normalize-document', 0, 0);
      synced = canonicalReuse.snapshot.normalizedContent!;
    } else {
      const convertedContent = this.performanceProbe.measure(
        'dehydrate-document-assets',
        () => dehydrateDocumentAssets(
          convertWebviewUrisToRelativePaths(mutation.content),
        ),
        mutation.content.content?.length ?? 0,
      );
      synced = this.performanceProbe.measure('normalize-document', () =>
        normalizeDocument(convertedContent, {
          equationNumbering: resolved.equationNumbering,
          captionStyle: resolved.captionStyle,
          crossRefIncludeCaption: resolved.crossRefIncludeCaption,
          captionNumbering: resolved.captionNumbering,
          headingNumbering: resolved.headingNumbering,
          headingStartNumber: resolved.headingStartNumber,
        }), mutation.content.content?.length ?? 0);
    }

    // Wrap in sdoc envelope, preserving settings
    const modified = new Date().toISOString();
    const sdocFile: SdocEnvelope = {
      sdoc: SdocEditorProvider.SDOC_VERSION,
      meta: {
        ...nextMeta,
        title: nextMeta.title || '',
        author: nextMeta.author || '',
        version: nextMeta.version || '0.1',
        created: nextMeta.created || new Date().toISOString(),
        modified,
        ...(nextMeta.settings && Object.keys(nextMeta.settings).length > 0
          ? { settings: nextMeta.settings }
          : {}),
      },
      doc: synced,
    };
    const metadataOnlyReuse = Boolean(
      canonicalReuse?.reuse.normalizedContent
      && canonicalReuse.changed.metadata
      && !canonicalReuse.changed.content
      && !canonicalReuse.changed.settings,
    );
    if (metadataOnlyReuse) {
      this.performanceProbe.record('validate-persisted-document', 0, 0);
      this.performanceProbe.measure(
        'validate-persisted-metadata',
        () => assertPersistedDocumentMetadata(sdocFile.meta),
      );
    } else {
      this.performanceProbe.measure(
        'validate-persisted-document',
        () => assertPersistedDocument(sdocFile),
        synced.content?.length ?? 0,
      );
      this.performanceProbe.record('validate-persisted-metadata', 0, 0);
    }

    // Pretty-print JSON for better git diffs
    const endOfLine = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const serialized = this.performanceProbe.measure(
      'serialize-pretty-document',
      () => serializePrettySdocWithModifiedToken(
        sdocFile as {
          sdoc: unknown;
          meta: { modified?: unknown };
          doc: unknown;
        },
        endOfLine,
      ),
      synced.content?.length ?? 0,
    );
    const json = serialized.text;
    let documentTextEditPlan = this.performanceProbe.measure(
      'plan-minimal-document-edit',
      () => {
        const currentModifiedToken = modifiedTokenCache.resolve(
          modifiedTokenAuthority,
          {
            revision: source.version,
            endOfLine,
            sourceLength: source.text.length,
          },
          source.text,
        );
        return planSdocDocumentTextEdits(
          source.text,
          json,
          currentModifiedToken && serialized.modifiedToken
            ? {
              currentModifiedToken,
              nextModifiedToken: serialized.modifiedToken,
            }
            : undefined,
        );
      },
      source.text.length + json.length,
    );
    this.performanceProbe.record(
      'workspace-edit-modified-token-cache-hit',
      0,
      documentTextEditPlan.tokenOffsetSource === 'trusted' ? 1 : 0,
    );
    this.performanceProbe.record(
      'workspace-edit-modified-token-fallback',
      0,
      documentTextEditPlan.tokenOffsetSource === 'lexical' ? 1 : 0,
    );
    if (!isDocumentTextEditSourceCurrent(source, document.version, document.getText())) {
      throw new DocumentEditConflictError(
        'The document changed before the editor mutation could be applied.',
      );
    }
    let ranges = documentTextEditPlan.edits.map((documentTextEdit) => {
      const start = document.positionAt(documentTextEdit.startOffset);
      const end = document.positionAt(documentTextEdit.endOffset);
      return { documentTextEdit, start, end };
    });
    if (ranges.some(({ documentTextEdit, start, end }) =>
      document.offsetAt(start) !== documentTextEdit.startOffset
      || document.offsetAt(end) !== documentTextEdit.endOffset)) {
      const documentTextEdit = createFullDocumentTextEdit(source.text, json);
      documentTextEditPlan = {
        kind: 'single-span',
        edits: [documentTextEdit],
        tokenOffsetSource: 'lexical',
      };
      ranges = [{
        documentTextEdit,
        start: document.positionAt(0),
        end: document.positionAt(source.text.length),
      }];
    }
    const editMetrics = measureDocumentTextEdits(
      source.text,
      json,
      documentTextEditPlan.edits,
    );
    this.performanceProbe.record(
      'workspace-edit-source-range-code-units',
      0,
      editMetrics.sourceRangeCodeUnits,
    );
    this.performanceProbe.record(
      'workspace-edit-inserted-code-units',
      0,
      editMetrics.insertedCodeUnits,
    );
    this.performanceProbe.record(
      'workspace-edit-source-code-units',
      0,
      editMetrics.sourceCodeUnits,
    );
    this.performanceProbe.record(
      'workspace-edit-target-code-units',
      0,
      editMetrics.targetCodeUnits,
    );
    this.performanceProbe.record(
      'workspace-edit-replacement-ratio-ppm',
      0,
      editMetrics.replacementRatioPpm,
    );
    this.performanceProbe.record(
      'workspace-edit-range-count',
      0,
      documentTextEditPlan.edits.length,
    );
    const edit = new vscode.WorkspaceEdit();
    for (const { documentTextEdit, start, end } of ranges) {
      edit.replace(document.uri, new vscode.Range(start, end), documentTextEdit.text);
    }

    await this.performanceProbe.measureAsync(
      'workspace-apply-edit',
      () => this.applyExpectedEdit(document, edit, json, source),
      json.length,
    );
    const appliedText = document.getText();
    if (!serialized.modifiedToken || !modifiedTokenCache.adopt(
      modifiedTokenAuthority,
      {
        revision: document.version,
        endOfLine,
        sourceLength: appliedText.length,
      },
      appliedText,
      serialized.modifiedToken,
    )) {
      modifiedTokenCache.invalidate();
    }
    if (componentRevisions) {
      const { settings: _persistedSettings, ...persistedMetadata } = sdocFile.meta;
      canonicalPersistenceCache.adopt(modifiedTokenAuthority, {
        revision: document.version,
        componentRevisions,
        metadata: persistedMetadata,
        documentSettings,
        resolvedSettings: resolvedSnapshot,
        normalizedContent: synced,
      });
    } else {
      canonicalPersistenceCache.invalidate();
    }
    return { modified, envelope: sdocFile };
  }

  private async applyExpectedEdit(
    document: vscode.TextDocument,
    edit: vscode.WorkspaceEdit,
    expectedText: string,
    source: DocumentTextEditSource,
  ): Promise<void> {
    if (!isDocumentTextEditSourceCurrent(source, document.version, document.getText())) {
      throw new DocumentEditConflictError(
        'The document changed before the WorkspaceEdit could be applied.',
      );
    }
    const uri = document.uri.toString();
    const expectedChange = this.expectedDocumentChanges.expect(
      uri,
      expectedText,
      document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    );
    let applied: boolean;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch (error) {
      this.expectedDocumentChanges.remove(uri, expectedChange);
      if (!isDocumentTextEditSourceCurrent(source, document.version, document.getText())) {
        throw new DocumentEditConflictError(
          'The document changed while VS Code was applying the WorkspaceEdit.',
        );
      }
      throw error;
    }
    if (!applied) {
      this.expectedDocumentChanges.remove(uri, expectedChange);
      if (!isDocumentTextEditSourceCurrent(source, document.version, document.getText())) {
        throw new DocumentEditConflictError(
          'The document changed while VS Code rejected the WorkspaceEdit.',
        );
      }
      throw new Error('VS Code rejected the document edit.');
    }
    if (!isDocumentTextEditApplicationConfirmed(
      source,
      document.version,
      expectedChange.text,
      document.getText(),
      expectedChange.consumedRevision,
    )) {
      this.expectedDocumentChanges.remove(uri, expectedChange);
      throw new DocumentEditConflictError(
        'The document changed while the WorkspaceEdit was being applied.',
      );
    }
  }

  private async exportActive(format: ExportFormat): Promise<void> {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    const input = activeGroup.activeTab?.input;
    const sourceTextTab = input instanceof vscode.TabInputText
      ? activeGroup.activeTab
      : undefined;
    const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : undefined;
    if (!uri || (!uri.path.endsWith('.sdoc') && !uri.path.endsWith('.tiptap.json'))) {
      throw new Error('The active tab is not a Structured Doc document.');
    }
    const viewColumn = activeGroup.viewColumn;

    const key = uri.toString();
    let session = this.editorSessions.get(key);
    if (!session?.prepareFileOperation) {
      await vscode.commands.executeCommand(
        'vscode.openWith', uri, 'structuredDocEditor.sdoc',
        {
          viewColumn,
          preview: false,
        },
      );
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        session = this.editorSessions.get(key);
        if (session?.prepareFileOperation) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!session?.prepareFileOperation) {
      throw new Error('The Structured Doc editor is not ready for file operations.');
    }
    session.panel.reveal(viewColumn, false);
    if (sourceTextTab && vscode.window.tabGroups.all.some(
      (group) => group.tabs.includes(sourceTextTab),
    )) {
      const closed = await vscode.window.tabGroups.close(sourceTextTab, true);
      if (!closed) {
        throw new Error('The text editor could not be replaced by the Structured Doc editor.');
      }
      const closeDeadline = Date.now() + 2_000;
      while (Date.now() < closeDeadline && vscode.window.tabGroups.all.some(
        (group) => group.tabs.includes(sourceTextTab),
      )) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (vscode.window.tabGroups.all.some((group) => group.tabs.includes(sourceTextTab))) {
        throw new Error('The text editor remained open after the Structured Doc editor was ready.');
      }
      session.panel.reveal(viewColumn, false);
    }
    if (!this.uiReadySessionIds.has(session.sessionId)) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !this.uiReadySessionIds.has(session.sessionId)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!this.uiReadySessionIds.has(session.sessionId)) {
      throw new Error('The Structured Doc editor UI is not ready for file operations.');
    }
    await session.panel.webview.postMessage({ type: 'showFileOperation', tab: 'export' });
    await session.prepareFileOperation(randomUUID(), { kind: 'export', format });
  }

  private getActiveTestSession(): (typeof this.editorSessions extends Map<string, infer T> ? T : never) {
    const session = [...this.editorSessions.values()].find((candidate) => candidate.panel.active);
    if (!session) throw new Error('There is no active Structured Doc editor session.');
    return session;
  }

  private async flushActive(): Promise<void> {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input;
    const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : undefined;
    if (!uri) return;
    const session = this.editorSessions.get(uri.toString());
    if (session) await this.flushEditor(session.panel.webview, session.sessionId, uri.toString());
  }

  private flushEditor(
    webview: vscode.Webview,
    sessionId: string,
    documentId: string,
    timeoutMs = 5000,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        if (!this.pendingFlushResolvers.has(requestId)) return;
        this.rejectFlush(requestId, new Error('Timed out waiting for the editor to flush its latest content.'));
      }, timeoutMs);
      this.pendingFlushResolvers.set(requestId, { sessionId, documentId, resolve, reject, timer });
      void webview.postMessage({ type: 'requestFlush', sessionId, documentId, requestId }).then((delivered) => {
        if (!delivered) this.rejectFlush(requestId, new Error('The editor is unavailable for export.'));
      }, (error: unknown) => {
        this.rejectFlush(requestId, error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Resolve any pending flush for this document */
  private resolveFlush(requestId: string, sessionId: string): void {
    const pending = this.pendingFlushResolvers.get(requestId);
    if (pending?.sessionId === sessionId) {
      clearTimeout(pending.timer);
      this.pendingFlushResolvers.delete(requestId);
      pending.resolve();
    }
  }

  private rejectFlush(requestId: string, error: Error, sessionId?: string): void {
    const pending = this.pendingFlushResolvers.get(requestId);
    if (pending && (sessionId === undefined || pending.sessionId === sessionId)) {
      clearTimeout(pending.timer);
      this.pendingFlushResolvers.delete(requestId);
      pending.reject(error);
    }
  }

  private async openJsonView(document: vscode.TextDocument): Promise<void> {
    try {
      // Open the same document with text editor (not custom editor)
      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        'default',
        { viewColumn: vscode.ViewColumn.Beside, preview: false }
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open JSON view: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async openLinkedDocument(
    currentDocument: vscode.TextDocument,
    relPath: string,
    _anchor?: string
  ): Promise<void> {
    try {
      const currentDir = path.dirname(currentDocument.uri.fsPath);
      const targetPath = path.resolve(currentDir, relPath);
      const targetUri = vscode.Uri.file(targetPath);

      // Verify file exists
      try {
        await vscode.workspace.fs.stat(targetUri);
      } catch {
        vscode.window.showWarningMessage(`File not found: ${relPath}`);
        return;
      }

      await vscode.commands.executeCommand('vscode.open', targetUri);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async browseSdocFiles(
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const currentDir = path.dirname(document.uri.fsPath);

    // Find all .sdoc files in workspace
    const files = await vscode.workspace.findFiles(
      '**/*.sdoc',
      '{**/node_modules/**,**/.sdoc/templates/**}',
      100,
    );
    const currentPath = document.uri.fsPath;

    const items = files
      .filter((file) => {
        if (file.fsPath === currentPath) return false;
        return !isWorkspaceTemplatePath(file.path);
      })
      .map(f => {
        const rel = path.relative(currentDir, f.fsPath).replace(/\\/g, '/');
        const label = path.basename(f.fsPath);
        return { label, description: rel, fsPath: f.fsPath, relativePath: rel.startsWith('.') ? rel : `./${rel}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a .sdoc document to link',
      matchOnDescription: true,
    });

    if (selected) {
      // Read the target document to get its referenceable targets
      try {
        const data = await readBoundedWorkspaceFile(
          vscode.Uri.file(selected.fsPath),
          MAX_DOCUMENT_BYTES,
          'Referenced Structured Doc',
        );
        const text = new TextDecoder().decode(data);
        const contract = parseDocumentTextContract(text, { maximumBytes: MAX_DOCUMENT_BYTES });
        if (!contract.ok) {
          throw new Error(contract.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; '));
        }
        const targets = this.collectExternalTargets(contract.envelope.doc);

        webview.postMessage({
          type: 'sdocFileBrowseResult',
          path: selected.relativePath,
          fileName: selected.label,
          targets,
        });
      } catch {
        webview.postMessage({
          type: 'sdocFileBrowseResult',
          path: selected.relativePath,
          fileName: selected.label,
          targets: [],
        });
      }
    }
  }

  private collectExternalTargets(doc: TiptapNode): Array<{ id: string; type: string; label: string }> {
    const targets: Array<{ id: string; type: string; label: string }> = [];
    if (!doc?.content) return targets;

    const h = [0, 0, 0, 0, 0, 0];
    let imgCnt = 0;
    let tblCnt = 0;

    const getText = (node: TiptapNode): string => {
      if (node.type === 'text') return node.text || '';
      if (!node.content) return '';
      return node.content.map(getText).join('');
    };

    for (const node of doc.content) {
      if (node.type === 'heading') {
        const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
        h[level - 1]++;
        for (let j = level; j < 6; j++) h[j] = 0;
        if (level === 1) { imgCnt = 0; tblCnt = 0; }
        const nums = h.slice(0, level).join('.') + '.';
        const text = getText(node);
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
        if (id) targets.push({ id, type: 'heading', label: `${nums} ${text}` });
      }
      if (node.type === 'image' && typeof node.attrs?.id === 'string') {
        imgCnt++;
        const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
        targets.push({ id: node.attrs.id, type: 'figure', label: caption ? `Figure ${imgCnt}: ${caption}` : `Figure ${imgCnt}` });
      }
      if (node.type === 'table' && typeof node.attrs?.id === 'string') {
        tblCnt++;
        const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
        targets.push({ id: node.attrs.id, type: 'table', label: caption ? `Table ${tblCnt}: ${caption}` : `Table ${tblCnt}` });
      }
    }

    return targets;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = getWebviewUri(webview, this.context.extensionUri, [
      'dist',
      'webview',
      'assets',
      'index.js',
    ]);
    const styleUri = getWebviewUri(webview, this.context.extensionUri, [
      'dist',
      'webview',
      'assets',
      'webview.css',
    ]);

    // Build @font-face declarations for bundled fonts
    const fontFaces = generateFontFaceCSS(webview, this.context.extensionUri);

    const nonce = getNonce();
    const htmlLanguage = this.resolveUiLocale() === 'ko' ? 'ko-KR' : 'en';

    return `<!DOCTYPE html>
<html lang="${htmlLanguage}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <style>${fontFaces}</style>
  <link href="${styleUri}" rel="stylesheet">
  <title>Structured Doc Editor</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async selectCssFile(document: vscode.TextDocument): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const defaultUri = workspaceFolder?.uri ?? vscode.Uri.file(path.dirname(document.uri.fsPath));

    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      defaultUri,
      filters: { 'CSS Files': ['css'] },
      title: 'Custom CSS 파일 선택',
    });

    if (!result || result.length === 0) {
      return undefined;
    }

    const selectedUri = result[0];
    const basePath = workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    const relativePath = `./${path.relative(basePath, selectedUri.fsPath).replace(/\\/g, '/')}`;
    try {
      await resolveContainedRegularFile(basePath, relativePath, {
        extension: '.css',
        maximumBytes: MAX_CUSTOM_CSS_BYTES,
      });
      return relativePath;
    } catch (error) {
      await vscode.window.showWarningMessage(
        `Custom CSS must be a regular .css file inside the current workspace: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

}
