import * as vscode from 'vscode';
import * as path from 'path';
import { readFile, realpath, stat } from 'fs/promises';
import type { TiptapNode } from '../../shared/types';
import {
  parseContainedRelativeAssetPath,
  parsePortableAssetPath,
} from '../../shared/security/portableAssets';
import {
  assertEmbeddedAssetBudget,
  RESOURCE_LOAD_CONCURRENCY,
} from '../../shared/resourceLimits';

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
  signal?: AbortSignal,
): Promise<TiptapNode> {
  signal?.throwIfAborted();
  type PendingReference = { cloned: TiptapNode; src: string };
  const pending: PendingReference[] = [];
  const cloneTree = (current: TiptapNode): TiptapNode => {
    const cloned: TiptapNode = { ...current, attrs: current.attrs ? { ...current.attrs } : undefined };
    if (cloned.type === 'image') {
      const src = typeof cloned.attrs?.src === 'string' ? cloned.attrs.src : undefined;
      const isExternal = src?.startsWith('data:') || src?.startsWith('http://') || src?.startsWith('https://');
      if (src && !isExternal) pending.push({ cloned, src });
    }
    if (current.content) cloned.content = current.content.map(cloneTree);
    return cloned;
  };

  const cloned = cloneTree(node);
  signal?.throwIfAborted();
  assertEmbeddedAssetBudget([], pending.length);
  if (pending.length === 0) return cloned;

  const root = await realpath(path.resolve(documentDir));
  signal?.throwIfAborted();
  const grouped = new Map<string, { imagePath: string; mime: string; references: TiptapNode[] }>();
  for (const { cloned: imageNode, src } of pending) {
    signal?.throwIfAborted();
    const segments = parseContainedRelativeAssetPath(src);
    if (!segments || !segments.some((segment) => segment === 'images' || segment === 'drawio')) {
      throw new Error(`Export blocked unsafe image path: ${src}`);
    }
    const imagePath = await realpath(path.resolve(root, ...segments));
    signal?.throwIfAborted();
    const relative = path.relative(root, imagePath);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Export blocked image outside the document root: ${src}`);
    }
    const ext = path.extname(src).toLowerCase().replace('.', '');
    const mime = MIME_MAP[ext];
    if (!mime) throw new Error(`Export blocked unsupported image type: ${src}`);
    const existing = grouped.get(imagePath);
    if (existing) existing.references.push(imageNode);
    else grouped.set(imagePath, { imagePath, mime, references: [imageNode] });
  }

  const assets = [...grouped.values()];
  const mapBounded = async <T, R>(values: readonly T[], task: (value: T) => Promise<R>): Promise<R[]> => {
    const results = new Array<R>(values.length);
    let next = 0;
    const worker = async () => {
      while (true) {
        signal?.throwIfAborted();
        if (next >= values.length) return;
        const index = next++;
        results[index] = await task(values[index]);
        signal?.throwIfAborted();
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(RESOURCE_LOAD_CONCURRENCY, values.length) },
      () => worker(),
    ));
    return results;
  };
  const sizes = await mapBounded(assets, async (asset) => {
    const info = await stat(asset.imagePath);
    if (!info.isFile()) throw new Error(`Export blocked non-file image: ${asset.imagePath}`);
    return info.size;
  });
  assertEmbeddedAssetBudget(sizes, pending.length);

  const actualSizes: number[] = [];
  await mapBounded(assets, async (asset) => {
    const imageData = await readFile(asset.imagePath, { signal });
    signal?.throwIfAborted();
    actualSizes.push(imageData.byteLength);
    assertEmbeddedAssetBudget(actualSizes, pending.length);
    const dataUrl = `data:${asset.mime};base64,${imageData.toString('base64')}`;
    for (const reference of asset.references) {
      reference.attrs = { ...reference.attrs, src: dataUrl };
    }
  });
  return cloned;
}
