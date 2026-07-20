import * as vscode from 'vscode';
import * as path from 'path';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { convertMarkdownToJson } from '../shared/converter';
import { generateFontFaceCSS } from './utils/fontUtils';
import { convertImagePathsToWebviewUris, convertWebviewUrisToRelativePaths } from './utils/imageUtils';
import {
  unwrapSdoc as sharedUnwrapSdoc,
  wrapSdoc as sharedWrapSdoc,
  normalizeDocument,
} from '../shared/document/sdocUtils';
import { resolveSettings, getCaptionPreset } from '../shared/settingsResolver';
import type { DocumentSettings, CaptionStyleName, SdocMeta, TiptapNode } from '../shared/types';
import { isEditorToHostMessage } from '../shared/types/messageGuards';
import { VsCodeAssetService } from './services/VsCodeAssetService';
import { VsCodeExportService } from './services/VsCodeExportService';

export class SdocEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly SDOC_VERSION = '1.0';
  private readonly assetService = new VsCodeAssetService();
  private readonly exportService: VsCodeExportService;

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SdocEditorProvider(context);
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

  /** Per-document pending apply-edit counter to suppress echo-back */
  private pendingApplyEdits = new Map<string, number>();
  /** Per-document flush resolver: resolves when an edit arrives after a requestFlush */
  private pendingFlushResolvers = new Map<string, () => void>();
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
        documentDir, // Allow access to images in the same directory as .sdoc file
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Read and send editor settings to webview
    const readVscodeDocDefaults = (): Partial<DocumentSettings> => {
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      return {
        headingNumbering: config.get<boolean>('heading.numbering', true),
        headingDecoration: config.get<boolean>('heading.decoration', true),
        headingH1Color: config.get<string>('heading.h1Color', '#A50034'),
        headingH2Color: config.get<string>('heading.h2Color', '#A50034'),
        headingH3Color: config.get<string>('heading.h3Color', '#A50034'),
        captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
        captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
        equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
        crossRefIncludeCaption: config.get<boolean>('caption.crossRefIncludeCaption', false),
      };
    };

    const readDocSettings = (): Partial<DocumentSettings> | undefined => {
      try {
        const text = document.getText();
        const parsed = text.trim() ? JSON.parse(text) : {};
        return parsed?.meta?.settings;
      } catch {
        return undefined;
      }
    };

    const sendSettings = () => {
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      const vscodeDefaults = readVscodeDocDefaults();
      const docSettings = readDocSettings();
      const resolved = resolveSettings(docSettings, vscodeDefaults);
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
        const parsed = text.trim() ? JSON.parse(text) : { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } };
        // Unwrap sdoc envelope → extract doc node
        const { doc, meta } = sharedUnwrapSdoc(parsed);
        // Convert image paths to webview URIs
        const convertedJson = convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);
        webviewPanel.webview.postMessage({
          type: 'init',
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

    // Handle messages from webview (sequential queue to preserve order)
    let messageQueue: Promise<void> = Promise.resolve();
    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isEditorToHostMessage(message)) {
        console.warn('Ignoring malformed Structured Doc editor message', message);
        return;
      }
      messageQueue = messageQueue.then(async () => {
        switch (message.type) {
          case 'ready':
            sendUpdate();
            break;
          case 'edit':
            await this.updateDocument(document, message.content);
            this.resolveFlush(document);
            // If the webview requested a save (Ctrl+S while debounce pending), trigger save now
            if (message.saveRequested && document.isDirty) {
              await document.save();
            }
            break;
          case 'flushComplete':
            this.resolveFlush(document);
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
          case 'export':
            await this.exportService.exportDocument(document, message.format, webviewPanel.webview);
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
            break;
          case 'updateDocSettings':
            await this.updateDocSettings(document, webviewPanel, message.settings);
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
              await this.updateDocSettings(document, webviewPanel, newSettings as Partial<DocumentSettings> | null);
            }
            break;
          }
        }
      });
    });

    // Flush webview state before save to prevent data loss
    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;

      const flushPromise = new Promise<void>((resolve) => {
        const key = document.uri.toString();
        this.pendingFlushResolvers.set(key, resolve);
        webviewPanel.webview.postMessage({ type: 'requestFlush' });
        // Timeout to prevent hanging saves if webview is unresponsive
        setTimeout(() => {
          if (this.pendingFlushResolvers.has(key)) {
            this.pendingFlushResolvers.delete(key);
            resolve();
          }
        }, 1000);
      });

      e.waitUntil(flushPromise);
    });

    // Handle external document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        // Don't send update if we caused the change
        if (this.consumePendingEdit(document)) {
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

    const notifyDrawioUpdated = (uri: vscode.Uri) => {
      const fileName = uri.path.split('/').pop()!;
      const relativePath = `./drawio/${fileName}`;
      const webviewUri = webviewPanel.webview.asWebviewUri(uri);
      // 캐시 버스팅: 타임스탬프를 쿼리 파라미터로 추가
      const cacheBustedUri = `${webviewUri.toString()}?t=${Date.now()}`;
      webviewPanel.webview.postMessage({
        type: 'drawioFileUpdated',
        relativePath,
        newWebviewUri: cacheBustedUri,
      });
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
      changeDocumentSubscription.dispose();
      willSaveSubscription.dispose();
      drawioWatcher.dispose();
      settingsSubscription.dispose();
      const key = document.uri.toString();
      this.pendingApplyEdits.delete(key);
      this.pendingFlushResolvers.delete(key);
    });
  }

  private async updateDocument(document: vscode.TextDocument, content: TiptapNode): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    // Convert webview URIs back to relative paths before saving
    const convertedContent = convertWebviewUrisToRelativePaths(content);

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
    const docEqNumbering = existingMeta.settings?.equationNumbering;
    const eqNumbering = (docEqNumbering || config.get<string>('equation.numbering', 'sequential')) as 'sequential' | 'hierarchical';
    const docCaptionStyle = existingMeta.settings?.captionStyle;
    const captionStyle = (docCaptionStyle || config.get<string>('caption.style', 'modern')) as CaptionStyleName;
    const crossRefIncludeCaption = existingMeta.settings?.crossRefIncludeCaption ?? config.get<boolean>('caption.crossRefIncludeCaption', false);

    const synced = normalizeDocument(convertedContent, {
      equationNumbering: eqNumbering,
      captionStyle,
      crossRefIncludeCaption,
    });

    // Wrap in sdoc envelope, preserving settings
    const sdocFile: Record<string, unknown> = {
      sdoc: SdocEditorProvider.SDOC_VERSION,
      meta: {
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

    // Pretty-print JSON for better git diffs
    const json = JSON.stringify(sdocFile, null, 2);
    edit.replace(document.uri, fullRange, json);

    this.incrementPendingEdits(document);
    await vscode.workspace.applyEdit(edit);
  }

  /** Increment per-document pending edit counter */
  private incrementPendingEdits(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.pendingApplyEdits.set(key, (this.pendingApplyEdits.get(key) ?? 0) + 1);
  }

  /** Decrement per-document pending edit counter; returns true if it was consumed */
  private consumePendingEdit(document: vscode.TextDocument): boolean {
    const key = document.uri.toString();
    const count = this.pendingApplyEdits.get(key) ?? 0;
    if (count > 0) {
      this.pendingApplyEdits.set(key, count - 1);
      return true;
    }
    return false;
  }

  /** Resolve any pending flush for this document */
  private resolveFlush(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const resolver = this.pendingFlushResolvers.get(key);
    if (resolver) {
      this.pendingFlushResolvers.delete(key);
      resolver();
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
    const json = JSON.stringify(sharedWrapSdoc(doc, { ...existingMeta, ...meta }), null, 2);
    edit.replace(document.uri, fullRange, json);

    this.incrementPendingEdits(document);
    await vscode.workspace.applyEdit(edit);
  }

  /** Save per-document settings into meta.settings, then re-send merged settings to webview. */
  private async updateDocSettings(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    settings: Partial<DocumentSettings> | null,
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
    const { doc, meta } = sharedUnwrapSdoc(parsed);
    const nextMeta: SdocMeta = { ...meta };
    if (settings && Object.keys(settings).length > 0) nextMeta.settings = settings;
    else delete nextMeta.settings;
    const json = JSON.stringify(sharedWrapSdoc(doc, nextMeta), null, 2);
    edit.replace(document.uri, fullRange, json);

    this.incrementPendingEdits(document);
    await vscode.workspace.applyEdit(edit);

    // Re-read and re-send merged settings so the webview reflects the change
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const vscodeDefaults: Partial<DocumentSettings> = {
      headingNumbering: config.get<boolean>('heading.numbering', true),
      headingDecoration: config.get<boolean>('heading.decoration', true),
      headingH1Color: config.get<string>('heading.h1Color', '#A50034'),
      headingH2Color: config.get<string>('heading.h2Color', '#A50034'),
      headingH3Color: config.get<string>('heading.h3Color', '#A50034'),
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
    const files = await vscode.workspace.findFiles('**/*.sdoc', '**/node_modules/**', 100);
    const currentPath = document.uri.fsPath;

    const items = files
      .filter(f => f.fsPath !== currentPath)
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data: https:;">
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
      const parsed = text.trim() ? JSON.parse(text) : {};
      return parsed?.meta?.settings ?? null;
    } catch {
      return null;
    }
  }
}
