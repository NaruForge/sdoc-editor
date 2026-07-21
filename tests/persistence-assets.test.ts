import { describe, expect, it } from 'vitest';
import { dehydrateDocumentAssets, hydrateDocumentAssets } from '../shared/document/runtimeAssets';

describe('document asset persistence boundary', () => {
  it('hydrates and dehydrates nested portable assets symmetrically', async () => {
    const original = {
      type: 'doc',
      content: [{ type: 'blockquote', content: [{ type: 'image', attrs: { src: './drawio/a.drawio.svg' } }] }],
    };
    const hydrated = await hydrateDocumentAssets(original, async (path) => `asset://${path}`);
    expect(hydrated.content?.[0].content?.[0].attrs).toMatchObject({
      src: 'asset://./drawio/a.drawio.svg', relativePath: './drawio/a.drawio.svg',
    });
    expect(dehydrateDocumentAssets(hydrated)).toEqual(original);
  });

  it('supports safe nested asset paths but rejects traversal', async () => {
    const nested = await hydrateDocumentAssets(
      { type: 'image', attrs: { src: './images/chapter/photo.png' } },
      async (path) => `asset://${path}`,
    );
    expect(nested.attrs?.relativePath).toBe('./images/chapter/photo.png');
    const traversal = await hydrateDocumentAssets(
      { type: 'image', attrs: { src: './images/../secret.txt' } },
      async (path) => `asset://${path}`,
    );
    expect(traversal.attrs).toEqual({ src: './images/../secret.txt' });
  });

  it('persists only a portable relative image path after Tauri hydration', () => {
    const dehydrated = dehydrateDocumentAssets({
      type: 'doc',
      content: [{
        type: 'image',
        attrs: {
          id: 'figure-system',
          src: 'http://asset.localhost/C%3A%5Cdocs%5Cimages%5Csystem.png',
          relativePath: './images/system.png',
          caption: 'System',
        },
      }],
    });

    expect(dehydrated.content?.[0].attrs).toEqual({
      id: 'figure-system',
      src: './images/system.png',
      caption: 'System',
    });
  });

  it('does not promote a non-portable runtime path into persisted src', () => {
    const dehydrated = dehydrateDocumentAssets({
      type: 'image',
      attrs: {
        src: 'asset://runtime-only',
        relativePath: '../secret.txt',
      },
    });

    expect(dehydrated.attrs).toEqual({ src: '' });
  });
});
