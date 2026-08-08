import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { convertJsonToHtml } from '../shared/converter';
import { detectBrowser } from './utils/browserDetect';
import { generateFontFaceCSS } from './utils/fontUtils';
import { embedImagesAsBase64, MIME_MAP } from './utils/imageUtils';
import { loadBundledExportAssets } from './services/BundledExportAssetService';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type DiagramRendererSettings,
} from '../shared/diagramRenderer';
import { prepareExportDiagrams } from '../shared/export/diagramPreparation';
import {
  DIAGRAM_RENDERER_CONSENT_STATE_KEY,
  KrokiDiagramService,
} from './services/KrokiDiagramService';
import { resolveContainedRegularFile } from './utils/containedFile';
import { MAX_CUSTOM_CSS_BYTES } from './utils/cssUtils';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { RecoverableSerialQueue } from '../shared/persistence/RecoverableSerialQueue';
import {
  readUiLanguagePreference,
  resolveUiLanguagePreference,
  type EditorLocale,
} from '../shared/editor/i18n/locale';
import {
  createBookWorkspaceInvalidState,
  createBookWorkspaceReadyState,
  scopeBookPreviewCss,
} from '../shared/editor/bookWorkspace';
import {
  getCaptionPreset,
  resolveDocumentSettingsSnapshot,
} from '../shared/settingsResolver';
import type { DocumentSettingKey, TiptapNode } from '../shared/types';
import type {
  FileOperationIntent,
  FileOperationPlanView,
  FileOperationResultAction,
  FileOperationState,
} from '../shared/editor/fileOperations';
import { createFileOperationError } from '../shared/editor/fileOperations';
import { computeRevision } from '../shared/document/operations/sha256';
import { parseContainedRelativeAssetPath } from '../shared/security/portableAssets';
import { MAX_ASSET_BYTES } from '../shared/resourceLimits';
import {
  FileOperationPlanError,
  FileOperationPlanRegistry,
} from './services/FileOperationPlanRegistry';
import {
  VsCodeExportService,
  resolveContainedExportTarget,
  type PreparedRenderedExport,
} from './services/VsCodeExportService';
import {
  applyBookManifestMutation,
  assertBookEditApplied,
  BookDocumentLoadError,
  BookMutationError,
  BookResultActionRequestDeduper,
  BOOK_CHAPTER_MAX_BYTES,
  composeBook,
  createDefaultSdocBookPublishProfile,
  fingerprintBookExportIntegrity,
  getSdocBookPublishDocumentSettings,
  hasBookErrors,
  isBookWebviewMessage,
  normalizeBookDocumentPath,
  parseBook,
  prepareBookMutationSnapshot,
  serializeBookManifestForMutation,
  upgradeBookToV1_1,
  type BookCompositionResult,
  type BookDiagnostic,
  type BookDocumentLoader,
  type BookExportIntegrityFile as BookIntegrityFile,
  type BookMutationResult,
  type BookWebviewMessage,
  type SdocBook,
} from '../shared/book';

type BookMutatingWebviewMessage = Extract<BookWebviewMessage, { requestId: string }>;

interface BookExportPlanPayload {
  prepared: PreparedRenderedExport;
  settingsFingerprint: string;
  integrity: BookExportIntegritySnapshot;
  outputDir: string;
  outputFileName: string;
  warnings: readonly string[];
}

interface BookExportIntegritySnapshot {
  fingerprint: string;
  canonicalRoot: string;
  manifestCanonicalPath: string;
  manifestRevision: number;
  manifestHash: string;
  settingsFingerprint: string;
  files: readonly BookIntegrityFile[];
}

interface BookExportArtifact {
  uri: vscode.Uri;
  openKind: 'external' | 'html';
}

interface BookUiStrings {
  removeConfirmation(label: string): string;
  removeConfirmationDetail(bookPath: string): string;
  removeAction: string;
}

const BOOK_UI_STRINGS: Readonly<Record<EditorLocale, BookUiStrings>> = {
  en: {
    removeConfirmation: (label) => `Remove “${label}” from the book manifest?`,
    removeConfirmationDetail: (bookPath) =>
      `This removes ${bookPath} from the manifest only. The .sdoc file will not be deleted.`,
    removeAction: 'Remove from Manifest',
  },
  ko: {
    removeConfirmation: (label) => `“${label}” 문서를 책 매니페스트에서 제거할까요?`,
    removeConfirmationDetail: (bookPath) =>
      `${bookPath} 항목만 매니페스트에서 제거합니다. .sdoc 파일은 삭제하지 않습니다.`,
    removeAction: '매니페스트에서 제거',
  },
};

const BOOK_OPERATION_TEXT = {
  en: {
    preparing: 'Preparing immutable Book snapshot…',
    starting: 'Starting immutable Book export…',
    printing: 'Printing immutable PDF snapshot…',
    writing: 'Writing immutable export snapshot…',
    overwrite: 'The existing destination will be replaced.',
    pdfFallback: 'PDF is unavailable; an HTML fallback will be created.',
    diagramFallback: (count: number) => `${count} diagram occurrence(s) will use source fallback.`,
    failed: 'The prepared Book export could not be completed.',
  },
  ko: {
    preparing: '불변 Book 스냅샷을 준비하는 중…',
    starting: '불변 Book 내보내기를 시작하는 중…',
    printing: '불변 PDF 스냅샷을 인쇄하는 중…',
    writing: '불변 내보내기 스냅샷을 쓰는 중…',
    overwrite: '기존 대상 파일을 덮어씁니다.',
    pdfFallback: 'PDF를 사용할 수 없어 HTML 대체 파일을 만듭니다.',
    diagramFallback: (count: number) => `${count}개 다이어그램을 원본 코드로 대체합니다.`,
    failed: '준비된 Book 내보내기를 완료하지 못했습니다.',
  },
} as const;

export class SdocBookProvider implements vscode.CustomTextEditorProvider {
  private static readonly VIEW_TYPE = 'structuredDocEditor.sdocBook';
  private readonly fileOperations = new FileOperationPlanRegistry<
    BookExportPlanPayload,
    BookExportArtifact
  >();
  private readonly exportService: VsCodeExportService;
  private readonly editorSessions = new Map<string, {
    document: vscode.TextDocument;
    panel: vscode.WebviewPanel;
    sessionId: string;
    prepareFileOperation: (format: 'html' | 'pdf') => Promise<void>;
    getFileOperationSnapshot: () => {
      state: FileOperationState;
      plan?: FileOperationPlanView;
    };
    confirmFileOperation: () => void;
    openSource: () => void;
    runResultAction: (
      action: FileOperationResultAction,
      artifactId?: string,
    ) => Promise<{ status: 'completed' | 'failed'; actionRequestId: string }>;
  }>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.exportService = new VsCodeExportService(context);
  }

  private readDiagramRendererSettings(): DiagramRendererSettings {
    const config = vscode.workspace.getConfiguration('structuredDocEditor.diagramRenderer');
    const userValue = <T,>(key: string, fallback: T): T =>
      config.inspect<T>(key)?.globalValue ?? fallback;
    const storedConsent = this.context.globalState.get<unknown>(DIAGRAM_RENDERER_CONSENT_STATE_KEY);
    return {
      consent: storedConsent === 'granted' || storedConsent === 'declined'
        ? storedConsent
        : 'undecided',
      endpoint: userValue('endpoint', DEFAULT_DIAGRAM_RENDERER_SETTINGS.endpoint),
      allowPrivateNetwork: userValue(
        'allowPrivateNetwork',
        DEFAULT_DIAGRAM_RENDERER_SETTINGS.allowPrivateNetwork,
      ),
    };
  }

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SdocBookProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      SdocBookProvider.VIEW_TYPE,
      provider,
      { supportsMultipleEditorsPerDocument: false }
    );
    const testRegistrations = context.extensionMode === vscode.ExtensionMode.Test
      ? [
        vscode.commands.registerCommand(
          'structuredDocEditor.test.getActiveBookFileOperation',
          () => provider.getActiveTestSession().getFileOperationSnapshot(),
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.prepareActiveBookExport',
          (format: 'html' | 'pdf' = 'html') => {
            if (format !== 'html' && format !== 'pdf') throw new Error('Unsupported Book test export format.');
            return provider.getActiveTestSession().prepareFileOperation(format);
          },
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.confirmActiveBookFileOperation',
          () => provider.getActiveTestSession().confirmFileOperation(),
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.runActiveBookResultAction',
          (action: FileOperationResultAction, artifactId?: string) =>
            provider.getActiveTestSession().runResultAction(action, artifactId),
        ),
        vscode.commands.registerCommand(
          'structuredDocEditor.test.openActiveBookSource',
          () => provider.getActiveTestSession().openSource(),
        ),
      ]
      : [];
    return vscode.Disposable.from(providerRegistration, ...testRegistrations);
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const projectDir = path.dirname(document.uri.fsPath);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.file(projectDir),
      ],
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const sessionId = randomUUID();
    const documentId = document.uri.toString();
    let updateSequence = 0;
    let sourceEpoch = 0;
    let disposed = false;
    let webviewReady = false;
    let latestFileOperationState: FileOperationState = { phase: 'idle' };
    let latestFileOperationPlan: FileOperationPlanView | undefined;
    const resultActionStatuses = new Map<string, { status: 'completed' | 'failed' }>();
    let latestWorkspaceState: ReturnType<typeof createBookWorkspaceReadyState>
      | ReturnType<typeof createBookWorkspaceInvalidState>
      | undefined;
    let updateTimer: NodeJS.Timeout | undefined;
    let activeLoad: AbortController | undefined;
    let activeFileOperation: {
      requestId: string;
      phase: 'preflighting' | 'awaiting-confirmation' | 'running';
    } | undefined;
    const filePreflightRequests = new Map<string, AbortController>();
    const resultActionRequests = new BookResultActionRequestDeduper();
    let latestBookSource: {
      revision: number;
      sourceEpoch: number;
      book: SdocBook;
      composition: BookCompositionResult;
      diagnostics: BookDiagnostic[];
      chapterInputs: BookIntegrityFile[];
    } | undefined;
    const unavailableTestSeam = (): never => {
      throw new Error('The Structured Doc Book file-operation test seam is not ready.');
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
      confirmFileOperation: unavailableTestSeam,
      openSource: unavailableTestSeam,
      runResultAction: async () => unavailableTestSeam(),
    });
    let includeKeys = new Set<string>();
    let includeWatchers: vscode.Disposable[] = [];
    const mutationQueue = new RecoverableSerialQueue();
    const portableFileKey = (filePath: string): string => path.resolve(filePath).normalize('NFC').toLocaleLowerCase('en-US');
    const replaceIncludeWatchers = (book: SdocBook): void => {
      includeWatchers.forEach((item) => item.dispose());
      includeWatchers = [];
      includeKeys = new Set(book.documents.map((entry) => portableFileKey(path.resolve(
        path.dirname(document.uri.fsPath), entry.path,
      ))));
      for (const entry of book.documents) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), entry.path.replace(/^\.\//, '')),
        );
        includeWatchers.push(
          watcher,
          watcher.onDidCreate(() => scheduleUpdate()),
          watcher.onDidChange(() => scheduleUpdate()),
          watcher.onDidDelete(() => scheduleUpdate()),
        );
      }
      if (book.sdocBook === '1.1' && book.publish.theme.cssPath) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(document.uri.fsPath)),
            book.publish.theme.cssPath.replace(/^\.\//, ''),
          ),
        );
        includeWatchers.push(
          watcher,
          watcher.onDidCreate(() => scheduleUpdate()),
          watcher.onDidChange(() => scheduleUpdate()),
          watcher.onDidDelete(() => scheduleUpdate()),
        );
      }
    };
    const updateWebview = async (): Promise<void> => {
      const sequence = ++updateSequence;
      const loadEpoch = sourceEpoch;
      activeLoad?.abort(new Error('Book composition superseded.'));
      const controller = new AbortController();
      activeLoad = controller;
      let result: {
        book?: SdocBook;
        composition?: BookCompositionResult;
        diagnostics: BookDiagnostic[];
        chapterInputs: BookIntegrityFile[];
      };
      try {
        result = await this.loadBook(document, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        throw error;
      }
      if (disposed || sequence !== updateSequence) return;
      const locale = this.getBookUiLocale();
      if (!result.book || !result.composition) {
        latestBookSource = undefined;
        latestWorkspaceState = createBookWorkspaceInvalidState({
          diagnostics: result.diagnostics,
          generation: sequence,
          revision: document.version,
          locale,
        });
      } else {
        let previewCustomCss = '';
        if (result.book.sdocBook === '1.1' && result.book.publish.theme.cssPath) {
          try {
            const { canonicalPath } = await resolveContainedRegularFile(
              projectDir,
              result.book.publish.theme.cssPath,
              { extension: '.css', maximumBytes: MAX_CUSTOM_CSS_BYTES },
            );
            previewCustomCss = scopeBookPreviewCss(
              await fs.promises.readFile(canonicalPath, 'utf8'),
            );
          } catch {
            previewCustomCss = '';
          }
        }
        latestBookSource = {
          revision: document.version,
          sourceEpoch: loadEpoch,
          book: result.book,
          composition: result.composition,
          diagnostics: result.diagnostics,
          chapterInputs: result.chapterInputs,
        };
        replaceIncludeWatchers(result.book);
        latestWorkspaceState = createBookWorkspaceReadyState({
          book: result.book,
          composition: {
            ...result.composition,
            doc: this.toBookPreviewDocument(
              result.composition.doc,
              webviewPanel.webview,
              projectDir,
            ),
          },
          diagnostics: result.diagnostics,
          generation: sequence,
          revision: document.version,
          locale,
          ...(previewCustomCss ? { previewCustomCss } : {}),
        });
      }
      if (webviewReady) await webviewPanel.webview.postMessage({
        type: 'bookWorkspaceState',
        sessionId,
        documentId,
        state: latestWorkspaceState,
      });
    };

    const scheduleUpdate = (immediate = false): void => {
      sourceEpoch += 1;
      activeLoad?.abort(new Error('Book composition superseded.'));
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = undefined;
        void updateWebview().catch((error: unknown) => {
          vscode.window.showErrorMessage(`Failed to refresh book: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, immediate ? 0 : 100);
    };

    scheduleUpdate(true);

    const isProjectDocument = (candidate: vscode.TextDocument): boolean => {
      if (candidate.uri.toString() === document.uri.toString()) return true;
      if (candidate.uri.scheme !== 'file' || !candidate.uri.fsPath.toLowerCase().endsWith('.sdoc')) return false;
      return includeKeys.has(portableFileKey(candidate.uri.fsPath));
    };
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (isProjectDocument(event.document)) scheduleUpdate();
    });
    const configurationSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('structuredDocEditor.ui.language')) scheduleUpdate(true);
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      activeLoad?.abort(new Error('Book editor disposed.'));
      for (const request of filePreflightRequests.values()) request.abort();
      this.fileOperations.clearSession(sessionId);
      if (updateTimer) clearTimeout(updateTimer);
      changeSubscription.dispose();
      configurationSubscription.dispose();
      includeWatchers.forEach((item) => item.dispose());
      if (this.editorSessions.get(documentId)?.panel === webviewPanel) {
        this.editorSessions.delete(documentId);
      }
    });

    const postMutationResult = async (result: BookMutationResult): Promise<void> => {
      if (!disposed) await webviewPanel.webview.postMessage(result);
    };
    const enqueueMutation = (
      message: BookMutatingWebviewMessage,
      mutate: () => Promise<'applied' | 'cancelled'>,
    ): void => {
      mutationQueue.enqueue(async () => {
        const status = await mutate();
        await postMutationResult({
          type: 'bookMutationResult',
          requestId: message.requestId,
          status,
          revision: document.version,
        });
      }, (error: unknown) => {
        const mutationError = error instanceof BookMutationError ? error : new BookMutationError(
          'operation-failed',
          error instanceof Error ? error.message : String(error),
        );
        console.error('Structured Doc book mutation failed', error);
        void postMutationResult({
          type: 'bookMutationResult',
          requestId: message.requestId,
          status: 'rejected',
          revision: document.version,
          error: { code: mutationError.code, message: mutationError.message },
        }).catch(() => {});
      });
    };

    const postFileOperationStatus = async (state: FileOperationState): Promise<void> => {
      latestFileOperationState = state;
      if (!disposed) await webviewPanel.webview.postMessage({
        type: 'fileOperationStatus', sessionId, documentId, state,
      });
    };
    const postFileOperationFailure = async (
      requestId: string,
      code: string,
      message: string,
      retryable: boolean,
      intent?: FileOperationIntent,
    ): Promise<void> => postFileOperationStatus({
      phase: 'failed', requestId,
      error: createFileOperationError(code, message, retryable),
      ...(intent ? { intent } : {}),
    });
    const postResultActionStatus = async (
      requestId: string,
      actionRequestId: string,
      action: FileOperationResultAction,
      status: 'completed' | 'failed',
      error?: ReturnType<typeof createFileOperationError>,
    ): Promise<void> => {
      if (this.context.extensionMode === vscode.ExtensionMode.Test) {
        resultActionStatuses.set(actionRequestId, { status });
      }
      if (!disposed) await webviewPanel.webview.postMessage({
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
    const beginBookExportPreflight = async (
      requestId: string,
      format: 'html' | 'pdf',
      baseRevision: number,
      expectedSettingsFingerprint: string,
    ): Promise<void> => {
      const intent = { kind: 'export', format } as const;
      const operationText = BOOK_OPERATION_TEXT[this.getBookUiLocale()];
      if (activeFileOperation) {
        await postFileOperationFailure(
          requestId, 'FILE_OPERATION_BUSY', 'Another Book export is already active.', false, intent,
        );
        return;
      }
      activeFileOperation = { requestId, phase: 'preflighting' };
      this.fileOperations.rememberRetryIntent(sessionId, requestId, intent);
      const controller = new AbortController();
      filePreflightRequests.set(requestId, controller);
      await postFileOperationStatus({
        phase: 'preflighting', requestId, intent,
        stage: operationText.preparing,
      });
      try {
        if (document.version !== baseRevision) {
          throw new FileOperationPlanError('STALE_SOURCE', 'The Book changed before preflight started.');
        }
        if (!latestBookSource
          || latestBookSource.revision !== document.version
          || latestBookSource.sourceEpoch !== sourceEpoch) {
          await updateWebview();
        }
        controller.signal.throwIfAborted();
        const source = latestBookSource;
        if (!source || hasBookErrors(source.diagnostics)) {
          throw new Error('Book export is blocked until its diagnostics are resolved.');
        }
        if (source.book.sdocBook === '1.0') {
          throw new Error('Book export requires an explicitly saved .sdocbook 1.1 publish profile.');
        }
        if (document.version !== baseRevision || source.sourceEpoch !== sourceEpoch) {
          throw new FileOperationPlanError('STALE_SOURCE', 'The Book changed during preflight.');
        }
        const profile = source.book.publish;
        const settingsSnapshot = resolveDocumentSettingsSnapshot({
          context: 'book',
          bookProfileSettings: getSdocBookPublishDocumentSettings(profile),
          chapterSettings: source.composition.documents.map((chapter) => ({
            documentPath: chapter.path,
            settings: chapter.meta?.settings,
          })),
        });
        if (settingsSnapshot.fingerprint !== expectedSettingsFingerprint) {
          throw new FileOperationPlanError(
            'STALE_SOURCE', 'The effective Book publish settings changed before preflight.',
          );
        }
        const projectDir = path.dirname(document.uri.fsPath);
        const diagramService = new KrokiDiagramService(this.readDiagramRendererSettings());
        const diagramPreparation = await prepareExportDiagrams(
          source.composition.documents.flatMap((chapter) => chapter.status === 'ok' && chapter.doc
            ? [{ kind: 'chapter' as const, scopeId: chapter.path, document: chapter.doc }]
            : []),
          {
            signal: controller.signal,
            render: async ({ language, source: diagramSource, signal: renderSignal }) => {
              const rendered = await diagramService.render(language, diagramSource, { signal: renderSignal });
              return { dataUrl: rendered.dataUrl };
            },
          },
        );
        controller.signal.throwIfAborted();
        if (diagramPreparation.status === 'fallback' && profile.diagrams.failurePolicy === 'fail') {
          throw new Error('The saved publish profile blocks export when a diagram cannot be rendered.');
        }

        const imageIntegrityBefore = await this.captureBookImageIntegrity(
          projectDir, source.composition.doc, controller.signal,
        );
        let finalDoc = source.composition.doc;
        if (profile.html.selfContained !== 'none' || format === 'pdf') {
          finalDoc = await embedImagesAsBase64(finalDoc, projectDir, controller.signal);
          controller.signal.throwIfAborted();
        }
        const imageIntegrityAfter = await this.captureBookImageIntegrity(
          projectDir, source.composition.doc, controller.signal,
        );
        if (computeRevision(JSON.stringify(imageIntegrityBefore))
          !== computeRevision(JSON.stringify(imageIntegrityAfter))) {
          throw new FileOperationPlanError(
            'STALE_SOURCE', 'A Book image changed while preflight was being prepared.',
          );
        }
        let customStyles = '';
        const profileAssets: BookIntegrityFile[] = [...imageIntegrityAfter];
        if (profile.theme.cssPath) {
          const { canonicalPath } = await resolveContainedRegularFile(projectDir, profile.theme.cssPath, {
            extension: '.css', maximumBytes: MAX_CUSTOM_CSS_BYTES,
          });
          const cssBytes = await fs.promises.readFile(canonicalPath);
          customStyles = cssBytes.toString('utf8');
          profileAssets.push({
            kind: 'css', bookPath: profile.theme.cssPath,
            canonicalPath,
            byteLength: cssBytes.byteLength,
            contentHash: computeRevision(cssBytes),
          });
          controller.signal.throwIfAborted();
        }
        const preset = getCaptionPreset(settingsSnapshot.values.captionStyle);
        const exportSettings = {
          ...settingsSnapshot.values,
          imageCaptionPrefix: preset.figurePrefix,
          tableCaptionPrefix: preset.tablePrefix,
          equationCaptionPrefix: preset.equationPrefix,
          captionSeparator: preset.separator,
          tableNumberStyle: preset.tableNumberStyle,
          equationParens: preset.equationParens,
          exportImagePath: 'relative' as const,
          counterResetPaths: source.composition.counterResetPaths,
          ...(profile.html.selfContained === 'full' ? {
            embeddedAssets: await loadBundledExportAssets(this.context.extensionPath),
          } : {}),
        };
        controller.signal.throwIfAborted();
        let htmlContent = convertJsonToHtml(
          finalDoc,
          customStyles ? { customStyles } : undefined,
          exportSettings,
          source.composition.meta,
          { resolveDiagramImage: diagramPreparation.resolveDiagramImage },
        );
        const pdfBrowserPath = format === 'pdf' ? detectBrowser() : undefined;
        const pdfFallback = format === 'pdf' && !pdfBrowserPath;
        if (format === 'pdf' && !pdfFallback) {
          htmlContent = htmlContent.replace(
            '</head>',
            `<style>body{zoom:${settingsSnapshot.values.pdfScale / 100};}</style>\n</head>`,
          );
        }
        const outputFileName = `${path.basename(document.uri.fsPath, '.sdocbook')}.${
          pdfFallback ? 'html' : format
        }`;
        const outputTarget = await resolveContainedExportTarget(
          projectDir,
          profile.outputDir ?? '',
          outputFileName,
          'book',
        );
        const outputUri = vscode.Uri.file(outputTarget.targetPath);
        const targetFingerprint = await this.exportService.readTargetFingerprint(outputUri);
        controller.signal.throwIfAborted();
        if (document.version !== baseRevision || source.sourceEpoch !== sourceEpoch) {
          throw new FileOperationPlanError('STALE_SOURCE', 'The Book changed during preflight.');
        }
        const integrity = await this.createBookExportIntegritySnapshot(
          document,
          settingsSnapshot.fingerprint,
          source.chapterInputs,
          profileAssets,
        );
        const sourceFingerprint = integrity.fingerprint;
        const warnings = Object.freeze([
          ...settingsSnapshot.diagnostics.map((diagnostic) => diagnostic.message),
          ...(targetFingerprint !== 'missing' ? [operationText.overwrite] : []),
          ...(pdfFallback ? [operationText.pdfFallback] : []),
          ...(diagramPreparation.status === 'fallback'
            ? [operationText.diagramFallback(diagramPreparation.fallbackOccurrenceCount)]
            : []),
        ]);
        const prepared: PreparedRenderedExport = Object.freeze({
          sourceUri: document.uri,
          format,
          htmlContent,
          outputUri,
          outputRootPath: outputTarget.rootPath,
          targetFingerprint,
          targetExists: targetFingerprint !== 'missing',
          pdfFallback,
          ...(pdfBrowserPath ? { pdfBrowserPath } : {}),
        });
        const { planId } = this.fileOperations.registerPlan({
          sessionId, requestId, intent, sourceFingerprint, targetFingerprint,
          payload: Object.freeze({
            prepared,
            settingsFingerprint: settingsSnapshot.fingerprint,
            integrity,
            outputDir: profile.outputDir ?? '',
            outputFileName,
            warnings,
          }),
        });
        if (activeFileOperation?.requestId !== requestId) return;
        activeFileOperation = { requestId, phase: 'awaiting-confirmation' };
        const planView: FileOperationPlanView = {
          planId, intent,
          source: {
            displayName: path.basename(document.uri.fsPath),
            sizeBytes: new TextEncoder().encode(document.getText()).byteLength
              + integrity.files.reduce((total, item) => total + item.byteLength, 0),
            revision: document.version,
          },
          destination: {
            displayName: path.basename(outputUri.fsPath),
            exists: targetFingerprint !== 'missing',
            scope: 'book',
            relativePath: outputTarget.relativePath,
          },
          effectiveSettings: {
            fingerprint: settingsSnapshot.fingerprint,
            items: Object.entries(settingsSnapshot.entries)
              .filter(([, entry]) => entry.appliesTo.includes(format))
              .map(([key, entry]) => ({
                key: key as DocumentSettingKey,
                value: String(entry.value),
                source: entry.source,
              })),
          },
          diagram: {
            failurePolicy: profile.diagrams.failurePolicy,
            fallbackCount: diagramPreparation.fallbackOccurrenceCount,
          },
          warnings,
          requiresConfirmation: true,
        };
        latestFileOperationPlan = planView;
        latestFileOperationState = {
          phase: 'awaiting-confirmation', requestId, intent, plan: planView,
        };
        await webviewPanel.webview.postMessage({
          type: 'fileOperationPreflight', requestId, sessionId, documentId,
          plan: planView,
        });
      } catch (error) {
        if (activeFileOperation?.requestId !== requestId) return;
        activeFileOperation = undefined;
        if (controller.signal.aborted) {
          await postFileOperationStatus({ phase: 'cancelled', requestId, intent });
        } else {
          const code = error instanceof FileOperationPlanError ? error.code : 'PREFLIGHT_FAILED';
          console.error('Structured Doc Book export preflight failed', error);
          await postFileOperationFailure(
            requestId, code, error instanceof Error ? error.message : 'Book export could not be prepared.', true, intent,
          );
        }
      } finally {
        filePreflightRequests.delete(requestId);
      }
    };

    const handleBookMessage = (message: unknown): void => {
      if (!isBookWebviewMessage(message)) return;
      switch (message.type) {
        case 'bookReady':
          webviewReady = true;
          if (latestWorkspaceState) {
            void webviewPanel.webview.postMessage({
              type: 'bookWorkspaceState',
              sessionId,
              documentId,
              state: latestWorkspaceState,
            });
          } else {
            scheduleUpdate(true);
          }
          break;
        case 'openBookSource':
          void vscode.commands.executeCommand(
            'vscode.openWith',
            document.uri,
            'default',
            { viewColumn: vscode.ViewColumn.Beside },
          );
          break;
        case 'openDocument': {
          const parsed = parseBook(document.getText());
          const target = parsed.book?.documents[message.index];
          if (!target) break;
          void resolveContainedRegularFile(projectDir, target.path, {
            extension: '.sdoc',
            maximumBytes: BOOK_CHAPTER_MAX_BYTES,
          }).then(
            ({ canonicalPath }) => vscode.commands.executeCommand('vscode.open',
              vscode.Uri.file(canonicalPath).with({ fragment: message.nodeId ?? '' })),
            () => vscode.window.showWarningMessage(`File unavailable or unsafe: ${target.path}`),
          );
          break;
        }
        case 'openDiagnostic': {
          const diagnostic = latestWorkspaceState?.diagnostics[message.index];
          if (!diagnostic?.documentPath) {
            void vscode.commands.executeCommand('vscode.open', document.uri);
            break;
          }
          const parsed = parseBook(document.getText());
          const index = parsed.book?.documents.findIndex((entry) => entry.path === diagnostic.documentPath) ?? -1;
          const target = parsed.book?.documents[index];
          if (!target) {
            void vscode.commands.executeCommand('vscode.open', document.uri);
            break;
          }
          void resolveContainedRegularFile(projectDir, target.path, {
            extension: '.sdoc',
            maximumBytes: BOOK_CHAPTER_MAX_BYTES,
          }).then(
            ({ canonicalPath }) => vscode.commands.executeCommand('vscode.open',
              vscode.Uri.file(canonicalPath).with({ fragment: diagnostic.nodeId ?? '' })),
            () => vscode.window.showWarningMessage(`File unavailable or unsafe: ${target.path}`),
          );
          break;
        }
        case 'addDocument': {
          enqueueMutation(message, async () => {
            prepareBookMutationSnapshot(document.getText(), document.version, message.baseRevision);
            const files = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectMany: true,
              filters: { 'Sdoc Files': ['sdoc'] },
              defaultUri: vscode.Uri.file(path.dirname(document.uri.fsPath)),
            });
            if (disposed) return 'cancelled';
            if (!files || files.length === 0) return 'cancelled';
            const project = prepareBookMutationSnapshot(
              document.getText(),
              document.version,
              message.baseRevision,
            );
            const additions: string[] = [];
            for (const file of files) {
              const relative = path.relative(projectDir, file.fsPath).replace(/\\/g, '/');
              const bookPath = normalizeBookDocumentPath(relative);
              if (!bookPath) {
                void vscode.window.showWarningMessage(`Book documents must stay inside the book folder: ${file.fsPath}`);
                continue;
              }
              additions.push(bookPath);
            }
            if (additions.length === 0) return 'cancelled';
            const next = applyBookManifestMutation(project, { type: 'addDocuments', paths: additions });
            if (next.documents.length === project.documents.length) return 'cancelled';
            await this.updateProjectFile(document, next, message.baseRevision);
            return 'applied';
          });
          break;
        }
        case 'removeDocument': {
          enqueueMutation(message, async () => {
            let project = prepareBookMutationSnapshot(
              document.getText(),
              document.version,
              message.baseRevision,
            );
            const target = project.documents[message.index];
            if (!target) throw new BookMutationError('invalid-request', 'The document is no longer in the book manifest.');
            const strings = this.getBookUiStrings();
            const selected = await vscode.window.showWarningMessage(
              strings.removeConfirmation(target.label || path.basename(target.path, '.sdoc')),
              { modal: true, detail: strings.removeConfirmationDetail(target.path) },
              strings.removeAction,
            );
            if (disposed) return 'cancelled';
            if (selected !== strings.removeAction) return 'cancelled';
            project = prepareBookMutationSnapshot(document.getText(), document.version, message.baseRevision);
            const next = applyBookManifestMutation(project, { type: 'removeDocument', index: message.index });
            await this.updateProjectFile(document, next, message.baseRevision);
            return 'applied';
          });
          break;
        }
        case 'moveDocument': {
          enqueueMutation(message, async () => {
            const project = prepareBookMutationSnapshot(
              document.getText(),
              document.version,
              message.baseRevision,
            );
            const next = applyBookManifestMutation(project, {
              type: 'moveDocument',
              from: message.from,
              to: message.to,
            });
            await this.updateProjectFile(document, next, message.baseRevision);
            return 'applied';
          });
          break;
        }
        case 'updateMeta': {
          enqueueMutation(message, async () => {
            const project = prepareBookMutationSnapshot(
              document.getText(),
              document.version,
              message.baseRevision,
            );
            const next = applyBookManifestMutation(project, {
              type: 'updateMeta',
              key: message.key,
              value: message.value,
            });
            await this.updateProjectFile(document, next, message.baseRevision);
            return 'applied';
          });
          break;
        }
        case 'savePublishProfile': {
          enqueueMutation(message, async () => {
            const project = prepareBookMutationSnapshot(
              document.getText(),
              document.version,
              message.baseRevision,
            );
            const profileBase = project.sdocBook === '1.0'
              ? upgradeBookToV1_1(project, createDefaultSdocBookPublishProfile())
              : project;
            const parsed = parseBook({ ...profileBase, publish: message.profile });
            const blocking = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
            if (!parsed.book || parsed.book.sdocBook !== '1.1' || blocking) {
              throw new BookMutationError(
                'invalid-request',
                blocking?.message ?? 'The publish profile is invalid.',
              );
            }
            await this.updateProjectFile(document, parsed.book, message.baseRevision);
            return 'applied';
          });
          break;
        }
        case 'prepareBookExport': {
          if (message.sessionId !== sessionId || message.documentId !== documentId) break;
          void beginBookExportPreflight(
            message.requestId,
            message.format,
            message.baseRevision,
            message.settingsFingerprint,
          );
          break;
        }
        case 'exportProject': {
          const ready = latestWorkspaceState?.status === 'ready' ? latestWorkspaceState : undefined;
          if (ready) void beginBookExportPreflight(
            randomUUID(), message.format, ready.revision, ready.settings.fingerprint,
          );
          break;
        }
        case 'fileOperationExecute': {
          if (message.sessionId !== sessionId || message.documentId !== documentId) break;
          if (activeFileOperation?.requestId !== message.requestId
            || activeFileOperation.phase !== 'awaiting-confirmation') break;
          activeFileOperation = { requestId: message.requestId, phase: 'running' };
          void (async () => {
            const operationText = BOOK_OPERATION_TEXT[this.getBookUiLocale()];
            try {
              const plan = this.fileOperations.getPlan(sessionId, message.requestId, message.planId);
              await postFileOperationStatus({
                phase: 'running', requestId: message.requestId,
                kind: 'export', format: plan.intent.format,
                intent: plan.intent, planId: message.planId,
                stage: operationText.starting,
              });
              const result = await this.fileOperations.executePlan({
                sessionId, requestId: message.requestId, planId: message.planId,
                readSourceFingerprint: async () => this.readCurrentBookIntegrityFingerprint(
                  document, plan.payload.integrity,
                ),
                readTargetFingerprint: async () => {
                  const checked = await resolveContainedExportTarget(
                    projectDir, plan.payload.outputDir, plan.payload.outputFileName, 'book',
                  );
                  if (portableFileKey(checked.targetPath)
                    !== portableFileKey(plan.payload.prepared.outputUri.fsPath)) return 'unsafe-output';
                  return this.exportService.readTargetFingerprint(plan.payload.prepared.outputUri);
                },
                onProgress: (stage) => {
                  const localizedStage = stage === 'Printing immutable PDF snapshot…'
                    ? operationText.printing
                    : stage === 'Writing immutable export snapshot…'
                      ? operationText.writing
                      : stage;
                  void postFileOperationStatus({
                    phase: 'running', requestId: message.requestId,
                    kind: 'export', format: plan.intent.format,
                    intent: plan.intent, planId: message.planId, stage: localizedStage,
                  });
                },
                run: async (registered, signal, report) => {
                  const validatePreparedInputs = async (): Promise<void> => {
                    const currentSource = await this.readCurrentBookIntegrityFingerprint(
                      document, registered.payload.integrity, signal,
                    );
                    if (currentSource !== registered.sourceFingerprint) {
                      throw new FileOperationPlanError(
                        'STALE_SOURCE', 'The Book source or a publish asset changed after preflight.',
                      );
                    }
                    const checked = await resolveContainedExportTarget(
                      projectDir,
                      registered.payload.outputDir,
                      registered.payload.outputFileName,
                      'book',
                    );
                    if (portableFileKey(checked.targetPath)
                      !== portableFileKey(registered.payload.prepared.outputUri.fsPath)) {
                      throw new FileOperationPlanError(
                        'STALE_TARGET', 'The Book output destination changed after preflight.',
                      );
                    }
                    const current = await this.exportService.readTargetFingerprint(
                      registered.payload.prepared.outputUri,
                    );
                    if (current !== registered.targetFingerprint) {
                      throw new FileOperationPlanError(
                        'STALE_TARGET', 'The destination changed after preflight.',
                      );
                    }
                  };
                  return this.exportService.executePreparedRenderedExport(
                    registered.payload.prepared,
                    {
                      signal,
                      onProgress: report,
                      validateBeforeWrite: validatePreparedInputs,
                      validateTarget: validatePreparedInputs,
                      onCommitStart: () => this.fileOperations.markCommitStarted(
                        sessionId, message.requestId, message.planId,
                      ),
                    },
                  );
                },
              });
              if (result.outcome === 'cancelled' || !result.outputUri) {
                await postFileOperationStatus({
                  phase: 'cancelled', requestId: message.requestId, intent: plan.intent,
                });
                return;
              }
              const { artifactId } = this.fileOperations.registerArtifact(sessionId, {
                uri: result.outputUri,
                openKind: plan.intent.format === 'pdf' && result.outcome !== 'fallback'
                  ? 'external' : 'html',
              });
              await postFileOperationStatus({
                phase: 'succeeded', requestId: message.requestId,
                result: result.outcome, intent: plan.intent,
                details: {
                  outcome: result.outcome,
                  artifact: {
                    artifactId,
                    displayName: path.basename(result.outputUri.fsPath),
                    sizeBytes: result.sizeBytes ?? 0,
                  },
                  warnings: plan.payload.warnings,
                  availableActions: [
                    { action: 'open', artifactId },
                    { action: 'reveal', artifactId },
                    { action: 'copy', artifactId },
                    { action: 'repeat' },
                  ],
                },
              });
            } catch (error) {
              const intent = this.fileOperations.getRetryIntent(sessionId, message.requestId);
              if (error instanceof DOMException && error.name === 'AbortError') {
                await postFileOperationStatus({
                  phase: 'cancelled', requestId: message.requestId, ...(intent ? { intent } : {}),
                });
              } else {
                const code = error instanceof FileOperationPlanError ? error.code : 'EXPORT_FAILED';
                console.error('Structured Doc Book prepared export failed', error);
                await postFileOperationFailure(
                  message.requestId, code, operationText.failed, true, intent,
                );
              }
            } finally {
              if (activeFileOperation?.requestId === message.requestId) {
                activeFileOperation = undefined;
              }
            }
          })();
          break;
        }
        case 'fileOperationCancel': {
          if (message.sessionId !== sessionId || message.documentId !== documentId) break;
          const preflight = filePreflightRequests.get(message.requestId);
          preflight?.abort();
          if (preflight) break;
          const phase = activeFileOperation?.requestId === message.requestId
            ? activeFileOperation.phase
            : undefined;
          const cancelled = this.fileOperations.cancelPlan(
            sessionId, message.requestId, message.planId,
          );
          if (cancelled && phase === 'awaiting-confirmation') {
            activeFileOperation = undefined;
            void postFileOperationStatus({
              phase: 'cancelled', requestId: message.requestId,
              intent: this.fileOperations.getRetryIntent(sessionId, message.requestId),
            });
          }
          break;
        }
        case 'fileOperationRetry': {
          if (message.sessionId !== sessionId || message.documentId !== documentId) break;
          const intent = this.fileOperations.getRetryIntent(sessionId, message.previousRequestId);
          const ready = latestWorkspaceState?.status === 'ready' ? latestWorkspaceState : undefined;
          if (!intent || intent.kind !== 'export' || !ready
            || (intent.format !== 'html' && intent.format !== 'pdf')) {
            void postFileOperationFailure(
              message.requestId, 'PLAN_NOT_FOUND', 'The previous Book export is unavailable.', false,
            );
          } else {
            void beginBookExportPreflight(
              message.requestId, intent.format, ready.revision, ready.settings.fingerprint,
            );
          }
          break;
        }
        case 'fileOperationResultAction': {
          if (message.sessionId !== sessionId || message.documentId !== documentId) break;
          if (!resultActionRequests.claim(message.actionRequestId)) break;
          if (message.action === 'repeat') {
            const intent = this.fileOperations.getRetryIntent(sessionId, message.requestId);
            const ready = latestWorkspaceState?.status === 'ready' ? latestWorkspaceState : undefined;
            if (!intent || intent.kind !== 'export' || !ready
              || (intent.format !== 'html' && intent.format !== 'pdf')) {
              void postResultActionStatus(
                message.requestId, message.actionRequestId, message.action, 'failed',
                createFileOperationError(
                  'PLAN_NOT_FOUND', 'The previous Book export is unavailable.', false,
                ),
              );
            } else if (activeFileOperation) {
              void postResultActionStatus(
                message.requestId, message.actionRequestId, message.action, 'failed',
                createFileOperationError(
                  'FILE_OPERATION_BUSY', 'Another Book export is already active.', false,
                ),
              );
            } else {
              const repeated = beginBookExportPreflight(
                message.actionRequestId,
                intent.format,
                ready.revision,
                ready.settings.fingerprint,
              );
              void postResultActionStatus(
                message.requestId, message.actionRequestId, message.action, 'completed',
              );
              void repeated;
            }
            break;
          }
          void (async () => {
            try {
              const artifact = this.fileOperations.getArtifact(sessionId, message.artifactId);
              if (message.action === 'open') {
                if (artifact.openKind === 'external') await vscode.env.openExternal(artifact.uri);
                else await vscode.commands.executeCommand('vscode.open', artifact.uri);
              } else if (message.action === 'reveal') {
                await vscode.commands.executeCommand('revealFileInOS', artifact.uri);
              } else {
                await vscode.env.clipboard.writeText(artifact.uri.fsPath);
              }
              await postResultActionStatus(
                message.requestId, message.actionRequestId, message.action, 'completed',
              );
            } catch (error) {
              console.error('Structured Doc Book result action failed', error);
              await postResultActionStatus(
                message.requestId, message.actionRequestId, message.action, 'failed',
                createFileOperationError(
                  error instanceof FileOperationPlanError ? error.code : 'RESULT_ACTION_FAILED',
                  'The result action could not be completed.',
                  true,
                ),
              );
            }
          })();
          break;
        }
        case 'refreshBook':
          scheduleUpdate(true);
          break;
      }
    };
    webviewPanel.webview.onDidReceiveMessage(handleBookMessage);

    const registeredSession = this.editorSessions.get(documentId);
    if (registeredSession?.panel === webviewPanel && registeredSession.sessionId === sessionId) {
      registeredSession.prepareFileOperation = async (format) => {
        const deadline = Date.now() + 10_000;
        while (latestWorkspaceState?.status !== 'ready' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const ready = latestWorkspaceState?.status === 'ready' ? latestWorkspaceState : undefined;
        if (!ready || !ready.canExport) {
          throw new Error('The active Book is not ready for export.');
        }
        await beginBookExportPreflight(
          randomUUID(), format, ready.revision, ready.settings.fingerprint,
        );
      };
      registeredSession.confirmFileOperation = () => {
        const current = latestFileOperationState;
        if (current.phase !== 'awaiting-confirmation') {
          throw new Error('There is no Book export awaiting confirmation.');
        }
        handleBookMessage({
          type: 'fileOperationExecute',
          requestId: current.requestId,
          sessionId,
          documentId,
          planId: current.plan.planId,
        });
      };
      registeredSession.openSource = () => handleBookMessage({ type: 'openBookSource' });
      registeredSession.runResultAction = async (action, artifactId) => {
        const leaseDeadline = Date.now() + 5_000;
        while (activeFileOperation && Date.now() < leaseDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (activeFileOperation) throw new Error('The previous Book export is still active.');
        const current = latestFileOperationState;
        if (current.phase !== 'succeeded') {
          throw new Error('There is no completed Book export result.');
        }
        const matchingAction = current.details?.availableActions
          .find((candidate) => candidate.action === action);
        const resolvedArtifactId = artifactId ?? (matchingAction && 'artifactId' in matchingAction
          ? matchingAction.artifactId
          : undefined);
        if (action !== 'repeat' && !resolvedArtifactId) {
          throw new Error(`The completed Book result has no ${action} artifact.`);
        }
        const actionRequestId = randomUUID();
        resultActionStatuses.delete(actionRequestId);
        handleBookMessage({
          type: 'fileOperationResultAction',
          requestId: current.requestId,
          actionRequestId,
          sessionId,
          documentId,
          action,
          ...(resolvedArtifactId ? { artifactId: resolvedArtifactId } : {}),
        });
        const deadline = Date.now() + 5_000;
        try {
          while (!resultActionStatuses.has(actionRequestId) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          const status = resultActionStatuses.get(actionRequestId);
          if (!status) throw new Error('Timed out waiting for the Book result action status.');
          return { ...status, actionRequestId };
        } finally {
          resultActionStatuses.delete(actionRequestId);
        }
      };
    }
  }

  private getActiveTestSession(): (typeof this.editorSessions extends Map<string, infer T> ? T : never) {
    const active = [...this.editorSessions.values()].find((session) => session.panel.active);
    if (active) return active;
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom) {
      const session = this.editorSessions.get(input.uri.toString());
      if (session) return session;
    }
    throw new Error('There is no active Structured Doc Book test session.');
  }

  private createDocumentLoader(
    bookDocument: vscode.TextDocument,
    capturedInputs?: BookIntegrityFile[],
  ): BookDocumentLoader {
    const projectDir = path.dirname(bookDocument.uri.fsPath);
    return {
      load: async (bookPath: string, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        const requestedPath = path.resolve(projectDir, bookPath);
        let canonicalRoot: string;
        let canonicalTarget: string;
        try {
          [canonicalRoot, canonicalTarget] = await Promise.all([
            fs.promises.realpath(projectDir),
            fs.promises.realpath(requestedPath),
          ]);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') throw new BookDocumentLoadError('not-found', bookPath);
          throw new BookDocumentLoadError('read-failed', error instanceof Error ? error.message : String(error));
        }
        signal?.throwIfAborted();
        const relative = path.relative(canonicalRoot, canonicalTarget);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new BookDocumentLoadError('read-failed', `Document resolves outside the book root: ${bookPath}`);
        }
        const openDocument = vscode.workspace.textDocuments.find(
          (candidate) => candidate.uri.scheme === 'file'
            && path.resolve(candidate.uri.fsPath).normalize('NFC').toLocaleLowerCase('en-US')
              === path.resolve(canonicalTarget).normalize('NFC').toLocaleLowerCase('en-US'),
        );
        if (openDocument) {
          const value = openDocument.getText();
          const byteLength = Buffer.byteLength(value, 'utf8');
          if (byteLength > BOOK_CHAPTER_MAX_BYTES) {
            throw new BookDocumentLoadError(
              'too-large',
              `${byteLength.toLocaleString('en-US')} bytes exceeds the ${BOOK_CHAPTER_MAX_BYTES.toLocaleString('en-US')} byte chapter limit`,
            );
          }
          capturedInputs?.push({
            kind: 'chapter', bookPath,
            canonicalPath: canonicalTarget,
            byteLength,
            contentHash: computeRevision(value),
            openBufferRevision: openDocument.version,
          });
          return { value, byteLength };
        }
        try {
          const stat = await fs.promises.stat(canonicalTarget);
          signal?.throwIfAborted();
          if (stat.size > BOOK_CHAPTER_MAX_BYTES) {
            throw new BookDocumentLoadError(
              'too-large',
              `${stat.size.toLocaleString('en-US')} bytes exceeds the ${BOOK_CHAPTER_MAX_BYTES.toLocaleString('en-US')} byte chapter limit`,
            );
          }
          const bytes = await fs.promises.readFile(canonicalTarget, { signal });
          signal?.throwIfAborted();
          if (bytes.byteLength > BOOK_CHAPTER_MAX_BYTES) {
            throw new BookDocumentLoadError(
              'too-large',
              `${bytes.byteLength.toLocaleString('en-US')} bytes exceeds the ${BOOK_CHAPTER_MAX_BYTES.toLocaleString('en-US')} byte chapter limit`,
            );
          }
          capturedInputs?.push({
            kind: 'chapter', bookPath,
            canonicalPath: canonicalTarget,
            byteLength: bytes.byteLength,
            contentHash: computeRevision(new TextDecoder().decode(bytes)),
          });
          return { value: new TextDecoder().decode(bytes), byteLength: bytes.byteLength };
        } catch (error) {
          if (error instanceof BookDocumentLoadError) throw error;
          if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            throw new BookDocumentLoadError('not-found', bookPath);
          }
          throw new BookDocumentLoadError(
            'read-failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    };
  }

  private async loadBook(document: vscode.TextDocument, signal?: AbortSignal): Promise<{
    book?: SdocBook;
    composition?: BookCompositionResult;
    diagnostics: BookDiagnostic[];
    chapterInputs: BookIntegrityFile[];
  }> {
    const chapterInputs: BookIntegrityFile[] = [];
    const parsed = parseBook(document.getText());
    if (!parsed.book) return { diagnostics: parsed.diagnostics, chapterInputs };
    const composition = await composeBook(
      parsed.book,
      this.createDocumentLoader(document, chapterInputs),
      parsed.diagnostics,
      signal,
    );
    return { book: parsed.book, composition, diagnostics: composition.diagnostics, chapterInputs };
  }

  private collectBookImagePaths(node: TiptapNode, paths = new Set<string>()): Set<string> {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      const src = node.attrs.src;
      if (!/^(?:data:|https?:)/i.test(src)) paths.add(src);
    }
    node.content?.forEach((child) => this.collectBookImagePaths(child, paths));
    return paths;
  }

  private async captureBookImageIntegrity(
    projectDir: string,
    documentNode: TiptapNode,
    signal?: AbortSignal,
  ): Promise<BookIntegrityFile[]> {
    const records: BookIntegrityFile[] = [];
    for (const bookPath of this.collectBookImagePaths(documentNode)) {
      signal?.throwIfAborted();
      const segments = parseContainedRelativeAssetPath(bookPath);
      const extension = path.extname(bookPath).toLocaleLowerCase('en-US');
      if (!segments
        || !segments.some((segment) => segment === 'images' || segment === 'drawio')
        || !MIME_MAP[extension.replace('.', '')]) {
        throw new Error(`Export blocked unsafe Book image path: ${bookPath}`);
      }
      const resolved = await resolveContainedRegularFile(projectDir, bookPath, {
        extension, maximumBytes: MAX_ASSET_BYTES,
      });
      const bytes = await fs.promises.readFile(resolved.canonicalPath, { signal });
      signal?.throwIfAborted();
      records.push({
        kind: 'image', bookPath,
        canonicalPath: resolved.canonicalPath,
        byteLength: bytes.byteLength,
        contentHash: computeRevision(bytes),
      });
    }
    return records;
  }

  private async createBookExportIntegritySnapshot(
    document: vscode.TextDocument,
    settingsFingerprint: string,
    chapterInputs: readonly BookIntegrityFile[],
    profileAssets: readonly BookIntegrityFile[],
  ): Promise<BookExportIntegritySnapshot> {
    const canonicalRoot = await fs.promises.realpath(path.dirname(document.uri.fsPath));
    const manifestCanonicalPath = await fs.promises.realpath(document.uri.fsPath);
    const files = Object.freeze([...chapterInputs, ...profileAssets]
      .map((entry) => Object.freeze({ ...entry }))
      .sort((left, right) => `${left.kind}:${left.bookPath}`.localeCompare(`${right.kind}:${right.bookPath}`)));
    const input = {
      canonicalRoot,
      manifestCanonicalPath,
      manifestRevision: document.version,
      manifestHash: computeRevision(document.getText()),
      settingsFingerprint,
      files,
    };
    return Object.freeze({
      ...input,
      fingerprint: fingerprintBookExportIntegrity(input),
    });
  }

  private async readCurrentBookIntegrityFingerprint(
    document: vscode.TextDocument,
    snapshot: BookExportIntegritySnapshot,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      signal?.throwIfAborted();
      const canonicalRoot = await fs.promises.realpath(path.dirname(document.uri.fsPath));
      const manifestCanonicalPath = await fs.promises.realpath(document.uri.fsPath);
      if (path.resolve(canonicalRoot) !== path.resolve(snapshot.canonicalRoot)
        || path.resolve(manifestCanonicalPath) !== path.resolve(snapshot.manifestCanonicalPath)
        || document.version !== snapshot.manifestRevision
        || computeRevision(document.getText()) !== snapshot.manifestHash) return 'stale:manifest';

      for (const record of snapshot.files) {
        signal?.throwIfAborted();
        const currentCanonicalPath = await fs.promises.realpath(path.resolve(canonicalRoot, record.bookPath));
        if (path.resolve(currentCanonicalPath) !== path.resolve(record.canonicalPath)) {
          return `stale:canonical:${record.kind}`;
        }
        let bytes: Uint8Array;
        if (record.kind === 'chapter') {
          const openDocument = vscode.workspace.textDocuments.find((candidate) =>
            candidate.uri.scheme === 'file'
            && path.resolve(candidate.uri.fsPath).normalize('NFC').toLocaleLowerCase('en-US')
              === path.resolve(currentCanonicalPath).normalize('NFC').toLocaleLowerCase('en-US'));
          if ((record.openBufferRevision === undefined) !== (openDocument === undefined)
            || (openDocument && openDocument.version !== record.openBufferRevision)) {
            return 'stale:chapter-buffer';
          }
          bytes = openDocument
            ? new TextEncoder().encode(openDocument.getText())
            : new Uint8Array(await fs.promises.readFile(currentCanonicalPath, { signal }));
        } else {
          const info = await fs.promises.stat(currentCanonicalPath);
          if (!info.isFile()) return `stale:file-type:${record.kind}`;
          bytes = new Uint8Array(await fs.promises.readFile(currentCanonicalPath, { signal }));
        }
        if (bytes.byteLength !== record.byteLength || computeRevision(bytes) !== record.contentHash) {
          return `stale:content:${record.kind}`;
        }
      }
      return snapshot.fingerprint;
    } catch (error) {
      signal?.throwIfAborted();
      return `stale:unavailable:${error instanceof Error ? error.name : 'unknown'}`;
    }
  }

  private async updateProjectFile(
    document: vscode.TextDocument,
    project: SdocBook,
    baseRevision: number,
  ): Promise<void> {
    if (document.version !== baseRevision) {
      throw new BookMutationError(
        'stale-revision',
        `The book changed before the edit could be applied (expected revision ${baseRevision}, current revision ${document.version}).`,
      );
    }
    const edit = new vscode.WorkspaceEdit();
    const serialized = serializeBookManifestForMutation(project);
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      serialized,
    );
    const applied = await vscode.workspace.applyEdit(edit);
    assertBookEditApplied(applied);
  }

  private toBookPreviewDocument(
    node: TiptapNode,
    webview: vscode.Webview,
    projectDir: string,
  ): TiptapNode {
    let attrs = node.attrs ? { ...node.attrs } : undefined;
    if (node.type === 'image' && typeof attrs?.src === 'string') {
      if (/^https?:/i.test(attrs.src)) {
        const { src: _remoteSource, ...safeAttrs } = attrs;
        attrs = safeAttrs;
      } else if (!attrs.src.startsWith('data:')) {
        const absolute = path.resolve(projectDir, attrs.src);
        const relative = path.relative(projectDir, absolute);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          const { src: _outsideSource, ...safeAttrs } = attrs;
          attrs = safeAttrs;
        } else {
          attrs.src = webview.asWebviewUri(vscode.Uri.file(absolute)).toString();
        }
      }
    }
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(node.content ? {
        content: node.content.map((child) => this.toBookPreviewDocument(child, webview, projectDir)),
      } : {}),
    };
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = getWebviewUri(webview, this.context.extensionUri, [
      'dist', 'webview', 'assets', 'book.js',
    ]);
    const styleUri = getWebviewUri(webview, this.context.extensionUri, [
      'dist', 'webview', 'assets', 'book.css',
    ]);
    const fontFaces = generateFontFaceCSS(webview, this.context.extensionUri);
    const nonce = getNonce();
    const locale = this.getBookUiLocale();
    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <style>${fontFaces}</style>
  <link href="${styleUri}" rel="stylesheet">
  <title>Sdoc Book Editor</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getBookUiLocale(): EditorLocale {
    const configuration = vscode.workspace.getConfiguration('structuredDocEditor.ui');
    const preference = readUiLanguagePreference(configuration.inspect<unknown>('language')?.globalValue);
    return resolveUiLanguagePreference(preference, vscode.env.language);
  }

  private getBookUiStrings(): BookUiStrings {
    const configuration = vscode.workspace.getConfiguration('structuredDocEditor.ui');
    const preference = readUiLanguagePreference(configuration.inspect<unknown>('language')?.globalValue);
    return BOOK_UI_STRINGS[resolveUiLanguagePreference(preference, vscode.env.language)];
  }
}
