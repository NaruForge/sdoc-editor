import * as vscode from 'vscode';
import * as path from 'path';
import { realpath } from 'fs/promises';
import type { TiptapNode } from '../../shared/types';
import {
  parseContainedRelativeAssetPath,
  parsePortableAssetPath,
} from '../../shared/security/portableAssets';

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
    const portable = parsePortableAssetPath(src);
    if (portable) {
      const imageUri = vscode.Uri.joinPath(documentDir, portable.directory, ...portable.segments);
      const webviewUri = webview.asWebviewUri(imageUri);
      cloned.attrs = { ...attrs, src: webviewUri.toString(), relativePath: portable.path };
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
    const explicitPath = parsePortableAssetPath(attrs?.relativePath);
    if (explicitPath) {
      cloned.attrs = { ...attrs, src: explicitPath.path };
    } else if (src && (src.includes('vscode-webview') || src.includes('vscode-resource'))) {
      let recovered: ReturnType<typeof parsePortableAssetPath>;
      try {
        const pathname = decodeURIComponent(new URL(src).pathname);
        const matches = ['/images/', '/drawio/']
          .map((marker) => ({ marker, index: pathname.lastIndexOf(marker) }))
          .filter(({ index }) => index >= 0)
          .sort((left, right) => right.index - left.index);
        if (matches[0]) {
          recovered = parsePortableAssetPath(`.${pathname.slice(matches[0].index)}`);
        }
      } catch {
        recovered = undefined;
      }
      cloned.attrs = { ...attrs, src: recovered?.path ?? '' };
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
    const isExternal = src?.startsWith('data:') || src?.startsWith('http://') || src?.startsWith('https://');
    if (src && !isExternal) {
      const segments = parseContainedRelativeAssetPath(src);
      if (!segments || !segments.some((segment) => segment === 'images' || segment === 'drawio')) {
        throw new Error(`Export blocked unsafe image path: ${src}`);
      }
      const root = await realpath(path.resolve(documentDir));
      const imagePath = await realpath(path.resolve(root, ...segments));
      const relative = path.relative(root, imagePath);
      if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`Export blocked image outside the document root: ${src}`);
      }
      const imageUri = vscode.Uri.file(imagePath);
      const imageData = await vscode.workspace.fs.readFile(imageUri);
      const base64 = Buffer.from(imageData).toString('base64');
      const ext = path.extname(src).toLowerCase().replace('.', '');
      const mime = MIME_MAP[ext];
      if (!mime) throw new Error(`Export blocked unsupported image type: ${src}`);
      cloned.attrs = { ...attrs, src: `data:${mime};base64,${base64}` };
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
