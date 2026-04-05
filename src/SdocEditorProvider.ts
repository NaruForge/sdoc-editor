import * as vscode from 'vscode';
import * as path from 'path';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { convertJsonToHtml } from './converter/jsonToHtml';
import { convertJsonToAdoc } from './converter/jsonToAdoc';
import { convertJsonToMarkdown } from './converter/jsonToMarkdown';
import { convertMarkdownToJson } from './converter/markdownToJson';
import {
  unwrapSdoc as sharedUnwrapSdoc,
  migrateAttributes as sharedMigrateAttributes,
  assignAutoIds as sharedAssignAutoIds,
  syncCrossReferences as sharedSyncCrossReferences,
  extractTitle as sharedExtractTitle,
} from '../shared/mcp/sdocUtils';

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
        documentDir, // Allow access to images in the same directory as .sdoc file
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Read and send editor settings to webview
    const sendSettings = () => {
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      webviewPanel.webview.postMessage({
        type: 'settingsChanged',
        settings: {
          imageCaptionPrefix: config.get<string>('caption.imagePrefix', 'Image'),
          tableCaptionPrefix: config.get<string>('caption.tablePrefix', 'Table'),
          captionNumbering: config.get<string>('caption.numbering', 'simple'),
          headingNumbering: config.get<boolean>('heading.numbering', true),
          headingDecoration: config.get<boolean>('heading.decoration', true),
          headingH1Color: config.get<string>('heading.h1Color', '#A50034'),
          headingH2Color: config.get<string>('heading.h2Color', '#A50034'),
          headingH3Color: config.get<string>('heading.h3Color', '#A50034'),
          defaultImageAlignment: config.get<string>('image.defaultAlignment', 'center'),
          exportImagePath: config.get<string>('export.imagePath', 'relative'),
        },
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
        const convertedJson = this.convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);
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
        case 'importMarkdown':
          await this.importMarkdown(document, webviewPanel);
          break;
        case 'importHtml':
          await this.importHtml(document, webviewPanel);
          break;
        case 'updateMeta':
          await this.updateMeta(document, message.meta);
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
          const convertedJson = this.convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);
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
    const convertedContent = this.convertWebviewUrisToRelativePaths(content);

    // Clean up text nodes (trim trailing whitespace, remove empty text nodes)
    const cleaned = SdocEditorProvider.cleanTextNodes(convertedContent);

    // Assign auto-ids and sync cross-reference text
    const withIds = SdocEditorProvider.assignAutoIds(cleaned);
    const synced = SdocEditorProvider.syncCrossReferences(withIds);

    // Read existing file to preserve metadata
    const existingText = document.getText();
    let existingMeta: any = {};
    try {
      const existing = existingText.trim() ? JSON.parse(existingText) : {};
      if (existing.sdoc && existing.meta) {
        existingMeta = existing.meta;
      }
    } catch {
      // Ignore parse errors
    }

    // Wrap in sdoc envelope
    const sdocFile = {
      sdoc: SdocEditorProvider.SDOC_VERSION,
      meta: {
        title: existingMeta.title || '',
        author: existingMeta.author || '',
        version: existingMeta.version || '0.1',
        created: existingMeta.created || new Date().toISOString(),
        modified: new Date().toISOString(),
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
      const convertedDoc = this.convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);

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

  // Convert relative image paths to webview URIs for display
  private convertImagePathsToWebviewUris(
    node: any,
    documentDir: vscode.Uri,
    webview: vscode.Webview
  ): any {
    if (!node || typeof node !== 'object') {
      return node;
    }

    // Clone to avoid mutating original
    const cloned = Array.isArray(node) ? [...node] : { ...node };

    // If this is an image node with a relative path, convert it
    if (cloned.type === 'image' && cloned.attrs?.src) {
      const src = cloned.attrs.src;
      if (src.startsWith('./')) {
        // Convert relative path to absolute URI
        const imagePath = src.replace('./', '');
        const imageUri = vscode.Uri.joinPath(documentDir, imagePath);
        const webviewUri = webview.asWebviewUri(imageUri);
        cloned.attrs = {
          ...cloned.attrs,
          src: webviewUri.toString(),
        };
      }
    }

    // Recursively process content
    if (cloned.content && Array.isArray(cloned.content)) {
      cloned.content = cloned.content.map((child: any) =>
        this.convertImagePathsToWebviewUris(child, documentDir, webview)
      );
    }

    return cloned;
  }

  // Convert webview URIs back to relative paths for JSON storage
  private convertWebviewUrisToRelativePaths(node: any): any {
    if (!node || typeof node !== 'object') {
      return node;
    }

    // Clone to avoid mutating original
    const cloned = Array.isArray(node) ? [...node] : { ...node };

    // If this is an image node with a webview URI, convert it to relative path
    if (cloned.type === 'image' && cloned.attrs?.src) {
      const src = cloned.attrs.src;
      // Check if it's a webview URI (contains vscode-webview-resource or similar)
      if (src.includes('vscode-webview') || src.includes('vscode-resource')) {
        // Extract the filename from the URI - check for images or drawio
        const imageMatch = src.match(/images\/([^?#]+)/);
        const drawioMatch = src.match(/drawio\/([^?#]+)/);

        if (imageMatch) {
          const fileName = imageMatch[1];
          cloned.attrs = {
            ...cloned.attrs,
            src: `./images/${fileName}`,
          };
        } else if (drawioMatch) {
          const fileName = drawioMatch[1];
          cloned.attrs = {
            ...cloned.attrs,
            src: `./drawio/${fileName}`,
          };
        }
      }
    }

    // Recursively process content
    if (cloned.content && Array.isArray(cloned.content)) {
      cloned.content = cloned.content.map((child: any) =>
        this.convertWebviewUrisToRelativePaths(child)
      );
    }

    return cloned;
  }

  private async exportDocument(
    document: vscode.TextDocument,
    format: 'html' | 'adoc' | 'markdown'
  ): Promise<void> {
    try {
      const text = document.getText();
      let parsed = text.trim() ? JSON.parse(text) : { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } };

      // Unwrap envelope
      const { doc, meta } = SdocEditorProvider.unwrapSdoc(parsed);

      // Convert webview URIs back to relative paths
      const convertedDoc = this.convertWebviewUrisToRelativePaths(doc);

      // Read export settings
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      const exportSettings = {
        imageCaptionPrefix: config.get<string>('caption.imagePrefix', 'Image'),
        tableCaptionPrefix: config.get<string>('caption.tablePrefix', 'Table'),
        captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
        exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
      };

      let content: string;
      let ext: string;
      let label: string;

      switch (format) {
        case 'html': {
          let companyLogo = config.get<string>('theme.companyLogo') || '';
          // Resolve logo file to data URI if it's a filename (not URL or data URI)
          if (companyLogo && !companyLogo.startsWith('data:') && !companyLogo.startsWith('http')) {
            try {
              const logoPath = path.join(this.context.extensionPath, 'media', companyLogo);
              const logoUri = vscode.Uri.file(logoPath);
              const logoData = await vscode.workspace.fs.readFile(logoUri);
              const base64 = Buffer.from(logoData).toString('base64');
              const ext2 = path.extname(companyLogo).toLowerCase().replace('.', '');
              const mime = ext2 === 'svg' ? 'image/svg+xml' : `image/${ext2 || 'png'}`;
              companyLogo = `data:${mime};base64,${base64}`;
            } catch {
              companyLogo = '';
            }
          }
          const theme = {
            companyLogo,
            companyName: config.get<string>('theme.companyName') || '',
            primaryColor: config.get<string>('theme.primaryColor') || '#A50034',
            accentColor: config.get<string>('theme.accentColor') || '#6b6b6b',
            fontFamily: config.get<string>('theme.fontFamily') || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            customStyles: config.get<string>('theme.customStyles') || '',
          };
          content = convertJsonToHtml(convertedDoc, theme, exportSettings, meta);
          ext = '.html';
          label = 'HTML';
          break;
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

  private static syncCrossReferences(doc: any): any {
    return sharedSyncCrossReferences(doc);
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

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
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
