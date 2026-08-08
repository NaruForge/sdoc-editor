import { describe, expect, it } from 'vitest';
import { fingerprintBookExportIntegrity, type BookExportIntegrityInput } from '../shared/book';

const input: BookExportIntegrityInput = {
  canonicalRoot: 'C:/book',
  manifestCanonicalPath: 'C:/book/guide.sdocbook',
  manifestRevision: 4,
  manifestHash: 'sha256:manifest',
  settingsFingerprint: 'sha256:settings',
  files: [
    {
      kind: 'chapter', bookPath: './chapter.sdoc', canonicalPath: 'C:/book/chapter.sdoc',
      byteLength: 10, contentHash: 'sha256:chapter', openBufferRevision: 7,
    },
    {
      kind: 'css', bookPath: './styles/book.css', canonicalPath: 'C:/book/styles/book.css',
      byteLength: 11, contentHash: 'sha256:css',
    },
    {
      kind: 'image', bookPath: './images/figure.png', canonicalPath: 'C:/book/images/figure.png',
      byteLength: 12, contentHash: 'sha256:image',
    },
  ],
};

describe('Book export authoritative integrity fingerprint', () => {
  it.each([
    ['manifest bytes', { manifestHash: 'sha256:changed' }],
    ['manifest revision', { manifestRevision: 5 }],
    ['settings profile', { settingsFingerprint: 'sha256:changed' }],
  ] as const)('changes when %s changes', (_label, change) => {
    expect(fingerprintBookExportIntegrity({ ...input, ...change }))
      .not.toBe(fingerprintBookExportIntegrity(input));
  });

  it.each([
    ['chapter bytes', 0, { contentHash: 'sha256:changed' }],
    ['open-buffer revision', 0, { openBufferRevision: 8 }],
    ['CSS bytes', 1, { contentHash: 'sha256:changed' }],
    ['image bytes', 2, { contentHash: 'sha256:changed' }],
    ['canonical target', 2, { canonicalPath: 'C:/outside/figure.png' }],
  ] as const)('changes when %s changes', (_label, index, change) => {
    const files = input.files.map((file, candidate) => candidate === index
      ? { ...file, ...change }
      : file);
    expect(fingerprintBookExportIntegrity({ ...input, files }))
      .not.toBe(fingerprintBookExportIntegrity(input));
  });

  it('is independent of asynchronous chapter capture order', () => {
    expect(fingerprintBookExportIntegrity({ ...input, files: [...input.files].reverse() }))
      .toBe(fingerprintBookExportIntegrity(input));
  });
});
