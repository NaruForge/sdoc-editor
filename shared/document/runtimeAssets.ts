import type { TiptapNode } from '../types';

export function isPortableAssetPath(value: string): boolean {
  if (!value.startsWith('./') || value.includes('\\')) return false;
  const segments = value.slice(2).split('/');
  return segments.length >= 2
    && (segments[0] === 'images' || segments[0] === 'drawio')
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export async function hydrateDocumentAssets(
  node: TiptapNode,
  resolveAsset: (relativePath: string) => Promise<string>,
): Promise<TiptapNode> {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (node.type === 'image' && attrs && typeof attrs.src === 'string'
    && isPortableAssetPath(attrs.src)) {
    const relativePath = attrs.src;
    attrs.src = await resolveAsset(relativePath);
    attrs.relativePath = relativePath;
  }
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? {
      content: await Promise.all(node.content.map((child) => hydrateDocumentAssets(child, resolveAsset))),
    } : {}),
  };
}

/**
 * Remove host-only image state before a document crosses the persistence boundary.
 * Runtime URLs are useful to render an asset, but the persisted contract only keeps
 * the portable document-relative path in `src`.
 */
export function dehydrateDocumentAssets(node: TiptapNode): TiptapNode {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (node.type === 'image' && attrs) {
    const relativePath = typeof attrs.relativePath === 'string' ? attrs.relativePath : undefined;
    if (relativePath && isPortableAssetPath(relativePath)) {
      attrs.src = relativePath;
    } else if (typeof attrs.src === 'string' && /^(?:asset:|https?:\/\/asset\.localhost(?:\/|$))/i.test(attrs.src)) {
      attrs.src = '';
    }
    delete attrs.relativePath;
    delete attrs.webviewUri;
    delete attrs.assetUrl;
  }

  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(dehydrateDocumentAssets) } : {}),
  };
}
