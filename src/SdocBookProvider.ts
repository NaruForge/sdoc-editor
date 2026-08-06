import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { convertJsonToHtml } from '../shared/converter';
import { detectBrowser, printToPdf } from './utils/browserDetect';
import { loadBundledFontsAsBase64 } from './utils/fontUtils';
import { embedImagesAsBase64 } from './utils/imageUtils';
import { resolveCompanyLogo, readFontWeights, buildHtmlTheme, readExportSettings } from './utils/themeUtils';
import { withTemporaryDirectory } from './utils/temporaryDirectory';
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
import { RecoverableSerialQueue } from '../shared/persistence/RecoverableSerialQueue';
import {
  readUiLanguagePreference,
  resolveUiLanguagePreference,
  type EditorLocale,
} from '../shared/editor/i18n/locale';
import {
  applyBookManifestMutation,
  assertBookEditApplied,
  BookDocumentLoadError,
  BookMutationError,
  BOOK_CHAPTER_MAX_BYTES,
  composeBook,
  diagnosticsForDocument,
  extractBookRootBody,
  hasBookErrors,
  isBookWebviewMessage,
  normalizeBookDocumentPath,
  parseBook,
  prepareBookMutationSnapshot,
  serializeBookManifestForMutation,
  type BookCompositionResult,
  type BookDiagnostic,
  type BookDocumentLoader,
  type BookMutationResult,
  type BookWebviewMessage,
  type ResolvedBookDocument,
  type SdocBook,
} from '../shared/book';

type BookMutatingWebviewMessage = Extract<BookWebviewMessage, { requestId: string }>;

interface BookUiStrings {
  language: string;
  untitledProject: string;
  title: string;
  author: string;
  version: string;
  bookValid: string;
  bookValidation: string;
  validationCounts(errors: number, warnings: number): string;
  addDocument: string;
  validateBook: string;
  exportHtml: string;
  exportPdf: string;
  noDocuments: string;
  documentList: string;
  bookActions: string;
  openDocument(label: string): string;
  moveUp(label: string): string;
  moveDown(label: string): string;
  removeDocument(label: string): string;
  removeConfirmation(label: string): string;
  removeConfirmationDetail(bookPath: string): string;
  removeAction: string;
  notFound: string;
  invalid: string;
  mutationApplied: string;
  mutationCancelled: string;
  error: string;
}

const BOOK_UI_STRINGS: Readonly<Record<EditorLocale, BookUiStrings>> = {
  en: {
    language: 'en',
    untitledProject: 'Untitled book',
    title: 'Title',
    author: 'Author',
    version: 'Version',
    bookValid: 'Book is valid',
    bookValidation: 'Book validation',
    validationCounts: (errors, warnings) => `${errors} errors · ${warnings} warnings`,
    addDocument: 'Add document',
    validateBook: 'Validate book',
    exportHtml: 'Export HTML',
    exportPdf: 'Export PDF',
    noDocuments: 'No documents are in the manifest. Add a document to start.',
    documentList: 'Documents in manifest order',
    bookActions: 'Book actions',
    openDocument: (label) => `Open ${label}`,
    moveUp: (label) => `Move ${label} up`,
    moveDown: (label) => `Move ${label} down`,
    removeDocument: (label) => `Remove ${label} from manifest`,
    removeConfirmation: (label) => `Remove “${label}” from the book manifest?`,
    removeConfirmationDetail: (bookPath) => `This removes ${bookPath} from the manifest only. The .sdoc file will not be deleted.`,
    removeAction: 'Remove from Manifest',
    notFound: 'not found',
    invalid: 'invalid',
    mutationApplied: 'Book manifest updated.',
    mutationCancelled: 'Book manifest change cancelled.',
    error: 'Error',
  },
  ko: {
    language: 'ko',
    untitledProject: '제목 없는 책',
    title: '제목',
    author: '작성자',
    version: '버전',
    bookValid: '책이 유효합니다',
    bookValidation: '책 유효성 검사',
    validationCounts: (errors, warnings) => `오류 ${errors}개 · 경고 ${warnings}개`,
    addDocument: '문서 추가',
    validateBook: '책 검사',
    exportHtml: 'HTML 내보내기',
    exportPdf: 'PDF 내보내기',
    noDocuments: '매니페스트에 문서가 없습니다. 문서를 추가하여 시작하세요.',
    documentList: '매니페스트 문서 순서',
    bookActions: '책 작업',
    openDocument: (label) => `${label} 열기`,
    moveUp: (label) => `${label} 위로 이동`,
    moveDown: (label) => `${label} 아래로 이동`,
    removeDocument: (label) => `${label} 매니페스트에서 제거`,
    removeConfirmation: (label) => `“${label}” 문서를 책 매니페스트에서 제거할까요?`,
    removeConfirmationDetail: (bookPath) => `${bookPath} 항목만 매니페스트에서 제거합니다. .sdoc 파일은 삭제하지 않습니다.`,
    removeAction: '매니페스트에서 제거',
    notFound: '찾을 수 없음',
    invalid: '유효하지 않음',
    mutationApplied: '책 매니페스트를 업데이트했습니다.',
    mutationCancelled: '책 매니페스트 변경을 취소했습니다.',
    error: '오류',
  },
};

export class SdocBookProvider implements vscode.CustomTextEditorProvider {
  private static readonly VIEW_TYPE = 'structuredDocEditor.sdocBook';

  constructor(private readonly context: vscode.ExtensionContext) {}

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
    return vscode.window.registerCustomEditorProvider(
      SdocBookProvider.VIEW_TYPE,
      new SdocBookProvider(context),
      { supportsMultipleEditorsPerDocument: false }
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
    };

    let updateSequence = 0;
    let disposed = false;
    let shellInitialized = false;
    let updateTimer: NodeJS.Timeout | undefined;
    let activeLoad: AbortController | undefined;
    let activeExport: AbortController | undefined;
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
    };
    const updateWebview = async (): Promise<void> => {
      const sequence = ++updateSequence;
      activeLoad?.abort(new Error('Book composition superseded.'));
      const controller = new AbortController();
      activeLoad = controller;
      let result: {
        book?: SdocBook;
        composition?: BookCompositionResult;
        diagnostics: BookDiagnostic[];
      };
      try {
        result = await this.loadBook(document, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        throw error;
      }
      if (disposed || sequence !== updateSequence) return;
      if (!result.book) {
        webviewPanel.webview.html = this.getErrorHtml(
          webviewPanel.webview,
          result.diagnostics[0]?.message ?? 'Invalid .sdocbook file',
        );
        shellInitialized = false;
        return;
      }
      replaceIncludeWatchers(result.book);
      const docs = result.composition?.documents ?? result.book.documents.map((entry) => ({
        path: entry.path,
        label: entry.label || path.basename(entry.path, '.sdoc'),
        status: 'invalid' as const,
      }));
      const nextHtml = this.getHtml(
        webviewPanel.webview,
        result.book,
        docs,
        result.diagnostics,
        document.version,
      );
      if (!shellInitialized) {
        webviewPanel.webview.html = nextHtml;
        shellInitialized = true;
      } else {
        await webviewPanel.webview.postMessage({
          type: 'bookState',
          generation: sequence,
          revision: document.version,
          body: extractBookRootBody(nextHtml),
        });
      }
    };

    const scheduleUpdate = (immediate = false): void => {
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

    const projectDir = path.dirname(document.uri.fsPath);
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
      activeExport?.abort(new Error('Book editor disposed.'));
      if (updateTimer) clearTimeout(updateTimer);
      changeSubscription.dispose();
      configurationSubscription.dispose();
      includeWatchers.forEach((item) => item.dispose());
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

    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isBookWebviewMessage(message)) return;
      switch (message.type) {
        case 'openDocument': {
          const parsed = parseBook(document.getText());
          const target = parsed.book?.documents[message.index];
          if (!target) break;
          void resolveContainedRegularFile(projectDir, target.path, {
            extension: '.sdoc',
            maximumBytes: BOOK_CHAPTER_MAX_BYTES,
          }).then(
            ({ canonicalPath }) => vscode.commands.executeCommand(
              'vscode.open',
              vscode.Uri.file(canonicalPath),
            ),
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
        case 'exportProject': {
          activeExport?.abort(new Error('Book export superseded.'));
          const controller = new AbortController();
          activeExport = controller;
          void this.exportProject(document, message.format, controller.signal).catch((error: unknown) => {
            if (!controller.signal.aborted) {
              void vscode.window.showErrorMessage(`Book export failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }).finally(() => {
            if (activeExport === controller) activeExport = undefined;
          });
          break;
        }
        case 'refreshBook':
          scheduleUpdate(true);
          break;
      }
    });
  }

  private createDocumentLoader(bookDocument: vscode.TextDocument): BookDocumentLoader {
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
        const uri = vscode.Uri.file(canonicalTarget);
        const openDocument = vscode.workspace.textDocuments.find(
          (candidate) => candidate.uri.toString() === uri.toString(),
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
  }> {
    const parsed = parseBook(document.getText());
    if (!parsed.book) return { diagnostics: parsed.diagnostics };
    const composition = await composeBook(
      parsed.book,
      this.createDocumentLoader(document),
      parsed.diagnostics,
      signal,
    );
    return { book: parsed.book, composition, diagnostics: composition.diagnostics };
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

  async exportProject(
    document: vscode.TextDocument,
    format: 'html' | 'pdf',
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const result = await this.loadBook(document, signal);
    signal?.throwIfAborted();
    if (!result.book || !result.composition || hasBookErrors(result.diagnostics)) {
      const errors = result.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .slice(0, 3)
        .map((diagnostic) => diagnostic.message)
        .join('\n');
      vscode.window.showErrorMessage(`Book export blocked until errors are fixed.${errors ? `\n${errors}` : ''}`);
      return;
    }
    const projectDir = path.dirname(document.uri.fsPath);
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const diagramService = new KrokiDiagramService(this.readDiagramRendererSettings());
    const diagramPreparation = await prepareExportDiagrams(
      result.composition.documents.flatMap((chapter) => chapter.status === 'ok' && chapter.doc
        ? [{ kind: 'chapter' as const, scopeId: chapter.path, document: chapter.doc }]
        : []),
      {
        signal,
        render: async ({ language, source, signal: renderSignal }) => {
          const rendered = await diagramService.render(language, source, { signal: renderSignal });
          return { dataUrl: rendered.dataUrl };
        },
      },
    );
    signal?.throwIfAborted();

    // Embed images
    const selfContained = config.get<string>('export.selfContained', 'images-only');
    let finalDoc = result.composition.doc;
    if (selfContained !== 'none') {
      finalDoc = await embedImagesAsBase64(finalDoc, projectDir, signal);
      signal?.throwIfAborted();
    }

    // Build theme
    const companyLogo = await resolveCompanyLogo(
      config.get<string>('theme.companyLogo') || '',
      this.context.extensionPath,
    );
    signal?.throwIfAborted();
    const fontWeights = readFontWeights(config);
    const usedWeights = new Set(Object.values(fontWeights));
    const embeddedFonts = await loadBundledFontsAsBase64(this.context.extensionUri, usedWeights);
    signal?.throwIfAborted();
    const theme = buildHtmlTheme(config, companyLogo, fontWeights, embeddedFonts);

    const exportSettings: Record<string, unknown> = {
      ...readExportSettings(config),
      selfContained,
      counterResetPaths: result.composition.counterResetPaths,
    };
    if (selfContained === 'full') {
      exportSettings.embeddedAssets = await loadBundledExportAssets(this.context.extensionPath);
      signal?.throwIfAborted();
    }

    let htmlContent = convertJsonToHtml(
      finalDoc,
      theme,
      exportSettings,
      result.composition.meta,
      { resolveDiagramImage: diagramPreparation.resolveDiagramImage },
    );

    if (format === 'pdf') {
      const browserPath = detectBrowser();
      if (!browserPath) {
        vscode.window.showErrorMessage('Chrome, Edge, or Chromium is required for PDF export.');
        return;
      }

      const pdfScale = config.get<number>('export.pdfScale', 70) / 100;
      htmlContent = htmlContent.replace('</head>', `<style>body{zoom:${pdfScale};}</style>\n</head>`);

      const pdfPath = document.uri.fsPath.replace(/\.sdocbook$/, '.pdf');
      await withTemporaryDirectory('sdocbook-pdf-', async (tempDir) => {
        signal?.throwIfAborted();
        const tempHtmlPath = path.join(tempDir, 'document.html');
        const tempPdfPath = path.join(tempDir, 'document.pdf');
        await fs.promises.writeFile(tempHtmlPath, htmlContent, 'utf-8');
        signal?.throwIfAborted();
        await printToPdf(browserPath, tempHtmlPath, tempPdfPath, signal);
        signal?.throwIfAborted();
        await this.writeExportFile(
          pdfPath,
          new Uint8Array(await fs.promises.readFile(tempPdfPath, { signal })),
          signal,
        );
      });
      const action = await vscode.window.showInformationMessage(
        `Project PDF exported: ${pdfPath}`,
        'Open PDF'
      );
      if (action === 'Open PDF') {
        await vscode.env.openExternal(vscode.Uri.file(pdfPath));
      }
    } else {
      const htmlPath = document.uri.fsPath.replace(/\.sdocbook$/, '.html');
      signal?.throwIfAborted();
      await this.writeExportFile(htmlPath, new TextEncoder().encode(htmlContent), signal);

      const action = await vscode.window.showInformationMessage(
        `Project HTML exported: ${htmlPath}`,
        'Open HTML'
      );
      if (action === 'Open HTML') {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(htmlPath));
      }
    }
    if (diagramPreparation.status === 'fallback') {
      void vscode.window.showWarningMessage(
        `${diagramPreparation.fallbackOccurrenceCount} diagram occurrence(s) in ${diagramPreparation.fallbackChapterCount} chapter(s) were exported as source because rendering was unavailable.`,
      );
    }
  }

  private async writeExportFile(
    outputPath: string,
    content: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    const stagingPath = `${outputPath}.sdoc-export-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    signal?.throwIfAborted();
    try {
      await fs.promises.writeFile(stagingPath, content, { signal });
      signal?.throwIfAborted();
      await vscode.workspace.fs.rename(
        vscode.Uri.file(stagingPath),
        vscode.Uri.file(outputPath),
        { overwrite: true },
      );
    } finally {
      try {
        await fs.promises.unlink(stagingPath);
      } catch {
        // Best-effort cleanup cannot invalidate an already committed export.
      }
    }
  }

  private getHtml(
    webview: vscode.Webview,
    project: SdocBook,
    docs: ResolvedBookDocument[],
    diagnostics: BookDiagnostic[],
    revision: number,
  ): string {
    const strings = this.getBookUiStrings();
    const nonce = randomBytes(16).toString('base64');
    const assetRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets');
    const pretendardUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'PretendardVariable.woff2'));
    const jetBrainsMonoUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'JetBrainsMono-Variable.woff2'));
    const jetBrainsMonoItalicUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'JetBrainsMono-VariableItalic.woff2'));
    const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
    const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
    const exportDisabled = errorCount > 0 ? ' disabled' : '';
    const docRows = docs.map((d, i) => `
      <li class="doc-row ${d.status}">
        <span class="doc-num">${i + 1}</span>
        <button type="button" id="book-open-${i}" class="doc-label" data-open-index="${i}" title="${this.escHtml(d.path)}" aria-label="${this.escHtml(strings.openDocument(d.label))}">${this.escHtml(d.label)}</button>
        <span class="doc-path">${this.escHtml(d.path)}</span>
        ${d.status === 'missing' ? `<span class="doc-status error">${strings.notFound}</span>` : ''}
        ${d.status === 'invalid' ? `<span class="doc-status error">${strings.invalid}</span>` : ''}
        ${diagnosticsForDocument(diagnostics, d.path)
          .filter((item) => item.code !== 'DOCUMENT_MISSING' && item.code !== 'DOCUMENT_INVALID')
          .map((item) => `<span class="doc-status ${item.severity}" title="${this.escHtml(item.message)}">${this.escHtml(item.code)}</span>`)
          .join('')}
        <span class="doc-actions">
          ${i > 0 ? `<button type="button" id="book-move-up-${i}" data-book-mutation data-move-from="${i}" data-move-to="${i - 1}" title="${this.escHtml(strings.moveUp(d.label))}" aria-label="${this.escHtml(strings.moveUp(d.label))}">↑</button>` : ''}
          ${i < docs.length - 1 ? `<button type="button" id="book-move-down-${i}" data-book-mutation data-move-from="${i}" data-move-to="${i + 1}" title="${this.escHtml(strings.moveDown(d.label))}" aria-label="${this.escHtml(strings.moveDown(d.label))}">↓</button>` : ''}
          <button type="button" id="book-remove-${i}" data-book-mutation data-remove-index="${i}" title="${this.escHtml(strings.removeDocument(d.label))}" aria-label="${this.escHtml(strings.removeDocument(d.label))}">✕</button>
        </span>
      </li>
    `).join('');

    const diagnosticRows = diagnostics.map((item) => `
      <li class="diagnostic ${item.severity}">
        <span class="diagnostic-code">${this.escHtml(item.code)}</span>
        <span>${this.escHtml(item.message)}</span>
      </li>
    `).join('');

    return `<!DOCTYPE html>
<html lang="${strings.language}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  @font-face { font-family: 'Pretendard Variable'; src: url('${pretendardUri}') format('woff2-variations'); font-style: normal; font-weight: 45 920; font-display: swap; }
  @font-face { font-family: 'JetBrains Mono'; src: url('${jetBrainsMonoUri}') format('woff2-variations'); font-style: normal; font-weight: 100 800; font-display: swap; }
  @font-face { font-family: 'JetBrains Mono'; src: url('${jetBrainsMonoItalicUri}') format('woff2-variations'); font-style: italic; font-weight: 100 800; font-display: swap; }
  :root { --sdoc-font-sans: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif; --sdoc-font-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace; }
  body { font-family: var(--sdoc-font-sans); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; max-width: 800px; margin: 0 auto; }
  button, input { font-family: inherit; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  h1 { font-size: 1.5em; margin-bottom: 8px; }
  .meta { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .meta label { font-size: 12px; color: var(--vscode-descriptionForeground); display: block; margin-bottom: 2px; }
  .meta input { padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); border-radius: 3px; font-size: 13px; width: 200px; }
  .meta input.version { width: 80px; }
  .toolbar { margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
  .toolbar button { padding: 6px 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 13px; }
  .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
  .toolbar button:disabled { cursor: not-allowed; opacity: 0.45; }
  .toolbar button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .doc-list { list-style: none; margin: 0; padding: 0; }
  .doc-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
  .doc-row:hover { background: var(--vscode-list-hoverBackground); }
  .doc-row.missing, .doc-row.invalid { background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.08)); }
  .doc-num { width: 24px; text-align: right; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .doc-label { cursor: pointer; color: var(--vscode-textLink-foreground); flex: 1; border: 0; background: transparent; padding: 0; text-align: left; font: inherit; }
  .doc-label:hover { text-decoration: underline; }
  .doc-path { color: var(--vscode-descriptionForeground); font-size: 12px; font-family: var(--sdoc-font-mono); font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'calt' 0; }
  .doc-status { border-radius: 10px; padding: 1px 6px; font-size: 10px; }
  .doc-status.error { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); }
  .doc-status.warning { color: var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); }
  .doc-actions button { background: none; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 4px; font-size: 14px; opacity: 0.6; }
  .doc-actions button:hover { opacity: 1; }
  .doc-actions button:disabled { cursor: not-allowed; opacity: 0.4; }
  .validation-summary { border: 1px solid var(--vscode-panel-border, #444); border-radius: 5px; padding: 10px 12px; margin-bottom: 14px; }
  .validation-summary.ok { border-color: var(--vscode-testing-iconPassed, #73c991); }
  .validation-title { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
  .validation-counts { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .diagnostics { margin: 8px 0 0; padding-left: 20px; font-size: 12px; }
  .diagnostic { margin: 4px 0; }
  .diagnostic.error { color: var(--vscode-errorForeground); }
  .diagnostic.warning { color: var(--vscode-editorWarning-foreground); }
  .diagnostic-code { font-family: var(--sdoc-font-mono); font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'calt' 0; margin-right: 8px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px; text-align: center; }
  @media (max-width: 560px) { body { padding: 12px; } .doc-row { align-items: flex-start; flex-wrap: wrap; } .doc-path { width: calc(100% - 40px); overflow-wrap: anywhere; } .doc-actions { margin-left: auto; } }
</style></head><body><div id="book-root" role="main" aria-labelledby="book-heading" aria-busy="false">
  <h1 id="book-heading">${this.escHtml(project.title || strings.untitledProject)}</h1>
  <div class="meta">
    <div><label for="book-meta-title">${strings.title}</label><input id="book-meta-title" data-book-mutation data-meta-key="title" value="${this.escHtml(project.title || '')}"></div>
    <div><label for="book-meta-author">${strings.author}</label><input id="book-meta-author" data-book-mutation data-meta-key="author" value="${this.escHtml(project.author || '')}"></div>
    <div><label for="book-meta-version">${strings.version}</label><input id="book-meta-version" class="version" data-book-mutation data-meta-key="version" value="${this.escHtml(project.version || '')}"></div>
  </div>
  <section class="validation-summary${diagnostics.length === 0 ? ' ok' : ''}" aria-labelledby="book-validation-heading">
    <div class="validation-title">
      <span id="book-validation-heading">${diagnostics.length === 0 ? strings.bookValid : strings.bookValidation}</span>
      <span class="validation-counts">${strings.validationCounts(errorCount, warningCount)}</span>
    </div>
    ${diagnosticRows ? `<ul class="diagnostics">${diagnosticRows}</ul>` : ''}
  </section>
  <div class="toolbar" role="toolbar" aria-label="${strings.bookActions}">
    <button type="button" data-book-mutation data-action="add">+ ${strings.addDocument}</button>
    <button type="button" class="secondary" data-action="refresh">${strings.validateBook}</button>
    <button type="button" class="secondary" data-export="html"${exportDisabled}>${strings.exportHtml}</button>
    <button type="button" class="secondary" data-export="pdf"${exportDisabled}>${strings.exportPdf}</button>
  </div>
  ${docs.length > 0 ? `<ol class="doc-list" aria-label="${strings.documentList}">${docRows}</ol>` : `<div class="empty">${strings.noDocuments}</div>`}
  <p id="book-operation-status" class="sr-only" role="status" aria-live="polite"></p>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let latestGeneration = 0;
  let latestRevision = ${revision};
  let pendingRequestId;
  let requestSequence = 0;
  const nextRequestId = () => 'book-' + Date.now().toString(36) + '-' + (++requestSequence).toString(36);
  const announce = (message) => {
    const status = document.getElementById('book-operation-status');
    if (status) status.textContent = message;
  };
  const applyPendingState = () => {
    const root = document.getElementById('book-root');
    if (root) root.setAttribute('aria-busy', pendingRequestId ? 'true' : 'false');
    document.querySelectorAll('[data-book-mutation]').forEach((element) => {
      if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
        element.disabled = Boolean(pendingRequestId);
      }
    });
  };
  const postMutation = (message) => {
    if (pendingRequestId) return;
    pendingRequestId = nextRequestId();
    applyPendingState();
    vscode.postMessage({ ...message, requestId: pendingRequestId, baseRevision: latestRevision });
  };
  const bindBookUi = () => {
  document.querySelector('[data-action="add"]')?.addEventListener('click', () => postMutation({ type: 'addDocument' }));
  document.querySelector('[data-action="refresh"]')?.addEventListener('click', () => vscode.postMessage({ type: 'refreshBook' }));
  document.querySelectorAll('[data-open-index]').forEach((element) => element.addEventListener('click', () => {
    vscode.postMessage({ type: 'openDocument', index: Number(element.dataset.openIndex) });
  }));
  document.querySelectorAll('[data-remove-index]').forEach((element) => element.addEventListener('click', () => {
    postMutation({ type: 'removeDocument', index: Number(element.dataset.removeIndex) });
  }));
  document.querySelectorAll('[data-move-from]').forEach((element) => element.addEventListener('click', () => {
    postMutation({ type: 'moveDocument', from: Number(element.dataset.moveFrom), to: Number(element.dataset.moveTo) });
  }));
  document.querySelectorAll('[data-meta-key]').forEach((element) => element.addEventListener('change', () => {
    postMutation({ type: 'updateMeta', key: element.dataset.metaKey, value: element.value });
  }));
  document.querySelectorAll('[data-export]').forEach((element) => element.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportProject', format: element.dataset.export });
  }));
  };
  bindBookUi();
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'bookMutationResult') {
      if (message.requestId !== pendingRequestId || !Number.isInteger(message.revision)) return;
      latestRevision = message.revision;
      pendingRequestId = undefined;
      applyPendingState();
      if (message.status === 'applied') announce(${JSON.stringify(strings.mutationApplied)});
      else if (message.status === 'cancelled') announce(${JSON.stringify(strings.mutationCancelled)});
      else announce(message.error?.message || ${JSON.stringify(strings.error)});
      if (message.status === 'rejected' && message.error?.code === 'stale-revision') {
        vscode.postMessage({ type: 'refreshBook' });
      }
      return;
    }
    if (message?.type !== 'bookState' || message.generation <= latestGeneration || !Number.isInteger(message.revision) || typeof message.body !== 'string') return;
    latestGeneration = message.generation;
    latestRevision = message.revision;
    const root = document.getElementById('book-root');
    if (!root) return;
    const active = document.activeElement;
    const activeId = active instanceof HTMLElement ? active.id : undefined;
    const editingKey = active instanceof HTMLInputElement ? active.dataset.metaKey : undefined;
    const editingValue = active instanceof HTMLInputElement ? active.value : undefined;
    const selectionStart = active instanceof HTMLInputElement ? active.selectionStart : null;
    const selectionEnd = active instanceof HTMLInputElement ? active.selectionEnd : null;
    root.innerHTML = message.body;
    bindBookUi();
    applyPendingState();
    if (editingKey) {
      const replacement = root.querySelector('[data-meta-key="' + editingKey + '"]');
      if (replacement instanceof HTMLInputElement && editingValue !== undefined) {
        replacement.value = editingValue;
        replacement.focus();
        if (selectionStart !== null && selectionEnd !== null) replacement.setSelectionRange(selectionStart, selectionEnd);
      }
    } else if (activeId) {
      document.getElementById(activeId)?.focus();
    }
  });
</script>
</body></html>`;
  }

  private getBookUiStrings(): BookUiStrings {
    const configuration = vscode.workspace.getConfiguration('structuredDocEditor.ui');
    const preference = readUiLanguagePreference(configuration.inspect<unknown>('language')?.globalValue);
    return BOOK_UI_STRINGS[resolveUiLanguagePreference(preference, vscode.env.language)];
  }

  private getErrorHtml(webview: vscode.Webview, msg: string): string {
    const strings = this.getBookUiStrings();
    const nonce = randomBytes(16).toString('base64');
    const fontUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this.context.extensionUri,
      'dist',
      'webview',
      'assets',
      'PretendardVariable.woff2',
    ));
    return `<!DOCTYPE html><html lang="${strings.language}"><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">@font-face { font-family: 'Pretendard Variable'; src: url('${fontUri}') format('woff2-variations'); font-style: normal; font-weight: 45 920; font-display: swap; } body { font-family: 'Pretendard Variable', Pretendard, system-ui, 'Segoe UI', 'Malgun Gothic', sans-serif; color: var(--vscode-foreground); background: var(--vscode-editor-background); }</style>
</head><body><h2>${strings.error}</h2><p>${this.escHtml(msg)}</p></body></html>`;
  }

  private escHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
