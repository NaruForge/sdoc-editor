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
    expect(result.kind).toBe('command');
    if (result.kind !== 'command') throw new Error('expected command');
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

  it('routes top-level and command help before document validation', () => {
    expect(parseArguments(['--help'])).toEqual({ kind: 'help' });
    expect(parseArguments(['help', 'inspect'])).toEqual({ kind: 'help', command: 'inspect' });
    expect(parseArguments(['create', '--help'])).toEqual({ kind: 'help', command: 'create' });
    expect(parseArguments(['inspect', 'document.sdoc', '--help']))
      .toEqual({ kind: 'help', command: 'inspect' });
  });

  it('does not treat a single-dash option value as command help', () => {
    const result = parseArguments([
      'rename-heading',
      'document.sdoc',
      '--id',
      'intro',
      '--title',
      '-h',
      '--expected-revision',
      `sha256:${'0'.repeat(64)}`,
    ]);
    expect(result).toMatchObject({ kind: 'command', title: '-h' });
  });

  it('parses create defaults and human output', () => {
    expect(parseArguments([
      'create',
      'report.sdoc',
      '--template',
      'builtin:technical-report',
      '--human',
      '--dry-run',
    ])).toMatchObject({
      kind: 'command',
      command: 'create',
      documentPath: 'report.sdoc',
      template: 'builtin:technical-report',
      output: 'human',
      dryRun: true,
    });
  });

  it('rejects output conflicts, duplicate options, and command-incompatible options', () => {
    expect(() => parseArguments(['inspect', 'a.sdoc', '--json', '--human']))
      .toThrowError(/cannot be used together/);
    expect(() => parseArguments(['validate', 'a.sdoc', '--human', '--human']))
      .toThrowError(/only be specified once/);
    expect(() => parseArguments(['inspect', 'a.sdoc', '--operations', 'ops.json']))
      .toThrowError(/does not support --operations/);
    expect(() => parseArguments(['create', 'a.sdoc', '--write']))
      .toThrowError(/does not support --write/);
  });
});
