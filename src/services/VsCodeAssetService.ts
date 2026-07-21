import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { realpath } from 'fs/promises';
import {
  buildPortableAssetPath,
  parseAssetFileName,
  parseAssetStem,
  parseImageExtension,
  parsePortableAssetPath,
} from '../../shared/security/portableAssets';

function requireAssetStem(value: string): string {
  const safe = parseAssetStem(value);
  if (!safe) throw new Error('Asset name contains an invalid or non-portable filename.');
  return safe;
}

function requireAssetFileName(value: string): string {
  const safe = parseAssetFileName(value);
  if (!safe) throw new Error('Asset filename is invalid or non-portable.');
  return safe;
}

function requireImageFileName(value: string): string {
  const safe = requireAssetFileName(value);
  const extension = path.posix.extname(safe).slice(1);
  if (!parseImageExtension(extension) || safe.toLowerCase().includes('.drawio.')) {
    throw new Error('Unsupported image filename.');
  }
  return safe;
}

function requireDrawioFileName(value: string): string {
  const safe = requireAssetFileName(value);
  if (!safe.toLowerCase().endsWith('.drawio.svg')) {
    throw new Error('Only .drawio.svg files are supported.');
  }
  return safe;
}

function containedChildUri(root: vscode.Uri, fileName: string): vscode.Uri {
  const safeName = requireAssetFileName(fileName);
  const candidate = vscode.Uri.joinPath(root, safeName);
  const relative = root.scheme === 'file'
    ? path.relative(root.fsPath, candidate.fsPath)
    : path.posix.relative(root.path, candidate.path);
  if (relative !== safeName || path.isAbsolute(relative) || relative.startsWith('..')) {
    throw new Error('Asset path escapes its managed directory.');
  }
  return candidate;
}

function containedPortableAssetUri(documentDir: vscode.Uri, portablePath: string): vscode.Uri {
  const parsed = parsePortableAssetPath(portablePath);
  if (!parsed) throw new Error('Asset path is not a portable document-relative path.');
  const candidate = vscode.Uri.joinPath(documentDir, parsed.directory, ...parsed.segments);
  const relative = documentDir.scheme === 'file'
    ? path.relative(documentDir.fsPath, candidate.fsPath)
    : path.posix.relative(documentDir.path, candidate.path);
  if (!relative || path.isAbsolute(relative) || relative.startsWith('..')) {
    throw new Error('Asset path escapes the document directory.');
  }
  return candidate;
}

async function assertCanonicalContained(root: vscode.Uri, target: vscode.Uri): Promise<void> {
  if (root.scheme !== 'file' || target.scheme !== 'file') return;
  const [canonicalRoot, canonicalTarget] = await Promise.all([
    realpath(root.fsPath),
    realpath(target.fsPath),
  ]);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Asset path resolves outside its managed directory.');
  }
}

async function prepareManagedDirectory(documentDir: vscode.Uri, name: 'images' | 'drawio'): Promise<vscode.Uri> {
  const directory = vscode.Uri.joinPath(documentDir, name);
  await vscode.workspace.fs.createDirectory(directory);
  await assertCanonicalContained(documentDir, directory);
  return directory;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Return false only for an exclusive-create collision; propagate every other backend failure. */
async function copyExclusive(source: vscode.Uri, target: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.copy(source, target, { overwrite: false });
    return true;
  } catch (error) {
    if (await uriExists(target)) return false;
    throw error;
  }
}

async function writeExclusive(target: vscode.Uri, content: Uint8Array): Promise<boolean> {
  const parent = vscode.Uri.joinPath(target, '..');
  const temporary = containedChildUri(parent, `sdoc-asset-${randomUUID()}.tmp`);
  await vscode.workspace.fs.writeFile(temporary, content);
  try {
    return await copyExclusive(temporary, target);
  } finally {
    try {
      await vscode.workspace.fs.delete(temporary, { useTrash: false });
    } catch {
      // Best-effort cleanup; the exclusive target result remains authoritative.
    }
  }
}

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
      const imagesDir = await prepareManagedDirectory(documentDir, 'images');

      const imageName = requireAssetStem(message.imageName);
      const extension = parseImageExtension(message.extension);
      if (!extension) throw new Error('Unsupported image extension.');
      const fileName = requireAssetFileName(`${imageName}.${extension}`);
      const imageUri = containedChildUri(imagesDir, fileName);
      const imageBuffer = Buffer.from(message.imageData, 'base64');
      if (!await writeExclusive(imageUri, imageBuffer)) {
        vscode.window.showErrorMessage(`File already exists: ${fileName}`);
        return;
      }

      // Convert to webview URI for display
      const webviewUri = webview.asWebviewUri(imageUri);
      const relativePath = buildPortableAssetPath('images', fileName);

      webview.postMessage({
        type: 'imageSaved',
        imagePath: relativePath, // relative path for JSON storage
        webviewUri: webviewUri.toString(), // webview URI for display
        imageName,
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
      const drawioDir = await prepareManagedDirectory(documentDir, 'drawio');

      // Create empty draw.io SVG file
      const requestedName = requireAssetStem(message.fileName);
      const fileName = requireDrawioFileName(`${requestedName}.drawio.svg`);
      const drawioUri = containedChildUri(drawioDir, fileName);

      if (!await writeExclusive(drawioUri, new Uint8Array(0))) {
        vscode.window.showErrorMessage(`File already exists: ${fileName}`);
        return;
      }

      // 빈 파일로 생성 — draw.io extension이 열 때 빈 캔버스로 초기화함
      // Convert to webview URI for display
      const webviewUri = webview.asWebviewUri(drawioUri);
      const relativePath = buildPortableAssetPath('drawio', fileName);

      webview.postMessage({
        type: 'drawioCreated',
        drawioPath: relativePath, // relative path for JSON storage
        webviewUri: webviewUri.toString(), // webview URI for display
        fileName: requestedName,
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
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const parsed = parsePortableAssetPath(message.drawioPath, 'drawio');
      if (!parsed || !parsed.fileName.toLowerCase().endsWith('.drawio.svg')) {
        throw new Error('Draw.io path is invalid or outside the document drawio directory.');
      }
      const drawioUri = containedPortableAssetUri(documentDir, parsed.path);
      await assertCanonicalContained(vscode.Uri.joinPath(documentDir, 'drawio'), drawioUri);

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
      const fileName = requireDrawioFileName(sourceUri.path.split('/').pop() || 'diagram.drawio.svg');

      // Verify it's a .drawio.svg file
      if (!fileName.includes('.drawio.svg')) {
        vscode.window.showWarningMessage(
          'Please select a .drawio.svg file. Regular SVG files are not supported.'
        );
        return;
      }

      // Create drawio directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const drawioDir = await prepareManagedDirectory(documentDir, 'drawio');

      // Check if the selected file is already in the drawio directory
      const sourceParentPath = sourceUri.path.substring(0, sourceUri.path.lastIndexOf('/'));
      const drawioDirPath = drawioDir.path;
      const isAlreadyInDrawioDir = sourceParentPath === drawioDirPath;

      let finalFileName = fileName;
      let targetUri = sourceUri; // Default to source if already in drawio dir

      if (isAlreadyInDrawioDir) {
        await assertCanonicalContained(drawioDir, sourceUri);
        // File is already in drawio directory, just reference it
        finalFileName = fileName;
        targetUri = sourceUri;
        vscode.window.showInformationMessage(`Referencing existing diagram: ${finalFileName}`);
      } else {
        // File is external, copy it to drawio directory
        // Generate unique filename if file already exists
        let counter = 1;
        targetUri = containedChildUri(drawioDir, finalFileName);

        while (true) {
          try {
            await vscode.workspace.fs.stat(targetUri);
            // File exists, try with counter
            const baseName = fileName.replace('.drawio.svg', '');
            finalFileName = `${baseName}-${counter}.drawio.svg`;
            targetUri = containedChildUri(drawioDir, finalFileName);
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
      const relativePath = buildPortableAssetPath('drawio', finalFileName);

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
      const fileName = requireImageFileName(sourceUri.path.split('/').pop() || 'image.png');

      // Check if it's a draw.io file - those should use "Insert Draw.io" instead
      if (fileName.includes('.drawio.')) {
        vscode.window.showWarningMessage(
          'Draw.io files should be inserted using the "Insert Draw.io" button, not "Insert Image".'
        );
        return;
      }

      // Create images directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const imagesDir = await prepareManagedDirectory(documentDir, 'images');

      // Check if the selected file is already in the images directory
      const sourceParentPath = sourceUri.path.substring(0, sourceUri.path.lastIndexOf('/'));
      const imagesDirPath = imagesDir.path;
      const isAlreadyInImagesDir = sourceParentPath === imagesDirPath;

      let finalFileName = fileName;
      let targetUri = sourceUri; // Default to source if already in images dir

      if (isAlreadyInImagesDir) {
        await assertCanonicalContained(imagesDir, sourceUri);
        // File is already in images directory, just reference it
        finalFileName = fileName;
        targetUri = sourceUri;
        vscode.window.showInformationMessage(`Referencing existing image: ${finalFileName}`);
      } else {
        // File is external, copy it to images directory
        // Generate unique filename if file already exists
        let counter = 1;
        targetUri = containedChildUri(imagesDir, finalFileName);

        while (true) {
          try {
            await vscode.workspace.fs.stat(targetUri);
            // File exists, try with counter
            const nameParts = fileName.split('.');
            const ext = nameParts.pop();
            const baseName = nameParts.join('.');
            finalFileName = `${baseName}-${counter}.${ext}`;
            targetUri = containedChildUri(imagesDir, finalFileName);
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
      const relativePath = buildPortableAssetPath('images', finalFileName);

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
      const fileName = requireImageFileName(sourceUri.path.split('/').pop() || 'image.png');

      // Check if it's a draw.io file - those cannot be used to replace regular images
      if (fileName.includes('.drawio.')) {
        vscode.window.showWarningMessage(
          'Draw.io files should be inserted using the "Insert Draw.io" button, not used to replace images.'
        );
        return;
      }

      // Create images directory next to the .sdoc file
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const imagesDir = await prepareManagedDirectory(documentDir, 'images');

      // Generate unique filename if file already exists
      let finalFileName = fileName;
      let counter = 1;
      let targetUri = containedChildUri(imagesDir, finalFileName);

      while (true) {
        try {
          await vscode.workspace.fs.stat(targetUri);
          // File exists, try with counter
          const nameParts = fileName.split('.');
          const ext = nameParts.pop();
          const baseName = nameParts.join('.');
          finalFileName = `${baseName}-${counter}.${ext}`;
          targetUri = containedChildUri(imagesDir, finalFileName);
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
      const relativePath = buildPortableAssetPath('images', finalFileName);

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
