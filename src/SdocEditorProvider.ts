import * as vscode from 'vscode';
import * as path from 'path';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { convertJsonToHtml, convertJsonToAdoc, convertJsonToMarkdown, convertJsonToSlides, convertMarkdownToJson } from '../shared/converter';
import { detectBrowser, printToPdf } from './utils/browserDetect';
import { resolveFontWeight, generateFontFaceCSS, loadBundledFontsAsBase64 } from './utils/fontUtils';
import { convertImagePathsToWebviewUris, convertWebviewUrisToRelativePaths, embedImagesAsBase64 } from './utils/imageUtils';
import { resolveCompanyLogo, readFontWeights, buildHtmlTheme } from './utils/themeUtils';
import {
  unwrapSdoc as sharedUnwrapSdoc,
  migrateAttributes as sharedMigrateAttributes,
  assignAutoIds as sharedAssignAutoIds,
  syncCrossReferences as sharedSyncCrossReferences,
  extractTitle as sharedExtractTitle,
} from '../shared/mcp/sdocUtils';
import { resolveSettings } from '../shared/settingsResolver';
import type { DocumentSettings } from '../shared/types';

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

  private pendingApplyEdits = 0;

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
        captionImagePrefix: config.get<string>('caption.imagePrefix', 'Image'),
        captionTablePrefix: config.get<string>('caption.tablePrefix', 'Table'),
        captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
        equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
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
      webviewPanel.webview.postMessage({
        type: 'settingsChanged',
        settings: {
          imageCaptionPrefix: resolved.captionImagePrefix,
          tableCaptionPrefix: resolved.captionTablePrefix,
          captionNumbering: resolved.captionNumbering,
          equationNumbering: resolved.equationNumbering,
          headingNumbering: resolved.headingNumbering,
          headingDecoration: resolved.headingDecoration,
          headingH1Color: resolved.headingH1Color,
          headingH2Color: resolved.headingH2Color,
          headingH3Color: resolved.headingH3Color,
          defaultImageAlignment: config.get<string>('image.defaultAlignment', 'center'),
          exportImagePath: config.get<string>('export.imagePath', 'relative'),
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

    // Send metadata to webview
    const sendMeta = () => {
      try {
        const text = document.getText();
        const parsed = text.trim() ? JSON.parse(text) : {};
        const { meta } = SdocEditorProvider.unwrapSdoc(parsed);
        webviewPanel.webview.postMessage({ type: 'metaUpdate', meta });
      } catch {
        // Ignore parse errors
      }
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

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          sendUpdate();
          break;
        case 'edit':
          await this.updateDocument(document, message.content);
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
          await this.exportDocument(document, message.format);
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
      }
    });

    // Handle external document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        // Don't send update if we caused the change
        if (this.pendingApplyEdits > 0) {
          this.pendingApplyEdits--;
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
        } catch (error) {
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
      drawioWatcher.dispose();
      settingsSubscription.dispose();
    });
  }

  private async updateDocument(document: vscode.TextDocument, content: any): Promise<void> {
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
    let existingMeta: any = {};
    try {
      const existing = existingText.trim() ? JSON.parse(existingText) : {};
      if (existing.sdoc && existing.meta) {
        existingMeta = existing.meta;
      }
    } catch {
      // intentionally ignored: parse errors during editing
    }

    // Resolve equationNumbering from doc settings > VS Code > default
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const docEqNumbering = existingMeta.settings?.equationNumbering;
    const eqNumbering = (docEqNumbering || config.get<string>('equation.numbering', 'sequential')) as 'sequential' | 'hierarchical';

    // Assign auto-ids and sync cross-reference text
    const withIds = SdocEditorProvider.assignAutoIds(cleaned);
    const synced = SdocEditorProvider.syncCrossReferences(withIds, eqNumbering);

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

    this.pendingApplyEdits++;
    await vscode.workspace.applyEdit(edit);
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
    document: vscode.TextDocument,
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
    let parsed: any;
    try {
      parsed = existingText.trim() ? JSON.parse(existingText) : {};
    } catch {
      return;
    }

    if (parsed.sdoc && parsed.meta) {
      if (meta.title !== undefined) {
        parsed.meta.title = meta.title;
      }
      if (meta.author !== undefined) {
        parsed.meta.author = meta.author;
      }
      if (meta.version !== undefined) {
        parsed.meta.version = meta.version;
      }
      parsed.meta.modified = new Date().toISOString();
    }

    const json = JSON.stringify(parsed, null, 2);
    edit.replace(document.uri, fullRange, json);

    this.pendingApplyEdits++;
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
    let parsed: any;
    try {
      parsed = existingText.trim() ? JSON.parse(existingText) : {};
    } catch {
      return;
    }

    if (!parsed.sdoc) return;
    if (!parsed.meta) parsed.meta = {};

    if (settings && Object.keys(settings).length > 0) {
      parsed.meta.settings = settings;
    } else {
      delete parsed.meta.settings;
    }
    parsed.meta.modified = new Date().toISOString();

    const json = JSON.stringify(parsed, null, 2);
    edit.replace(document.uri, fullRange, json);

    this.pendingApplyEdits++;
    await vscode.workspace.applyEdit(edit);

    // Re-read and re-send merged settings so the webview reflects the change
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const vscodeDefaults: Partial<DocumentSettings> = {
      headingNumbering: config.get<boolean>('heading.numbering', true),
      headingDecoration: config.get<boolean>('heading.decoration', true),
      headingH1Color: config.get<string>('heading.h1Color', '#A50034'),
      headingH2Color: config.get<string>('heading.h2Color', '#A50034'),
      headingH3Color: config.get<string>('heading.h3Color', '#A50034'),
      captionImagePrefix: config.get<string>('caption.imagePrefix', 'Image'),
      captionTablePrefix: config.get<string>('caption.tablePrefix', 'Table'),
      captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
      equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
    };
    const resolved = resolveSettings(settings ?? undefined, vscodeDefaults);
    webviewPanel.webview.postMessage({
      type: 'settingsChanged',
      settings: {
        imageCaptionPrefix: resolved.captionImagePrefix,
        tableCaptionPrefix: resolved.captionTablePrefix,
        captionNumbering: resolved.captionNumbering,
        equationNumbering: resolved.equationNumbering,
        headingNumbering: resolved.headingNumbering,
        headingDecoration: resolved.headingDecoration,
        headingH1Color: resolved.headingH1Color,
        headingH2Color: resolved.headingH2Color,
        headingH3Color: resolved.headingH3Color,
        defaultImageAlignment: config.get<string>('image.defaultAlignment', 'center'),
        exportImagePath: config.get<string>('export.imagePath', 'relative'),
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
    anchor?: string
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
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const searchRoot = workspaceFolder?.uri.fsPath || currentDir;

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

  private collectExternalTargets(doc: any): Array<{ id: string; type: string; label: string }> {
    const targets: Array<{ id: string; type: string; label: string }> = [];
    if (!doc?.content) return targets;

    const h = [0, 0, 0, 0, 0, 0];
    let imgCnt = 0;
    let tblCnt = 0;

    const getText = (node: any): string => {
      if (node.type === 'text') return node.text || '';
      if (!node.content) return '';
      return node.content.map(getText).join('');
    };

    for (const node of doc.content) {
      if (node.type === 'heading') {
        const level = node.attrs?.level || 1;
        h[level - 1]++;
        for (let j = level; j < 6; j++) h[j] = 0;
        if (level === 1) { imgCnt = 0; tblCnt = 0; }
        const nums = h.slice(0, level).join('.') + '.';
        const text = getText(node);
        const id = node.attrs?.id || '';
        if (id) targets.push({ id, type: 'heading', label: `${nums} ${text}` });
      }
      if (node.type === 'image' && node.attrs?.id) {
        imgCnt++;
        const caption = node.attrs?.caption || '';
        targets.push({ id: node.attrs.id, type: 'figure', label: caption ? `Figure ${imgCnt}: ${caption}` : `Figure ${imgCnt}` });
      }
      if (node.type === 'table' && node.attrs?.id) {
        tblCnt++;
        const caption = node.attrs?.caption || '';
        targets.push({ id: node.attrs.id, type: 'table', label: caption ? `Table ${tblCnt}: ${caption}` : `Table ${tblCnt}` });
      }
    }

    return targets;
  }

  private async exportDocument(
    document: vscode.TextDocument,
    format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides'
  ): Promise<void> {
    try {
      const text = document.getText();
      let parsed = text.trim() ? JSON.parse(text) : { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } };

      // Unwrap envelope
      const { doc, meta } = SdocEditorProvider.unwrapSdoc(parsed);

      // Convert webview URIs back to relative paths
      let convertedDoc = convertWebviewUrisToRelativePaths(doc);

      // Read export settings — merge doc-level settings over VS Code defaults
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      const selfContained = config.get<'none' | 'images-only' | 'full'>('export.selfContained', 'images-only');
      const vscodeDefaults: Partial<DocumentSettings> = {
        captionImagePrefix: config.get<string>('caption.imagePrefix', 'Image'),
        captionTablePrefix: config.get<string>('caption.tablePrefix', 'Table'),
        captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
        equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
      };
      const resolved = resolveSettings(meta.settings as Partial<DocumentSettings> | undefined, vscodeDefaults);
      const exportSettings: Record<string, unknown> = {
        imageCaptionPrefix: resolved.captionImagePrefix,
        tableCaptionPrefix: resolved.captionTablePrefix,
        captionNumbering: resolved.captionNumbering,
        equationNumbering: resolved.equationNumbering,
        exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
      };

      // For HTML, PDF, and slides, apply selfContained settings
      const needsSelfContained = format === 'html' || format === 'pdf' || format === 'slides';
      if (needsSelfContained && selfContained !== 'none') {
        const documentDir = path.dirname(document.uri.fsPath);
        convertedDoc = await embedImagesAsBase64(convertedDoc, documentDir);
        exportSettings.selfContained = selfContained;
      }
      // PDF always embeds images regardless of setting
      if (format === 'pdf' && selfContained === 'none') {
        const documentDir = path.dirname(document.uri.fsPath);
        convertedDoc = await embedImagesAsBase64(convertedDoc, documentDir);
        exportSettings.selfContained = 'images-only';
      }

      let content: string;
      let ext: string;
      let label: string;

      switch (format) {
        case 'html':
        case 'pdf': {
          const companyLogo = await resolveCompanyLogo(
            config.get<string>('theme.companyLogo') || '',
            this.context.extensionPath,
          );
          const fontWeights = readFontWeights(config);
          const usedWeights = new Set(Object.values(fontWeights));
          const embeddedFonts = await loadBundledFontsAsBase64(this.context.extensionUri, usedWeights);
          const theme = buildHtmlTheme(config, companyLogo, fontWeights, embeddedFonts);

          content = convertJsonToHtml(convertedDoc, theme, exportSettings, meta);

          if (format === 'pdf') {
            // PDF: generate via headless browser
            const browserPath = detectBrowser();
            if (!browserPath) {
              vscode.window.showErrorMessage(
                'Chrome, Edge, or Chromium is required for PDF export. Please install one of these browsers.'
              );
              return;
            }

            // Inject zoom CSS for PDF scale
            const pdfScale = config.get<number>('export.pdfScale', 70) / 100;
            content = content.replace('</head>', `<style>body{zoom:${pdfScale};}</style>\n</head>`);

            const fs = await import('fs');
            const tempHtmlPath = document.uri.fsPath.replace(/(\.tiptap\.json|\.sdoc)$/, '.tmp.html');
            const pdfPath = document.uri.fsPath.replace(/(\.tiptap\.json|\.sdoc)$/, '.pdf');

            fs.writeFileSync(tempHtmlPath, content, 'utf-8');
            try {
              await printToPdf(browserPath, tempHtmlPath, pdfPath);
            } finally {
              try { fs.unlinkSync(tempHtmlPath); } catch { /* ignore */ }
            }

            const pdfUri = vscode.Uri.file(pdfPath);
            const action = await vscode.window.showInformationMessage(
              `PDF exported: ${pdfUri.fsPath}`,
              'Open PDF'
            );
            if (action === 'Open PDF') {
              await vscode.env.openExternal(pdfUri);
            }
            return;
          }

          ext = '.html';
          label = 'HTML';
          break;
        }
        case 'slides': {
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
          };

          const slideSettings = {
            ...exportSettings,
            slideBreak: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
            showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
            transition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
          };

          content = convertJsonToSlides(convertedDoc, slideTheme, slideSettings, meta);

          const slideUri = document.uri.with({
            path: document.uri.path.replace(/(\..+)$/, '.slides.html'),
          });
          const encoder2 = new TextEncoder();
          await vscode.workspace.fs.writeFile(slideUri, encoder2.encode(content));

          const action = await vscode.window.showInformationMessage(
            `Slides exported: ${slideUri.fsPath}`,
            'Open in Browser'
          );
          if (action === 'Open in Browser') {
            await vscode.env.openExternal(slideUri);
          }
          return;
        }
        case 'adoc':
          content = convertJsonToAdoc(convertedDoc, exportSettings, meta);
          ext = '.adoc';
          label = 'AsciiDoc';
          break;
        case 'markdown':
          content = convertJsonToMarkdown(convertedDoc, exportSettings, meta);
          ext = '.md';
          label = 'Markdown';
          break;
      }

      const outputUri = document.uri.with({
        path: document.uri.path.replace(/(\.tiptap\.json|\.sdoc)$/, ext),
      });

      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(outputUri, encoder.encode(content));

      const action = await vscode.window.showInformationMessage(
        `${label} exported: ${outputUri.fsPath}`,
        'Open File'
      );

      if (action === 'Open File') {
        if (format === 'html') {
          await vscode.commands.executeCommand('vscode.open', outputUri);
        } else {
          const openedDoc = await vscode.workspace.openTextDocument(outputUri);
          await vscode.window.showTextDocument(openedDoc, { preview: false });
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to export: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Unwrap an .sdoc file: supports both the new envelope format and legacy (bare doc).
   * Also migrates legacy attribute names (data-caption → caption, etc.).
   */
  private static unwrapSdoc(parsed: any): { meta: any; doc: any } {
    return sharedUnwrapSdoc(parsed);
  }

  private static migrateAttributes(node: any): any {
    return sharedMigrateAttributes(node);
  }

  private static extractTitle(doc: any): string {
    return sharedExtractTitle(doc);
  }

  /**
   * Clean text nodes: trim trailing whitespace from the last text node of each
   * block-level parent and remove resulting empty text nodes.
   * Intermediate text nodes keep their trailing space (e.g., "Hello " before bold).
   */
  private static cleanTextNodes(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if (!node.content) return node;

    // Recurse into children first
    const cleaned = node.content
      .map((child: any) => SdocEditorProvider.cleanTextNodes(child))
      .filter((child: any) => child !== null);

    // Only trim the very last text node in the content array
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i]?.type === 'text' && typeof cleaned[i].text === 'string') {
        const trimmed = cleaned[i].text.replace(/\s+$/, '');
        if (!trimmed) {
          cleaned.splice(i, 1);
        } else {
          cleaned[i] = { ...cleaned[i], text: trimmed };
        }
        break;
      }
      // Stop at the last inline-level node (don't look past non-text inlines)
      if (cleaned[i]?.type && cleaned[i].type !== 'text') break;
    }

    return { ...node, content: cleaned };
  }

  private static assignAutoIds(doc: any): any {
    return sharedAssignAutoIds(doc);
  }

  private static syncCrossReferences(doc: any, equationNumbering: 'sequential' | 'hierarchical' = 'sequential'): any {
    return sharedSyncCrossReferences(doc, equationNumbering);
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
}
