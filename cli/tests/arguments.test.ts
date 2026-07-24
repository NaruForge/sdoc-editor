import { describe, expect, it } from 'vitest';
import { ArgumentError, parseArguments } from '../src/arguments.js';

describe('parseArguments', () => {
  it('parses Korean rename text without changing it', () => {
    const result = parseArguments([
      'rename-heading',
      '문서.sdoc',
      '--id',
      'intro',
      '--title',
      '시험 결과',
      '--expected-revision',
      'sha256:abc',
    ]);
    expect(result.title).toBe('시험 결과');
    expect(result.write).toBe(false);
  });

  it('requires operation input for apply', () => {
    expect(() => parseArguments(['apply', 'a.sdoc'])).toThrowError(ArgumentError);
  });

  it('rejects write and dry-run together', () => {
    expect(() => parseArguments(['apply', 'a.sdoc', '--operations', '-', '--write', '--dry-run']))
      .toThrowError(/cannot be used together/);
  });
});
