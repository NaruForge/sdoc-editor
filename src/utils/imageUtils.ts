import * as vscode from 'vscode';
import * as path from 'path';
import type { TiptapNode } from '../../shared/types';

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

export function convertImagePathsToWebviewUris(
  node: TiptapNode,
  documentDir: vscode.Uri,
  webview: vscode.Webview,
): TiptapNode {
  const cloned: TiptapNode = { ...node };

  if (cloned.type === 'image') {
    const attrs = cloned.attrs;
    const src = typeof attrs?.src === 'string' ? attrs.src : undefined;
    if (src?.startsWith('./')) {
      const imagePath = src.replace('./', '');
      const imageUri = vscode.Uri.joinPath(documentDir, imagePath);
      const webviewUri = webview.asWebviewUri(imageUri);
      cloned.attrs = { ...attrs, src: webviewUri.toString() };
    }
  }

  if (cloned.content) {
    cloned.content = cloned.content.map(
      (child) => convertImagePathsToWebviewUris(child, documentDir, webview),
    );
  }

  return cloned;
}

export function convertWebviewUrisToRelativePaths(
  node: TiptapNode,
): TiptapNode {
  const cloned: TiptapNode = { ...node };

  if (cloned.type === 'image') {
    const attrs = cloned.attrs;
    const src = typeof attrs?.src === 'string' ? attrs.src : undefined;
    if (src && (src.includes('vscode-webview') || src.includes('vscode-resource'))) {
      const imageMatch = src.match(/images\/([^?#]+)/);
      const drawioMatch = src.match(/drawio\/([^?#]+)/);
      if (imageMatch) {
        cloned.attrs = { ...attrs, src: `./images/${imageMatch[1]}` };
      } else if (drawioMatch) {
        cloned.attrs = { ...attrs, src: `./drawio/${drawioMatch[1]}` };
      }
    }
  }

  if (cloned.content) {
    cloned.content = cloned.content.map(
      (child) => convertWebviewUrisToRelativePaths(child),
    );
  }

  return cloned;
}

export async function embedImagesAsBase64(
  node: TiptapNode,
  documentDir: string,
): Promise<TiptapNode> {
  const cloned: TiptapNode = { ...node };

  if (cloned.type === 'image') {
    const attrs = cloned.attrs;
    const src = typeof attrs?.src === 'string' ? attrs.src : undefined;
    if (src && !src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
      try {
        const imagePath = path.resolve(documentDir, src);
        const imageUri = vscode.Uri.file(imagePath);
        const imageData = await vscode.workspace.fs.readFile(imageUri);
        const base64 = Buffer.from(imageData).toString('base64');
        const ext = path.extname(src).toLowerCase().replace('.', '');
        const mime = MIME_MAP[ext] || 'application/octet-stream';
        cloned.attrs = { ...attrs, src: `data:${mime};base64,${base64}` };
      } catch {
        // intentionally ignored: keep original src if file not found
      }
    }
  }

  if (cloned.content) {
    cloned.content = await Promise.all(
      cloned.content.map(
        (child) => embedImagesAsBase64(child, documentDir),
      ),
    );
  }

  return cloned;
}
