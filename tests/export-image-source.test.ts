import { describe, expect, it } from 'vitest';
import {
  normalizeEmbeddedImageDataUrl,
  normalizeHttpImageUrl,
} from '../shared/security/exportImageSource';

describe('export image source boundary', () => {
  it('accepts bounded base64 image data and rejects active or malformed data URLs', () => {
    expect(normalizeEmbeddedImageDataUrl('data:image/png;base64,aGVsbG8='))
      .toBe('data:image/png;base64,aGVsbG8=');
    expect(normalizeEmbeddedImageDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeUndefined();
    expect(normalizeEmbeddedImageDataUrl('data:image/svg+xml,<svg onload="x"/>')).toBeUndefined();
  });

  it('canonicalizes only credential-free HTTP(S) URLs', () => {
    expect(normalizeHttpImageUrl('https://example.com/logo.png')).toBe('https://example.com/logo.png');
    expect(normalizeHttpImageUrl('https://user:pass@example.com/logo.png')).toBeUndefined();
    expect(normalizeHttpImageUrl('http" onerror="alert(1)')).toBeUndefined();
    expect(normalizeHttpImageUrl('javascript:alert(1)')).toBeUndefined();
  });
});
