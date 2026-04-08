import * as vscode from 'vscode';
import * as path from 'path';

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
  node: Record<string, unknown>,
  documentDir: vscode.Uri,
  webview: vscode.Webview,
): Record<string, unknown> {
  if (!node || typeof node !== 'object') return node;

  const cloned: Record<string, unknown> = Array.isArray(node) ? [...node] as unknown as Record<string, unknown> : { ...node };

  if (cloned.type === 'image') {
    const attrs = cloned.attrs as Record<string, unknown> | undefined;
    const src = attrs?.src as string | undefined;
    if (src?.startsWith('./')) {
      const imagePath = src.replace('./', '');
      const imageUri = vscode.Uri.joinPath(documentDir, imagePath);
      const webviewUri = webview.asWebviewUri(imageUri);
      cloned.attrs = { ...attrs, src: webviewUri.toString() };
    }
  }

  if (Array.isArray(cloned.content)) {
    cloned.content = (cloned.content as Record<string, unknown>[]).map(
      (child) => convertImagePathsToWebviewUris(child, documentDir, webview),
    );
  }

  return cloned;
}

export function convertWebviewUrisToRelativePaths(
  node: Record<string, unknown>,
): Record<string, unknown> {
  if (!node || typeof node !== 'object') return node;

  const cloned: Record<string, unknown> = Array.isArray(node) ? [...node] as unknown as Record<string, unknown> : { ...node };

  if (cloned.type === 'image') {
    const attrs = cloned.attrs as Record<string, unknown> | undefined;
    const src = attrs?.src as string | undefined;
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

  if (Array.isArray(cloned.content)) {
    cloned.content = (cloned.content as Record<string, unknown>[]).map(
      (child) => convertWebviewUrisToRelativePaths(child),
    );
  }

  return cloned;
}

export async function embedImagesAsBase64(
  node: Record<string, unknown>,
  documentDir: string,
): Promise<Record<string, unknown>> {
  if (!node || typeof node !== 'object') return node;

  const cloned: Record<string, unknown> = Array.isArray(node) ? [...node] as unknown as Record<string, unknown> : { ...node };

  if (cloned.type === 'image') {
    const attrs = cloned.attrs as Record<string, unknown> | undefined;
    const src = attrs?.src as string | undefined;
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

  if (Array.isArray(cloned.content)) {
    cloned.content = await Promise.all(
      (cloned.content as Record<string, unknown>[]).map(
        (child) => embedImagesAsBase64(child, documentDir),
      ),
    );
  }

  return cloned;
}
