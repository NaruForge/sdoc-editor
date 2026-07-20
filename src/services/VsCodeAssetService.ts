import * as vscode from 'vscode';

export class VsCodeAssetService {
  async saveImage(
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

  async createDrawioFile(
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

  async openDrawioFile(
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

  async importDrawioFile(
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

  async insertExistingImage(
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

  async replaceImage(
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
}
