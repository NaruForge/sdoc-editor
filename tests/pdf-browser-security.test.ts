import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PDF browser boundary', () => {
  it('keeps the Chromium sandbox enabled for document rendering', () => {
    const source = readFileSync(
      new URL('../src/utils/browserDetect.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain("'--no-sandbox'");
  });

  it('passes export cancellation into the Chromium child process', () => {
    const source = readFileSync(
      new URL('../src/utils/browserDetect.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('{ timeout: 60_000, signal }');
    expect(source).toContain('signal?.aborted');
  });
});
