import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { convertMarkdownToJson } from '../shared/converter';
import { generateFontFaceCSS } from './utils/fontUtils';
import { convertImagePathsToWebviewUris, convertWebviewUrisToRelativePaths } from './utils/imageUtils';
import {
  unwrapSdoc as sharedUnwrapSdoc,
  wrapSdoc as sharedWrapSdoc,
  normalizeDocument,
} from '../shared/document/sdocUtils';
import {
  getCaptionPreset,
  resolveEditorSettings,
  resolveSettings,
  SETTINGS_DEFAULTS,
} from '../shared/settingsResolver';
import type { DocumentSettings, CaptionStyleName, SdocMeta, TiptapNode } from '../shared/types';
import { isEditorToHostMessage } from '../shared/types/messageGuards';
import { VsCodeAssetService } from './services/VsCodeAssetService';
import { VsCodeExportService, type ExportFormat } from './services/VsCodeExportService';
import { RecoverableSerialQueue } from '../shared/persistence/RecoverableSerialQueue';
import { assertPersistedDocument, parseDocumentContract, readDocumentSettings, validateDocumentSettings } from '../shared/document/documentContract';
import { dehydrateDocumentAssets } from '../shared/document/runtimeAssets';
import { runExportAfterFlush } from '../shared/export/runExportAfterFlush';
import {
  canInitializeEmptyDocument,
  commitEmptyDocumentInitialization,
  isFilesystemBackedScheme,
  isUninitializedSdocText,
  isWorkspaceTemplatePath,
  prepareEmptyDocumentInitialization,
  validateDocumentTitle,
  VsCodeTemplateService,
  type EmptyDocumentIdentity,
  type WorkspaceTemplateRoot,
} from './services/VsCodeTemplateService';

export class SdocEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly SDOC_VERSION = '1.0';
  private static watcherGeneration = 0;
  private static instance: SdocEditorProvider | undefined;
  private readonly assetService = new VsCodeAssetService();
  private readonly exportService: VsCodeExportService;

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
    return providerRegistration;
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
  private pendingAppliedTexts = new Map<string, string[]>();
  private pendingFlushResolvers = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly editorSessions = new Map<string, {
    document: vscode.TextDocument;
    panel: vscode.WebviewPanel;
    sessionId: string;
  }>();
  constructor(private readonly context: vscode.ExtensionContext) {
    this.exportService = new VsCodeExportService(context);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
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
    this.editorSessions.set(documentId, { document, panel: webviewPanel, sessionId });
    let writeBlockedReason: string | undefined;
    let readOnlyWarningShown = false;
    let initializationRequired = isUninitializedSdocText(document.getText());
    let initializationRequestPending = false;

    // Read and send editor settings to webview
    const readVscodeDocDefaults = (): Partial<DocumentSettings> => {
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      return {
        headingNumbering: config.get<boolean>('heading.numbering', true),
        headingDecoration: config.get<boolean>('heading.decoration', true),
        headingH1Color: config.get<string>('heading.h1Color', SETTINGS_DEFAULTS.headingH1Color),
        headingH2Color: config.get<string>('heading.h2Color', SETTINGS_DEFAULTS.headingH2Color),
        headingH3Color: config.get<string>('heading.h3Color', SETTINGS_DEFAULTS.headingH3Color),
        headingH4Color: config.get<string>('heading.h4Color', SETTINGS_DEFAULTS.headingH4Color),
        headingH5Color: config.get<string>('heading.h5Color', SETTINGS_DEFAULTS.headingH5Color),
        headingH6Color: config.get<string>('heading.h6Color', SETTINGS_DEFAULTS.headingH6Color),
        captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
        captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
        equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
        crossRefIncludeCaption: config.get<boolean>('caption.crossRefIncludeCaption', false),
        pdfScale: config.get<number>('export.pdfScale', 70),
        selfContained: config.get<'none' | 'images-only' | 'full'>('export.selfContained', 'images-only'),
        slideBreakLevel: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
        slideTransition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
        showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
        outputDir: config.get<string>('export.outputDir', ''),
      };
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
      const vscodeDefaults = readVscodeDocDefaults();
      const docSettings = readDocSettings();
      const resolved = resolveEditorSettings(docSettings, vscodeDefaults, {
        defaultImageAlignment: config.get<'left' | 'center' | 'right'>('image.defaultAlignment', 'center'),
        exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
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
          fontWeightBody: config.get<string>('font.body', 'Regular'),
          fontWeightBold: config.get<string>('font.bold', 'Bold'),
          fontWeightH1: config.get<string>('font.h1', 'Bold'),
          fontWeightH2: config.get<string>('font.h2', 'SemiBold'),
          fontWeightH3: config.get<string>('font.h3', 'SemiBold'),
        },
      });
      // Also send raw doc-level settings so the Settings Panel knows what's overridden
      webviewPanel.webview.postMessage({
        type: 'docSettingsChanged',
        docSettings: docSettings || null,
      });
    };

    // Send initial document content with image paths converted
    const sendUpdate = () => {
      try {
        const text = document.getText();
        initializationRequired = isUninitializedSdocText(text);
        const parsed: unknown = initializationRequired
          ? { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } }
          : JSON.parse(text);
        const contract = parseDocumentContract(parsed);
        writeBlockedReason = contract.ok
          ? undefined
          : contract.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; ');
        if (writeBlockedReason && !readOnlyWarningShown) {
          readOnlyWarningShown = true;
          vscode.window.showWarningMessage(
            `Structured Doc opened read-only to protect the original file: ${writeBlockedReason}`,
          );
        }
        // Unwrap sdoc envelope → extract doc node
        const { doc, meta } = sharedUnwrapSdoc(parsed);
        // Convert image paths to webview URIs
        const convertedJson = convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);
        webviewPanel.webview.postMessage({
          type: 'init',
          sessionId,
          documentId,
          revision: document.version,
          ...(writeBlockedReason ? { readOnlyReason: writeBlockedReason } : {}),
          ...(initializationRequired ? { initializationRequired: true } : {}),
          content: convertedJson,
        });
        // Send metadata and settings
        webviewPanel.webview.postMessage({ type: 'metaUpdate', meta });
        sendSettings();
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to parse document: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    };

    const postAuthoritativeUpdate = (): void => {
      const parsed: unknown = JSON.parse(document.getText());
      const { doc } = sharedUnwrapSdoc(parsed);
      webviewPanel.webview.postMessage({
        type: 'update', sessionId, documentId, revision: document.version,
        content: convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview),
      });
    };

    const currentInitializationIdentity = (): EmptyDocumentIdentity => ({
      sessionId,
      documentId,
      revision: document.version,
    });

    const initializeEmptyDocument = async (
      mode: 'blank' | 'template',
      expected: EmptyDocumentIdentity,
    ): Promise<void> => {
      if (!canInitializeEmptyDocument(
        document.getText(),
        expected,
        currentInitializationIdentity(),
      )) {
        await vscode.window.showWarningMessage(
          'The document changed before it could be initialized. Review the current content and try again.',
        );
        sendUpdate();
        return;
      }

      const workspaceRoots: WorkspaceTemplateRoot[] = (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => isFilesystemBackedScheme(folder.uri.scheme))
        .map((folder) => ({
          identity: folder.uri.toString(),
          name: folder.name,
          rootPath: folder.uri.fsPath,
        }));
      const defaultTitle = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
        || 'Untitled';
      let templates;
      if (mode === 'template') {
        const discovery = await new VsCodeTemplateService().discover(workspaceRoots);
        templates = discovery.catalog.templates;
        const diagnosticCount = discovery.hostDiagnostics.length + discovery.catalog.diagnostics.length;
        if (diagnosticCount > 0) {
          console.warn('Structured Doc template discovery diagnostics', {
            host: discovery.hostDiagnostics,
            contract: discovery.catalog.diagnostics,
          });
          void vscode.window.showWarningMessage(
            `${diagnosticCount} template(s) could not be loaded. See the extension host log for details.`,
          );
        }
      }

      const nextText = await prepareEmptyDocumentInitialization({
        mode,
        currentText: document.getText(),
        defaultTitle,
        ...(templates ? { templates } : {}),
        selectTemplate: async (candidates) => {
          const selected = await vscode.window.showQuickPick(
            candidates.map((template) => ({
              label: template.descriptor.name,
              description: `Experimental · ${template.descriptor.sourceLabel}`,
              detail: template.descriptor.description,
              template,
            })),
            {
              title: 'Choose Experimental Structured Doc Template',
              placeHolder: 'Select a template for this empty document',
              matchOnDescription: true,
              matchOnDetail: true,
            },
          );
          return selected?.template;
        },
        requestTitle: async (value) => vscode.window.showInputBox({
          title: 'Initialize Structured Doc',
          prompt: 'Enter the document title',
          value,
          validateInput: validateDocumentTitle,
        }),
      });
      if (nextText === undefined) return;

      const committed = await commitEmptyDocumentInitialization({
        currentText: document.getText(),
        expected,
        current: currentInitializationIdentity(),
        preparedText: nextText,
        apply: async (text) => {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
            text,
          );
          await this.applyExpectedEdit(document, edit, text);
        },
      });
      if (!committed) {
        await vscode.window.showWarningMessage(
          'The document changed while the template was being selected. No content was replaced.',
        );
        sendUpdate();
        return;
      }
      sendUpdate();
    };

    // Handle messages from webview (sequential queue to preserve order)
    const messageQueue = new RecoverableSerialQueue();
    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isEditorToHostMessage(message)) {
        console.warn('Ignoring malformed Structured Doc editor message', message);
        return;
      }
      const readOnlySafeMessages = new Set([
        'ready', 'flushComplete', 'viewJson', 'export', 'openDocument', 'browseSdocFiles',
      ]);
      if (writeBlockedReason && !readOnlySafeMessages.has(message.type)) {
        if (message.type === 'edit' && message.flushRequestId) {
          this.rejectFlush(message.flushRequestId, new Error(writeBlockedReason));
        }
        vscode.window.showErrorMessage(`Document is read-only because it is invalid: ${writeBlockedReason}`);
        return;
      }
      // Export must stay outside the serial message queue: its flush response is itself
      // an editor message and would otherwise wait behind the export that is awaiting it.
      if (message.type === 'export') {
        void runExportAfterFlush(
          () => this.flushEditor(webviewPanel.webview, sessionId),
          () => this.exportService.exportDocument(document, message.format, webviewPanel.webview),
        ).catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Structured Doc export failed: ${detail}`);
        });
        return;
      }
      if (message.type === 'flushComplete') {
        if (message.sessionId === sessionId && message.requestId) this.resolveFlush(message.requestId);
        return;
      }
      if (message.type === 'initializeEmptyDocument') {
        if (initializationRequestPending) return;
        initializationRequestPending = true;
      }
      messageQueue.enqueue(async () => {
        switch (message.type) {
          case 'ready':
            sendUpdate();
            break;
          case 'initializeEmptyDocument':
            try {
              await initializeEmptyDocument(message.mode, {
                sessionId: message.sessionId,
                documentId: message.documentId,
                revision: message.baseRevision,
              });
            } finally {
              initializationRequestPending = false;
            }
            break;
          case 'edit':
            if (message.sessionId !== sessionId || message.documentId !== documentId
              || message.baseRevision !== document.version || !message.editId) {
              const parsed = JSON.parse(document.getText());
              const { doc } = sharedUnwrapSdoc(parsed);
              webviewPanel.webview.postMessage({
                type: 'editRejected', sessionId, editId: message.editId ?? '',
                revision: document.version, reason: 'stale revision or document identity',
                content: convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview),
              });
              if (message.flushRequestId) {
                this.rejectFlush(message.flushRequestId, new Error('Editor flush was rejected as stale.'));
              }
              break;
            }
            try {
              await this.updateDocument(document, message.content);
              webviewPanel.webview.postMessage({
                type: 'editAcknowledged', sessionId, editId: message.editId, revision: document.version,
              });
              if (message.flushRequestId) this.resolveFlush(message.flushRequestId);
            } catch (error) {
              const parsed: unknown = JSON.parse(document.getText());
              const { doc } = sharedUnwrapSdoc(parsed);
              webviewPanel.webview.postMessage({
                type: 'editRejected', sessionId, editId: message.editId,
                revision: document.version,
                reason: error instanceof Error ? error.message : String(error),
                content: convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview),
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
          case 'importMarkdown':
            await this.importMarkdown(document, webviewPanel);
            break;
          case 'importHtml':
            await this.importHtml(document, webviewPanel);
            break;
          case 'updateMeta':
            await this.updateMeta(document, message.meta);
            postAuthoritativeUpdate();
            break;
          case 'updateDocSettings':
            await this.updateDocSettings(document, webviewPanel, message.settings);
            postAuthoritativeUpdate();
            break;
          case 'selectCssFile': {
            const selectedPath = await this.selectCssFile(document);
            if (selectedPath !== undefined) {
              const target = message.target as 'slide' | 'html';
              const key = target === 'slide' ? 'slideCssPath' : 'htmlCssPath';
              const currentSettings = this.readDocSettings(document);
              const newSettings = { ...currentSettings, [key]: selectedPath };
              await this.updateDocSettings(document, webviewPanel, newSettings);
            }
            break;
          }
          case 'clearCssFile': {
            const target = message.target as 'slide' | 'html';
            const key = target === 'slide' ? 'slideCssPath' : 'htmlCssPath';
            const currentSettings = this.readDocSettings(document);
            if (currentSettings) {
              const { [key]: _removed, ...rest } = currentSettings;
              const newSettings = Object.keys(rest).length > 0 ? rest : null;
              await this.updateDocSettings(document, webviewPanel, newSettings);
            }
            break;
          }
        }
      }, (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('Structured Doc message failed', error);
        vscode.window.showErrorMessage(`Structured Doc operation failed: ${detail}`);
      });
    });

    // Flush webview state before save to prevent data loss
    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;

      e.waitUntil(this.flushEditor(webviewPanel.webview, sessionId, 1000));
    });

    // Handle external document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        // Don't send update if we caused the change
        if (this.consumePendingEdit(document)) {
          return;
        }

        if (initializationRequired || isUninitializedSdocText(document.getText())) {
          sendUpdate();
          return;
        }

        // Send updated content to webview
        try {
          const text = e.document.getText();
          const parsed = text.trim() ? JSON.parse(text) : { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } };
          const { doc } = sharedUnwrapSdoc(parsed);
          const convertedJson = convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);
          webviewPanel.webview.postMessage({
            type: 'update',
            sessionId,
            documentId,
            revision: document.version,
            content: convertedJson,
          });
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
    });

    // Cleanup
    webviewPanel.onDidDispose(() => {
      if (this.editorSessions.get(documentId)?.panel === webviewPanel) {
        this.editorSessions.delete(documentId);
      }
      changeDocumentSubscription.dispose();
      willSaveSubscription.dispose();
      drawioWatcher.dispose();
      pendingDrawioEvents.forEach((timer) => clearTimeout(timer));
      settingsSubscription.dispose();
      this.pendingAppliedTexts.delete(document.uri.toString());
      for (const [requestId, pending] of this.pendingFlushResolvers) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Editor was closed before its content could be flushed.'));
        this.pendingFlushResolvers.delete(requestId);
      }
    });
  }

  private async updateDocument(document: vscode.TextDocument, content: TiptapNode): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    // Convert webview URIs back to relative paths before saving
    const convertedContent = dehydrateDocumentAssets(convertWebviewUrisToRelativePaths(content));

    // Read existing file to preserve metadata
    const existingText = document.getText();
    let existingMeta: SdocMeta = {};
    try {
      existingMeta = sharedUnwrapSdoc(existingText.trim() ? JSON.parse(existingText) : {}).meta;
    } catch {
      // intentionally ignored: parse errors during editing
    }

    // Resolve settings from doc settings > VS Code > default
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const resolved = resolveSettings(existingMeta.settings, {
      equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
      captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
      crossRefIncludeCaption: config.get<boolean>('caption.crossRefIncludeCaption', false),
      captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
      headingNumbering: config.get<boolean>('heading.numbering', true),
    });

    const synced = normalizeDocument(convertedContent, {
      equationNumbering: resolved.equationNumbering,
      captionStyle: resolved.captionStyle,
      crossRefIncludeCaption: resolved.crossRefIncludeCaption,
      captionNumbering: resolved.captionNumbering,
      headingNumbering: resolved.headingNumbering,
    });

    // Wrap in sdoc envelope, preserving settings
    const sdocFile: Record<string, unknown> = {
      sdoc: SdocEditorProvider.SDOC_VERSION,
      meta: {
        ...existingMeta,
        title: existingMeta.title || '',
        author: existingMeta.author || '',
        version: existingMeta.version || '0.1',
        created: existingMeta.created || new Date().toISOString(),
        modified: new Date().toISOString(),
        ...(existingMeta.settings && Object.keys(existingMeta.settings).length > 0
          ? { settings: existingMeta.settings }
          : {}),
      },
      doc: synced,
    };
    assertPersistedDocument(sdocFile);

    // Pretty-print JSON for better git diffs
    const json = JSON.stringify(sdocFile, null, 2);
    edit.replace(document.uri, fullRange, json);

    await this.applyExpectedEdit(document, edit, json);
  }

  private expectAppliedText(document: vscode.TextDocument, text: string): void {
    const key = document.uri.toString();
    const pending = this.pendingAppliedTexts.get(key) ?? [];
    pending.push(text);
    this.pendingAppliedTexts.set(key, pending);
  }

  private async applyExpectedEdit(
    document: vscode.TextDocument,
    edit: vscode.WorkspaceEdit,
    expectedText: string,
  ): Promise<void> {
    this.expectAppliedText(document, expectedText);
    let applied: boolean;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch (error) {
      this.removeExpectedText(document, expectedText);
      throw error;
    }
    if (!applied) {
      this.removeExpectedText(document, expectedText);
      throw new Error('VS Code rejected the document edit.');
    }
  }

  private consumePendingEdit(document: vscode.TextDocument): boolean {
    const key = document.uri.toString();
    const pending = this.pendingAppliedTexts.get(key) ?? [];
    const index = pending.indexOf(document.getText());
    if (index < 0) return false;
    pending.splice(index, 1);
    if (pending.length === 0) this.pendingAppliedTexts.delete(key);
    return true;
  }

  private removeExpectedText(document: vscode.TextDocument, text: string): void {
    const key = document.uri.toString();
    const pending = this.pendingAppliedTexts.get(key) ?? [];
    const index = pending.indexOf(text);
    if (index >= 0) pending.splice(index, 1);
    if (pending.length === 0) this.pendingAppliedTexts.delete(key);
  }

  private async exportActive(format: ExportFormat): Promise<void> {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input;
    const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : undefined;
    if (!uri || (!uri.path.endsWith('.sdoc') && !uri.path.endsWith('.tiptap.json'))) {
      throw new Error('The active tab is not a Structured Doc document.');
    }

    const key = uri.toString();
    const session = this.editorSessions.get(key);
    const document = session?.document
      ?? vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === key)
      ?? await vscode.workspace.openTextDocument(uri);
    await runExportAfterFlush(
      session ? () => this.flushEditor(session.panel.webview, session.sessionId) : undefined,
      () => this.exportService.exportDocument(document, format, session?.panel.webview),
    );
  }

  private async flushActive(): Promise<void> {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input;
    const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : undefined;
    if (!uri) return;
    const session = this.editorSessions.get(uri.toString());
    if (session) await this.flushEditor(session.panel.webview, session.sessionId);
  }

  private flushEditor(webview: vscode.Webview, sessionId: string, timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        if (!this.pendingFlushResolvers.has(requestId)) return;
        this.rejectFlush(requestId, new Error('Timed out waiting for the editor to flush its latest content.'));
      }, timeoutMs);
      this.pendingFlushResolvers.set(requestId, { resolve, reject, timer });
      void webview.postMessage({ type: 'requestFlush', sessionId, requestId }).then((delivered) => {
        if (!delivered) this.rejectFlush(requestId, new Error('The editor is unavailable for export.'));
      }, (error: unknown) => {
        this.rejectFlush(requestId, error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Resolve any pending flush for this document */
  private resolveFlush(requestId: string): void {
    const pending = this.pendingFlushResolvers.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingFlushResolvers.delete(requestId);
      pending.resolve();
    }
  }

  private rejectFlush(requestId: string, error: Error): void {
    const pending = this.pendingFlushResolvers.get(requestId);
    if (pending) {
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

  private async importMarkdown(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    try {
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import Markdown',
        filters: { 'Markdown Files': ['md', 'markdown'] },
      });
      if (!fileUris || fileUris.length === 0) return;

      const mdBytes = await vscode.workspace.fs.readFile(fileUris[0]);
      const mdText = new TextDecoder('utf-8').decode(mdBytes);
      const doc = convertMarkdownToJson(mdText);

      // Convert image paths to webview URIs
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const convertedDoc = convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);

      webviewPanel.webview.postMessage({ type: 'importContent', content: convertedDoc });
      vscode.window.showInformationMessage('Markdown imported successfully');
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to import Markdown: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async importHtml(
    _document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    try {
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import HTML',
        filters: { 'HTML Files': ['html', 'htm'] },
      });
      if (!fileUris || fileUris.length === 0) return;

      const htmlBytes = await vscode.workspace.fs.readFile(fileUris[0]);
      const htmlText = new TextDecoder('utf-8').decode(htmlBytes);

      // Send raw HTML to webview — Tiptap's setContent(htmlString) will parse it
      webviewPanel.webview.postMessage({ type: 'importHtml', html: htmlText });
      vscode.window.showInformationMessage('HTML imported successfully');
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to import HTML: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async updateMeta(
    document: vscode.TextDocument,
    meta: { title?: string; author?: string; version?: string }
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    const existingText = document.getText();
    let parsed: unknown;
    try {
      parsed = existingText.trim() ? JSON.parse(existingText) : {};
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !('sdoc' in parsed)) return;
    const { doc, meta: existingMeta } = sharedUnwrapSdoc(parsed);
    const nextEnvelope = sharedWrapSdoc(doc, { ...existingMeta, ...meta });
    assertPersistedDocument(nextEnvelope);
    const json = JSON.stringify(nextEnvelope, null, 2);
    edit.replace(document.uri, fullRange, json);

    await this.applyExpectedEdit(document, edit, json);
  }

  /** Save per-document settings into meta.settings, then re-send merged settings to webview. */
  private async updateDocSettings(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    settings: Partial<DocumentSettings> | null,
  ): Promise<void> {
    if (settings !== null && !validateDocumentSettings(settings)) {
      throw new Error('Document settings violate sdoc.schema.json');
    }
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    const existingText = document.getText();
    let parsed: unknown;
    try {
      parsed = existingText.trim() ? JSON.parse(existingText) : {};
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !('sdoc' in parsed)) return;
    const { doc, meta } = sharedUnwrapSdoc(parsed);
    const nextMeta: SdocMeta = { ...meta };
    if (settings && Object.keys(settings).length > 0) nextMeta.settings = settings;
    else delete nextMeta.settings;
    const nextEnvelope = sharedWrapSdoc(doc, nextMeta);
    assertPersistedDocument(nextEnvelope);
    const json = JSON.stringify(nextEnvelope, null, 2);
    edit.replace(document.uri, fullRange, json);

    await this.applyExpectedEdit(document, edit, json);

    // Re-read and re-send merged settings so the webview reflects the change
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const vscodeDefaults: Partial<DocumentSettings> = {
      headingNumbering: config.get<boolean>('heading.numbering', true),
      headingDecoration: config.get<boolean>('heading.decoration', true),
      headingH1Color: config.get<string>('heading.h1Color', SETTINGS_DEFAULTS.headingH1Color),
      headingH2Color: config.get<string>('heading.h2Color', SETTINGS_DEFAULTS.headingH2Color),
      headingH3Color: config.get<string>('heading.h3Color', SETTINGS_DEFAULTS.headingH3Color),
      headingH4Color: config.get<string>('heading.h4Color', SETTINGS_DEFAULTS.headingH4Color),
      headingH5Color: config.get<string>('heading.h5Color', SETTINGS_DEFAULTS.headingH5Color),
      headingH6Color: config.get<string>('heading.h6Color', SETTINGS_DEFAULTS.headingH6Color),
      captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
      captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
      equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
      crossRefIncludeCaption: config.get<boolean>('caption.crossRefIncludeCaption', false),
    };
    const resolved = resolveSettings(settings ?? undefined, vscodeDefaults);
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
        headingDecoration: resolved.headingDecoration,
        headingH1Color: resolved.headingH1Color,
        headingH2Color: resolved.headingH2Color,
        headingH3Color: resolved.headingH3Color,
        headingH4Color: resolved.headingH4Color,
        headingH5Color: resolved.headingH5Color,
        headingH6Color: resolved.headingH6Color,
        defaultImageAlignment: config.get<string>('image.defaultAlignment', 'center'),
        exportImagePath: config.get<string>('export.imagePath', 'relative'),
        pdfScale: config.get<number>('export.pdfScale', 70),
        selfContained: config.get<'none' | 'images-only' | 'full'>('export.selfContained', 'images-only'),
        slideBreakLevel: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
        slideTransition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
        showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
        outputDir: config.get<string>('export.outputDir', ''),
        fontWeightBody: config.get<string>('font.body', 'Regular'),
        fontWeightBold: config.get<string>('font.bold', 'Bold'),
        fontWeightH1: config.get<string>('font.h1', 'Bold'),
        fontWeightH2: config.get<string>('font.h2', 'SemiBold'),
        fontWeightH3: config.get<string>('font.h3', 'SemiBold'),
      },
    });
    webviewPanel.webview.postMessage({
      type: 'docSettingsChanged',
      docSettings: settings || null,
    });
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
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(selected.fsPath));
        const text = new TextDecoder().decode(data);
        const parsed = JSON.parse(text);
        const { doc } = sharedUnwrapSdoc(parsed);
        const targets = this.collectExternalTargets(doc);

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
      'index.css',
    ]);

    // Build @font-face declarations for bundled fonts
    const fontFaces = generateFontFaceCSS(webview, this.context.extensionUri);

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
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
    return './' + path.relative(basePath, selectedUri.fsPath).replace(/\\/g, '/');
  }

  private readDocSettings(document: vscode.TextDocument): Partial<DocumentSettings> | null {
    try {
      const text = document.getText();
      const parsed: unknown = text.trim() ? JSON.parse(text) : {};
      return readDocumentSettings(parsed) ?? null;
    } catch {
      return null;
    }
  }
}
