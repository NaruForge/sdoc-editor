import * as vscode from 'vscode';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { convertJsonToAdoc } from './converter/jsonToAdoc';

export class SdocEditorProvider implements vscode.CustomTextEditorProvider {
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

  private isApplyingEdit = false;

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

    // Send initial document content with image paths converted
    const sendUpdate = () => {
      try {
        const text = document.getText();
        const json = text.trim() ? JSON.parse(text) : { type: 'doc', content: [] };
        // Convert image paths to webview URIs
        const convertedJson = this.convertImagePathsToWebviewUris(json, documentDir, webviewPanel.webview);
        webviewPanel.webview.postMessage({
          type: 'init',
          content: convertedJson,
        });
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to parse .sdoc file: ${error instanceof Error ? error.message : 'Unknown error'}`
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
      }
    });

    // Handle external document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        // Don't send update if we caused the change
        if (this.isApplyingEdit) {
          return;
        }

        // Send updated content to webview
        try {
          const text = e.document.getText();
          const json = text.trim() ? JSON.parse(text) : { type: 'doc', content: [] };
          const convertedJson = this.convertImagePathsToWebviewUris(json, documentDir, webviewPanel.webview);
          webviewPanel.webview.postMessage({
            type: 'update',
            content: convertedJson,
          });
        } catch (error) {
          // Ignore parse errors during typing
        }
      }
    });

    // Handle save events to generate .adoc file
    const saveDocumentSubscription = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
      if (savedDoc.uri.toString() === document.uri.toString()) {
        await this.generateAdocFile(savedDoc);
      }
    });

    // Cleanup
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      saveDocumentSubscription.dispose();
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

    // Pretty-print JSON for better git diffs
    const json = JSON.stringify(convertedContent, null, 2);
    edit.replace(document.uri, fullRange, json);

    this.isApplyingEdit = true;
    await vscode.workspace.applyEdit(edit);
    this.isApplyingEdit = false;
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

  private async generateAdocFile(document: vscode.TextDocument): Promise<void> {
    try {
      const text = document.getText();
      const json = JSON.parse(text);
      const adocContent = convertJsonToAdoc(json);

      // Generate .adoc file in the same directory
      const adocUri = document.uri.with({
        path: document.uri.path.replace(/\.sdoc$/, '.adoc'),
      });

      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(
        adocUri,
        encoder.encode(adocContent)
      );
    } catch (error) {
      vscode.window.showWarningMessage(
        `Failed to generate .adoc file: ${error instanceof Error ? error.message : 'Unknown error'}`
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
        // Extract the filename from the URI
        const match = src.match(/images\/([^?#]+)/);
        if (match) {
          const fileName = match[1];
          cloned.attrs = {
            ...cloned.attrs,
            src: `./images/${fileName}`,
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
