import { describe, expect, it, vi } from 'vitest';
import {
  buildPortableAssetPath,
  chooseExclusiveAssetName,
  parseAssetFileName,
  parseAssetStem,
  parseContainedRelativeAssetPath,
  parseImageExtension,
  parsePortableAssetPath,
} from '../shared/security/portableAssets';

describe('portable asset security', () => {
  it('accepts contained portable and export-relative asset paths', () => {
    expect(parsePortableAssetPath('./images/figures/system.png')).toEqual({
      directory: 'images',
      segments: ['figures', 'system.png'],
      fileName: 'system.png',
      path: './images/figures/system.png',
    });
    expect(parsePortableAssetPath('./drawio/system.drawio.svg', 'drawio')?.fileName)
      .toBe('system.drawio.svg');
    expect(parseContainedRelativeAssetPath('chapters/intro/images/system.png')).toEqual([
      'chapters', 'intro', 'images', 'system.png',
    ]);
  });

  it.each([
    '../secret.png',
    './images/../secret.png',
    './images\\secret.png',
    '/images/secret.png',
    'C:/secret.png',
    './images/system.png?token=secret',
    './images/system.png#fragment',
    './assets/system.png',
  ])('rejects non-portable or escaping asset path %s', (value) => {
    expect(parsePortableAssetPath(value)).toBeUndefined();
  });

  it.each([
    '../secret.png',
    'chapters/../../secret.png',
    'chapters\\secret.png',
    '/absolute.png',
    'C:/secret.png',
    'https://example.com/image.png',
  ])('rejects export paths outside the document root: %s', (value) => {
    expect(parseContainedRelativeAssetPath(value)).toBeUndefined();
  });

  it('validates portable names and image extensions without rewriting hostile input', () => {
    expect(parseAssetStem('시스템 구성도 v2')).toBe('시스템 구성도 v2');
    expect(parseAssetFileName('시스템 구성도 v2.png')).toBe('시스템 구성도 v2.png');
    expect(parseAssetStem('../outside')).toBeUndefined();
    expect(parseAssetFileName('CON.png')).toBeUndefined();
    expect(parseAssetFileName('trailing.')).toBeUndefined();
    expect(parseImageExtension('SVG+XML')).toBe('svg');
    expect(parseImageExtension('exe')).toBeUndefined();
    expect(buildPortableAssetPath('images', 'system.png')).toBe('./images/system.png');
  });

  it('chooses a collision-free name through an exclusive create callback', async () => {
    const create = vi.fn(async (fileName: string) => fileName === 'system-2.png');

    await expect(chooseExclusiveAssetName('system.png', create)).resolves.toBe('system-2.png');
    expect(create.mock.calls.map(([fileName]) => fileName)).toEqual([
      'system.png', 'system-1.png', 'system-2.png',
    ]);
  });
});
