import * as vscode from 'vscode';
import * as path from 'path';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { convertJsonToHtml, convertJsonToAdoc, convertJsonToMarkdown, convertJsonToSlides, convertMarkdownToJson } from '../shared/converter';
import { detectBrowser, printToPdf } from './utils/browserDetect';
import { generateFontFaceCSS, loadBundledFontsAsBase64 } from './utils/fontUtils';
import { convertImagePathsToWebviewUris, convertWebviewUrisToRelativePaths, embedImagesAsBase64 } from './utils/imageUtils';
import { resolveCompanyLogo, readFontWeights, buildHtmlTheme } from './utils/themeUtils';
import { resolveCustomCss } from './utils/cssUtils';
import {
  unwrapSdoc as sharedUnwrapSdoc,
  wrapSdoc as sharedWrapSdoc,
  assignAutoIds as sharedAssignAutoIds,
  syncCrossReferences as sharedSyncCrossReferences,
} from '../shared/document/sdocUtils';
import { resolveSettings, getCaptionPreset } from '../shared/settingsResolver';
import type { DocumentSettings, CaptionStyleName, SdocMeta, TiptapNode } from '../shared/types';

export class SdocEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly SDOC_VERSION = '1.0';

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
  /** Per-document export-in-progress guard (prevents duplicate concurrent exports) */
  private exportInProgress = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

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
        const { doc, meta } = SdocEditorProvider.unwrapSdoc(parsed);
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
    webviewPanel.webview.onDidReceiveMessage((message) => {
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
            await this.saveImage(document, webviewPanel.webview, message);
            break;
          case 'createDrawio':
            await this.createDrawioFile(document, webviewPanel.webview, message);
            break;
          case 'importDrawio':
            await this.importDrawioFile(document, webviewPanel.webview);
            break;
          case 'openDrawio':
            await this.openDrawioFile(document, message);
            break;
          case 'insertExistingImage':
            await this.insertExistingImage(document, webviewPanel.webview);
            break;
          case 'replaceImage':
            await this.replaceImage(document, webviewPanel.webview, message.pos);
            break;
          case 'export':
            await this.exportDocument(document, message.format, webviewPanel.webview);
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
          const { doc } = SdocEditorProvider.unwrapSdoc(parsed);
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
      this.exportInProgress.delete(key);
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

    // Clean up text nodes (trim trailing whitespace, remove empty text nodes)
    const cleaned = SdocEditorProvider.cleanTextNodes(convertedContent);

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

    // Assign auto-ids and sync cross-reference text
    const withIds = SdocEditorProvider.assignAutoIds(cleaned);
    const synced = SdocEditorProvider.syncCrossReferences(withIds, eqNumbering, captionStyle, crossRefIncludeCaption);

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

  private async saveImage(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    message: { imageName: string; imageData: string; extension: string }
  ): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      // Create images directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const imagesDir = vscode.Uri.joinPath(documentDir, 'images');

      // Ensure images directory exists
      try {
        await vscode.workspace.fs.stat(imagesDir);
      } catch {
        await vscode.workspace.fs.createDirectory(imagesDir);
      }

      // Save image file
      const fileName = `${message.imageName}.${message.extension}`;
      const imageUri = vscode.Uri.joinPath(imagesDir, fileName);
      const imageBuffer = Buffer.from(message.imageData, 'base64');
      await vscode.workspace.fs.writeFile(imageUri, imageBuffer);

      // Convert to webview URI for display
      const webviewUri = webview.asWebviewUri(imageUri);
      const relativePath = `./images/${fileName}`;

      webview.postMessage({
        type: 'imageSaved',
        imagePath: relativePath, // relative path for JSON storage
        webviewUri: webviewUri.toString(), // webview URI for display
        imageName: message.imageName,
      });

      vscode.window.showInformationMessage(`Image saved: ${fileName}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to save image: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async createDrawioFile(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    message: { fileName: string }
  ): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      // Create drawio directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const drawioDir = vscode.Uri.joinPath(documentDir, 'drawio');

      // Ensure drawio directory exists
      try {
        await vscode.workspace.fs.stat(drawioDir);
      } catch {
        await vscode.workspace.fs.createDirectory(drawioDir);
      }

      // Create empty draw.io SVG file
      const fileName = `${message.fileName}.drawio.svg`;
      const drawioUri = vscode.Uri.joinPath(drawioDir, fileName);

      // Check if file already exists
      try {
        await vscode.workspace.fs.stat(drawioUri);
        vscode.window.showErrorMessage(`File already exists: ${fileName}`);
        return;
      } catch {
        // File doesn't exist, proceed to create it
      }

      // 빈 파일로 생성 — draw.io extension이 열 때 빈 캔버스로 초기화함
      await vscode.workspace.fs.writeFile(drawioUri, new Uint8Array(0));

      // Convert to webview URI for display
      const webviewUri = webview.asWebviewUri(drawioUri);
      const relativePath = `./drawio/${fileName}`;

      webview.postMessage({
        type: 'drawioCreated',
        drawioPath: relativePath, // relative path for JSON storage
        webviewUri: webviewUri.toString(), // webview URI for display
        fileName: message.fileName,
      });

      vscode.window.showInformationMessage(`Draw.io file created: ${fileName}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to create draw.io file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async openDrawioFile(
    document: vscode.TextDocument,
    message: { drawioPath: string }
  ): Promise<void> {
    try {
      // Convert relative path to absolute URI
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const drawioPath = message.drawioPath.replace('./', '');
      const drawioUri = vscode.Uri.joinPath(documentDir, drawioPath);

      // Check if file exists
      try {
        await vscode.workspace.fs.stat(drawioUri);
      } catch {
        vscode.window.showErrorMessage(`Draw.io file not found: ${message.drawioPath}`);
        return;
      }

      // vscode.open을 사용하면 파일 연결(.drawio.svg → draw.io extension)을
      // 그대로 따르므로, 탐색기에서 직접 여는 것과 동일하게 동작함
      await vscode.commands.executeCommand(
        'vscode.open',
        drawioUri,
        vscode.ViewColumn.Beside
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open draw.io file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async importDrawioFile(
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    try {
      // Show file picker for .drawio file selection
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import Draw.io Diagram',
        filters: {
          'Draw.io Files': ['drawio.svg', 'svg']
        }
      });

      if (!fileUris || fileUris.length === 0) {
        return; // User cancelled
      }

      const sourceUri = fileUris[0];
      const fileName = sourceUri.path.split('/').pop() || 'diagram.drawio.svg';

      // Verify it's a .drawio.svg file
      if (!fileName.includes('.drawio.svg')) {
        vscode.window.showWarningMessage(
          'Please select a .drawio.svg file. Regular SVG files are not supported.'
        );
        return;
      }

      // Create drawio directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const drawioDir = vscode.Uri.joinPath(documentDir, 'drawio');

      // Ensure drawio directory exists
      try {
        await vscode.workspace.fs.stat(drawioDir);
      } catch {
        await vscode.workspace.fs.createDirectory(drawioDir);
      }

      // Check if the selected file is already in the drawio directory
      const sourceParentPath = sourceUri.path.substring(0, sourceUri.path.lastIndexOf('/'));
      const drawioDirPath = drawioDir.path;
      const isAlreadyInDrawioDir = sourceParentPath === drawioDirPath;

      let finalFileName = fileName;
      let targetUri = sourceUri; // Default to source if already in drawio dir

      if (isAlreadyInDrawioDir) {
        // File is already in drawio directory, just reference it
        finalFileName = fileName;
        targetUri = sourceUri;
        vscode.window.showInformationMessage(`Referencing existing diagram: ${finalFileName}`);
      } else {
        // File is external, copy it to drawio directory
        // Generate unique filename if file already exists
        let counter = 1;
        targetUri = vscode.Uri.joinPath(drawioDir, finalFileName);

        while (true) {
          try {
            await vscode.workspace.fs.stat(targetUri);
            // File exists, try with counter
            const baseName = fileName.replace('.drawio.svg', '');
            finalFileName = `${baseName}-${counter}.drawio.svg`;
            targetUri = vscode.Uri.joinPath(drawioDir, finalFileName);
            counter++;
          } catch {
            // File doesn't exist, use this name
            break;
          }
        }

        // Copy file to drawio directory
        await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: false });
        vscode.window.showInformationMessage(`Diagram copied and imported: ${finalFileName}`);
      }

      // Convert to webview URI for display
      const webviewUri = webview.asWebviewUri(targetUri);
      const relativePath = `./drawio/${finalFileName}`;

      webview.postMessage({
        type: 'drawioCreated',
        drawioPath: relativePath,
        webviewUri: webviewUri.toString(),
        fileName: finalFileName.replace('.drawio.svg', ''),
      });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to import draw.io file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async insertExistingImage(
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    try {
      // Show file picker for image selection
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Insert Image',
        filters: {
          'Images': ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']
        }
      });

      if (!fileUris || fileUris.length === 0) {
        return; // User cancelled
      }

      const sourceUri = fileUris[0];
      const fileName = sourceUri.path.split('/').pop() || 'image.png';

      // Check if it's a draw.io file - those should use "Insert Draw.io" instead
      if (fileName.includes('.drawio.')) {
        vscode.window.showWarningMessage(
          'Draw.io files should be inserted using the "Insert Draw.io" button, not "Insert Image".'
        );
        return;
      }

      // Create images directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const imagesDir = vscode.Uri.joinPath(documentDir, 'images');

      // Ensure images directory exists
      try {
        await vscode.workspace.fs.stat(imagesDir);
      } catch {
        await vscode.workspace.fs.createDirectory(imagesDir);
      }

      // Check if the selected file is already in the images directory
      const sourceParentPath = sourceUri.path.substring(0, sourceUri.path.lastIndexOf('/'));
      const imagesDirPath = imagesDir.path;
      const isAlreadyInImagesDir = sourceParentPath === imagesDirPath;

      let finalFileName = fileName;
      let targetUri = sourceUri; // Default to source if already in images dir

      if (isAlreadyInImagesDir) {
        // File is already in images directory, just reference it
        finalFileName = fileName;
        targetUri = sourceUri;
        vscode.window.showInformationMessage(`Referencing existing image: ${finalFileName}`);
      } else {
        // File is external, copy it to images directory
        // Generate unique filename if file already exists
        let counter = 1;
        targetUri = vscode.Uri.joinPath(imagesDir, finalFileName);

        while (true) {
          try {
            await vscode.workspace.fs.stat(targetUri);
            // File exists, try with counter
            const nameParts = fileName.split('.');
            const ext = nameParts.pop();
            const baseName = nameParts.join('.');
            finalFileName = `${baseName}-${counter}.${ext}`;
            targetUri = vscode.Uri.joinPath(imagesDir, finalFileName);
            counter++;
          } catch {
            // File doesn't exist, use this name
            break;
          }
        }

        // Copy file to images directory
        await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: false });
        vscode.window.showInformationMessage(`Image copied and inserted: ${finalFileName}`);
      }

      // Convert to webview URI for display
      const webviewUri = webview.asWebviewUri(targetUri);
      const relativePath = `./images/${finalFileName}`;

      webview.postMessage({
        type: 'imageInserted',
        imagePath: relativePath,
        webviewUri: webviewUri.toString(),
        fileName: finalFileName,
      });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to insert image: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async replaceImage(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    pos: number
  ): Promise<void> {
    try {
      // Show file picker for image selection
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Replace Image',
        filters: {
          'Images': ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']
        }
      });

      if (!fileUris || fileUris.length === 0) {
        return; // User cancelled
      }

      const sourceUri = fileUris[0];
      const fileName = sourceUri.path.split('/').pop() || 'image.png';

      // Check if it's a draw.io file - those cannot be used to replace regular images
      if (fileName.includes('.drawio.')) {
        vscode.window.showWarningMessage(
          'Draw.io files should be inserted using the "Insert Draw.io" button, not used to replace images.'
        );
        return;
      }

      // Create images directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const imagesDir = vscode.Uri.joinPath(documentDir, 'images');

      // Ensure images directory exists
      try {
        await vscode.workspace.fs.stat(imagesDir);
      } catch {
        await vscode.workspace.fs.createDirectory(imagesDir);
      }

      // Generate unique filename if file already exists
      let finalFileName = fileName;
      let counter = 1;
      let targetUri = vscode.Uri.joinPath(imagesDir, finalFileName);

      while (true) {
        try {
          await vscode.workspace.fs.stat(targetUri);
          // File exists, try with counter
          const nameParts = fileName.split('.');
          const ext = nameParts.pop();
          const baseName = nameParts.join('.');
          finalFileName = `${baseName}-${counter}.${ext}`;
          targetUri = vscode.Uri.joinPath(imagesDir, finalFileName);
          counter++;
        } catch {
          // File doesn't exist, use this name
          break;
        }
      }

      // Copy file to images directory
      await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: false });

      // Convert to webview URI for display
      const webviewUri = webview.asWebviewUri(targetUri);
      const relativePath = `./images/${finalFileName}`;

      webview.postMessage({
        type: 'imageReplaced',
        pos: pos,
        imagePath: relativePath,
        webviewUri: webviewUri.toString(),
        fileName: finalFileName,
      });

      vscode.window.showInformationMessage(`Image replaced: ${finalFileName}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to replace image: ${error instanceof Error ? error.message : 'Unknown error'}`
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
        const { doc } = SdocEditorProvider.unwrapSdoc(parsed);
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

  private async exportDocument(
    document: vscode.TextDocument,
    format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides',
    webview: vscode.Webview
  ): Promise<void> {
    const docKey = document.uri.toString();

    // Guard: prevent duplicate concurrent exports for the same document
    if (this.exportInProgress.has(docKey)) {
      vscode.window.showWarningMessage('이미 내보내기가 진행 중입니다. 잠시 기다려 주세요.');
      return;
    }

    const formatLabels: Record<string, string> = {
      html: 'HTML', pdf: 'PDF', markdown: 'Markdown', adoc: 'AsciiDoc', slides: 'Slides',
    };
    const label = formatLabels[format] ?? format.toUpperCase();

    this.exportInProgress.add(docKey);
    webview.postMessage({ type: 'exportStarted', format });

    // ExportResult: info needed to show completion message AFTER withProgress closes
    type ExportResult = {
      successMsg: string;
      actionLabel: string;
      openUri: vscode.Uri;
      openKind: 'external' | 'html' | 'text';
    } | null;

    let result: ExportResult = null;
    try {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `내보내기 중 (${label})`,
          cancellable: false,
        },
        async (progress) => {
          return await this._doExport(document, format, label, progress);
        }
      );
    } finally {
      this.exportInProgress.delete(docKey);
      webview.postMessage({ type: 'exportDone' });
    }

    // Show success notification AFTER progress notification has closed
    if (result) {
      const action = await vscode.window.showInformationMessage(
        result.successMsg,
        result.actionLabel,
        'Reveal in Explorer'
      );
      if (action === result.actionLabel) {
        if (result.openKind === 'external') {
          await vscode.env.openExternal(result.openUri);
        } else if (result.openKind === 'html') {
          await vscode.commands.executeCommand('vscode.open', result.openUri);
        } else {
          const openedDoc = await vscode.workspace.openTextDocument(result.openUri);
          await vscode.window.showTextDocument(openedDoc, { preview: false });
        }
      } else if (action === 'Reveal in Explorer') {
        await vscode.commands.executeCommand('revealFileInOS', result.openUri);
      }
    }
  }

  private async _doExport(
    document: vscode.TextDocument,
    format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides',
    label: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<{
    successMsg: string;
    actionLabel: string;
    openUri: vscode.Uri;
    openKind: 'external' | 'html' | 'text';
  } | null> {
    try {
      progress.report({ message: '문서 읽는 중...', increment: 5 });
      const text = document.getText();
      const parsed = text.trim() ? JSON.parse(text) : { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } };

      // Unwrap envelope
      const { doc, meta } = SdocEditorProvider.unwrapSdoc(parsed);

      // Convert webview URIs back to relative paths
      let convertedDoc = convertWebviewUrisToRelativePaths(doc);

      // Read export settings — merge doc-level settings over VS Code defaults
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      const vscodeDefaults: Partial<DocumentSettings> = {
        captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
        captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
        equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
        selfContained: config.get<'none' | 'images-only' | 'full'>('export.selfContained', 'images-only'),
        pdfScale: config.get<number>('export.pdfScale', 70),
        outputDir: config.get<string>('export.outputDir', ''),
        slideBreakLevel: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
        slideTransition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
        showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
      };
      const resolved = resolveSettings(meta.settings as Partial<DocumentSettings> | undefined, vscodeDefaults);
      const preset = getCaptionPreset(resolved.captionStyle);
      const exportSettings: Record<string, unknown> = {
        imageCaptionPrefix: preset.figurePrefix,
        tableCaptionPrefix: preset.tablePrefix,
        equationCaptionPrefix: preset.equationPrefix,
        captionSeparator: preset.separator,
        tableNumberStyle: preset.tableNumberStyle,
        equationParens: preset.equationParens,
        captionNumbering: resolved.captionNumbering,
        equationNumbering: resolved.equationNumbering,
        exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
      };

      // For HTML, PDF, and slides, apply selfContained settings
      const needsSelfContained = format === 'html' || format === 'pdf' || format === 'slides';
      if (needsSelfContained && resolved.selfContained !== 'none') {
        progress.report({ message: '이미지 처리 중...', increment: 20 });
        const documentDir = path.dirname(document.uri.fsPath);
        convertedDoc = await embedImagesAsBase64(convertedDoc, documentDir);
        exportSettings.selfContained = resolved.selfContained;
      }
      // PDF always embeds images regardless of setting
      if (format === 'pdf' && resolved.selfContained === 'none') {
        progress.report({ message: '이미지 처리 중...', increment: 20 });
        const documentDir = path.dirname(document.uri.fsPath);
        convertedDoc = await embedImagesAsBase64(convertedDoc, documentDir);
        exportSettings.selfContained = 'images-only';
      }

      let content: string;
      let ext: string;

      switch (format) {
        case 'html':
        case 'pdf': {
          progress.report({ message: 'HTML 변환 중...', increment: 30 });
          const companyLogo = await resolveCompanyLogo(
            config.get<string>('theme.companyLogo') || '',
            this.context.extensionPath,
          );
          const fontWeights = readFontWeights(config);
          const usedWeights = new Set(Object.values(fontWeights));
          const embeddedFonts = await loadBundledFontsAsBase64(this.context.extensionUri, usedWeights);
          const theme = buildHtmlTheme(config, companyLogo, fontWeights, embeddedFonts);
          const customStyles = await resolveCustomCss(
            resolved.htmlCssPath,
            this.getWorkspaceBasePath(document),
            config.get<string>('theme.customStyles') || '',
          );

          content = convertJsonToHtml(convertedDoc, { ...theme, customStyles }, exportSettings, meta);

          if (format === 'pdf') {
            // PDF: generate via headless browser
            const browserPath = detectBrowser();
            if (!browserPath) {
              const fallbackUri = await this.writeExportFile(
                document,
                '.html',
                content,
                resolved.outputDir,
                progress,
              );
              if (!fallbackUri) return null;
              const action = await vscode.window.showWarningMessage(
                `PDF 내보내기에 필요한 Chrome/Edge/Chromium을 찾지 못해 HTML로 대신 내보냈습니다: ${fallbackUri.fsPath}`,
                'Open HTML',
                'Reveal in Explorer',
                'Install Guide'
              );
              if (action === 'Open HTML') {
                await vscode.commands.executeCommand('vscode.open', fallbackUri);
              } else if (action === 'Reveal in Explorer') {
                await vscode.commands.executeCommand('revealFileInOS', fallbackUri);
              } else if (action === 'Install Guide') {
                await vscode.env.openExternal(vscode.Uri.parse('https://www.google.com/chrome/'));
              }
              return null;
            }

          // Inject zoom CSS for PDF scale
          const pdfScale = resolved.pdfScale / 100;
          content = content.replace('</head>', `<style>body{zoom:${pdfScale};}</style>\n</head>`);

          const tempHtmlPath = document.uri.fsPath.replace(/(\.tiptap\.json|\.sdoc)$/, '.tmp.html');
          const pdfUri = this.buildExportUri(document, '.pdf', resolved.outputDir);
          const shouldOverwritePdf = await this.confirmOverwrite(pdfUri);
          if (!shouldOverwritePdf) return null;
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(pdfUri.fsPath)));

          progress.report({ message: 'PDF 인쇄 중...', increment: 40 });
          const tempHtmlUri = vscode.Uri.file(tempHtmlPath);
          await vscode.workspace.fs.writeFile(tempHtmlUri, new TextEncoder().encode(content));
          try {
            await printToPdf(browserPath, tempHtmlPath, pdfUri.fsPath);
          } finally {
            try {
              await vscode.workspace.fs.delete(tempHtmlUri);
            } catch {
              // intentionally ignored: best-effort cleanup for transient export HTML
            }
          }

          return {
            successMsg: `PDF exported: ${pdfUri.fsPath}`,
            actionLabel: 'Open PDF',
              openUri: pdfUri,
              openKind: 'external',
            };
          }

          ext = '.html';
          break;
        }
        case 'slides': {
          progress.report({ message: '슬라이드 변환 중...', increment: 30 });
          const slideLogo = await resolveCompanyLogo(
            config.get<string>('theme.companyLogo') || '',
            this.context.extensionPath,
          );
          const slideFontWeights = readFontWeights(config);
          const usedSlideWeights = new Set(Object.values(slideFontWeights));
          const slideEmbeddedFonts = await loadBundledFontsAsBase64(this.context.extensionUri, usedSlideWeights);
          const slideTheme = {
            ...buildHtmlTheme(config, slideLogo, slideFontWeights, slideEmbeddedFonts),
            primaryColor: config.get<string>('slide.primaryColor') || config.get<string>('theme.primaryColor') || '#A50034',
            accentColor: config.get<string>('slide.accentColor') || config.get<string>('theme.accentColor') || '#6b6b6b',
            customStyles: await resolveCustomCss(
              resolved.slideCssPath,
              this.getWorkspaceBasePath(document),
              config.get<string>('theme.customStyles') || '',
            ),
          };

          const slideSettings = {
            ...exportSettings,
            slideBreak: resolved.slideBreakLevel,
            slideBreakLevel: resolved.slideBreakLevel,
            showTitleSlide: resolved.showTitleSlide,
            transition: resolved.slideTransition,
            slideTransition: resolved.slideTransition,
          };

          content = convertJsonToSlides(convertedDoc, slideTheme, slideSettings, meta);

          const slideUri = await this.writeExportFile(
            document,
            '.slides.html',
            content,
            resolved.outputDir,
            progress,
          );
          if (!slideUri) return null;

          return {
            successMsg: `Slides exported: ${slideUri.fsPath}`,
            actionLabel: 'Open in Browser',
            openUri: slideUri,
            openKind: 'external',
          };
        }
        case 'adoc':
          progress.report({ message: 'AsciiDoc 변환 중...', increment: 50 });
          content = convertJsonToAdoc(convertedDoc, exportSettings, meta);
          ext = '.adoc';
          break;
        case 'markdown':
          progress.report({ message: 'Markdown 변환 중...', increment: 50 });
          content = convertJsonToMarkdown(convertedDoc, exportSettings, meta);
          ext = '.md';
          break;
      }

      progress.report({ message: '파일 쓰는 중...', increment: 20 });
      const outputUri = await this.writeExportFile(
        document,
        ext,
        content,
        resolved.outputDir,
        progress,
      );
      if (!outputUri) return null;

      return {
        successMsg: `${label} exported: ${outputUri.fsPath}`,
        actionLabel: 'Open File',
        openUri: outputUri,
        openKind: format === 'html' ? 'html' : 'text',
      };
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to export: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }

  private getWorkspaceBasePath(document: vscode.TextDocument): string {
    return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath);
  }

  private buildExportUri(
    document: vscode.TextDocument,
    extension: string,
    outputDir: string,
  ): vscode.Uri {
    const baseName = path.basename(document.uri.fsPath).replace(/(\.tiptap\.json|\.sdoc)$/, '');
    const outputFileName = `${baseName}${extension}`;
    const trimmedOutputDir = outputDir.trim();
    if (!trimmedOutputDir) {
      return document.uri.with({ path: document.uri.path.replace(/(\.tiptap\.json|\.sdoc)$/, extension) });
    }

    const basePath = this.getWorkspaceBasePath(document);
    const resolvedOutputDir = path.isAbsolute(trimmedOutputDir)
      ? trimmedOutputDir
      : path.resolve(basePath, trimmedOutputDir);
    return vscode.Uri.file(path.join(resolvedOutputDir, outputFileName));
  }

  private async confirmOverwrite(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      return true;
    }

    const answer = await vscode.window.showWarningMessage(
      `이미 파일이 있습니다. 덮어쓰시겠습니까?\n${uri.fsPath}`,
      { modal: true },
      '덮어쓰기'
    );
    return answer === '덮어쓰기';
  }

  private async writeExportFile(
    document: vscode.TextDocument,
    extension: string,
    content: string,
    outputDir: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<vscode.Uri | null> {
    const outputUri = this.buildExportUri(document, extension, outputDir);
    const shouldOverwrite = await this.confirmOverwrite(outputUri);
    if (!shouldOverwrite) {
      return null;
    }
    progress.report({ message: '파일 쓰는 중...', increment: 20 });
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(outputUri.fsPath)));
    await vscode.workspace.fs.writeFile(outputUri, new TextEncoder().encode(content));
    return outputUri;
  }

  /**
   * Unwrap an .sdoc file: supports both the new envelope format and legacy (bare doc).
   * Also migrates legacy attribute names (data-caption → caption, etc.).
   */
  private static unwrapSdoc(parsed: unknown): { meta: SdocMeta; doc: TiptapNode } {
    return sharedUnwrapSdoc(parsed);
  }

  /**
   * Clean text nodes: trim trailing whitespace from the last text node of each
   * block-level parent and remove resulting empty text nodes.
   * Intermediate text nodes keep their trailing space (e.g., "Hello " before bold).
   */
  private static cleanTextNodes(node: TiptapNode): TiptapNode {
    if (!node.content) return node;

    // Recurse into children first
    const cleaned = node.content
      .map((child) => SdocEditorProvider.cleanTextNodes(child));

    // Only trim the very last text node in the content array
    for (let i = cleaned.length - 1; i >= 0; i--) {
      const child = cleaned[i];
      if (child?.type === 'text' && typeof child.text === 'string') {
        const trimmed = child.text.replace(/\s+$/, '');
        if (!trimmed) {
          cleaned.splice(i, 1);
        } else {
          cleaned[i] = { ...child, text: trimmed };
        }
        break;
      }
      // Stop at the last inline-level node (don't look past non-text inlines)
      if (cleaned[i]?.type && cleaned[i].type !== 'text') break;
    }

    return { ...node, content: cleaned };
  }

  private static assignAutoIds(doc: TiptapNode): TiptapNode {
    return sharedAssignAutoIds(doc);
  }

  private static syncCrossReferences(
    doc: TiptapNode,
    equationNumbering: 'sequential' | 'hierarchical' = 'sequential',
    captionStyle: CaptionStyleName = 'modern',
    crossRefIncludeCaption = false,
  ): TiptapNode {
    return sharedSyncCrossReferences(doc, equationNumbering, captionStyle, crossRefIncludeCaption);
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
