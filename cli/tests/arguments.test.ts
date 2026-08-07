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

  it('parses document-title updates and discard-formatting without changing Korean text', () => {
    const result = parseArguments([
      'set-document-title',
      '문서.sdoc',
      '--id',
      'document-title',
      '--title',
      '시험 결과',
      '--expected-revision',
      'sha256:abc',
      '--discard-formatting',
      '--dry-run',
    ]);
    expect(result).toMatchObject({
      kind: 'command',
      command: 'set-document-title',
      title: '시험 결과',
      discardFormatting: true,
      dryRun: true,
      write: false,
    });
  });

  it('parses metadata-only document-title updates without an id', () => {
    expect(parseArguments([
      'set-document-title',
      'document.sdoc',
      '--title',
      '메타데이터 제목',
      '--expected-revision',
      'sha256:abc',
    ])).toMatchObject({
      kind: 'command',
      command: 'set-document-title',
      title: '메타데이터 제목',
      expectedRevision: 'sha256:abc',
      discardFormatting: false,
    });
  });

  it('exposes discard-formatting on rename-heading', () => {
    expect(parseArguments([
      'rename-heading',
      'document.sdoc',
      '--id',
      'intro',
      '--title',
      'Plain title',
      '--expected-revision',
      'sha256:abc',
      '--discard-formatting',
    ])).toMatchObject({
      kind: 'command',
      command: 'rename-heading',
      discardFormatting: true,
    });
  });

  it('parses canonical slash target paths and rejects conflicts', () => {
    expect(parseArguments([
      'inspect',
      'document.sdoc',
      '--target-path',
      '/1/0',
    ])).toMatchObject({
      kind: 'command',
      targetPath: [1, 0],
    });
    expect(() => parseArguments([
      'inspect',
      'document.sdoc',
      '--target-id',
      'intro',
      '--target-path',
      '/1',
    ])).toThrowError(/cannot be used together/);
  });

  it.each(['1/0', '/', '/1/', '/1//0', '/-1', '/01', '/a', '/9007199254740992'])(
    'rejects malformed target path %s with the stable diagnostic',
    (targetPath) => {
      try {
        parseArguments(['inspect', 'document.sdoc', '--target-path', targetPath]);
        throw new Error('expected parseArguments to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ArgumentError);
        expect((error as ArgumentError).code).toBe('CLI_INVALID_TARGET_PATH');
      }
    },
  );

  it('rejects a target path deeper than the document contract limit', () => {
    const targetPath = `/${Array.from({ length: 129 }, () => '0').join('/')}`;
    try {
      parseArguments(['inspect', 'document.sdoc', '--target-path', targetPath]);
      throw new Error('expected parseArguments to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ArgumentError);
      expect((error as ArgumentError).code).toBe('CLI_INVALID_TARGET_PATH');
    }
  });

  it.each([
    ['missing title', ['set-document-title', 'document.sdoc', '--expected-revision', 'sha256:abc']],
    ['missing revision', ['set-document-title', 'document.sdoc', '--title', 'Title']],
  ])('requires the document title and revision when %s', (_label, argv) => {
    expect(() => parseArguments(argv)).toThrowError(ArgumentError);
    try {
      parseArguments(argv);
    } catch (error) {
      expect((error as ArgumentError).code).toBe('CLI_MISSING_SET_DOCUMENT_TITLE_ARGUMENT');
    }
  });

  it('parses every explicit inspect projection option', () => {
    expect(parseArguments([
      'inspect',
      'document.sdoc',
      '--projection',
      'catalog',
      '--catalog',
      'outline',
      '--limit',
      '25',
      '--cursor',
      'opaque-cursor',
      '--max-bytes',
      '4096',
      '--max-summary-length',
      '80',
      '--expected-revision',
      `sha256:${'a'.repeat(64)}`,
    ])).toMatchObject({
      kind: 'command',
      command: 'inspect',
      projection: 'catalog',
      catalog: 'outline',
      limit: 25,
      cursor: 'opaque-cursor',
      maxBytes: 4096,
      maxSummaryLength: 80,
      expectedRevision: `sha256:${'a'.repeat(64)}`,
    });

    expect(parseArguments([
      'inspect',
      'document.sdoc',
      '--projection',
      'section',
      '--target-path',
      '/2',
      '--max-nodes',
      '12',
    ])).toMatchObject({
      projection: 'section',
      targetPath: [2],
      maxNodes: 12,
    });
  });

  it.each([
    ['--limit', '0'],
    ['--limit', '-1'],
    ['--limit', '1.5'],
    ['--limit', '1e3'],
    ['--max-bytes', '+1'],
    ['--max-nodes', '01'],
    ['--max-summary-length', '9007199254740992'],
  ])('rejects invalid positive integer form %s %s with a stable diagnostic', (flag, value) => {
    try {
      parseArguments(['inspect', 'document.sdoc', '--projection', 'document', flag, value]);
      throw new Error('expected parseArguments to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ArgumentError);
      expect((error as ArgumentError).code).toBe('CLI_INVALID_POSITIVE_INTEGER');
    }
  });

  it.each([
    ['read option without projection', ['inspect', 'document.sdoc', '--cursor', 'cursor'], 'CLI_PROJECTION_REQUIRED'],
    ['catalog with target', ['inspect', 'document.sdoc', '--projection', 'catalog', '--target-id', 'intro'], 'CLI_PROJECTION_FORBIDS_TARGET'],
    ['catalog with max nodes', ['inspect', 'document.sdoc', '--projection', 'catalog', '--max-nodes', '2'], 'CLI_PROJECTION_OPTION_NOT_SUPPORTED'],
    ['target without target', ['inspect', 'document.sdoc', '--projection', 'target'], 'CLI_PROJECTION_REQUIRES_TARGET'],
    ['target with cursor', ['inspect', 'document.sdoc', '--projection', 'target', '--target-id', 'intro', '--cursor', 'cursor'], 'CLI_PROJECTION_OPTION_NOT_SUPPORTED'],
    ['section without target', ['inspect', 'document.sdoc', '--projection', 'section'], 'CLI_PROJECTION_REQUIRES_TARGET'],
    ['section with catalog', ['inspect', 'document.sdoc', '--projection', 'section', '--target-id', 'intro', '--catalog', 'blocks'], 'CLI_PROJECTION_OPTION_NOT_SUPPORTED'],
    ['document with target', ['inspect', 'document.sdoc', '--projection', 'document', '--target-path', '/0'], 'CLI_PROJECTION_FORBIDS_TARGET'],
    ['document with limit', ['inspect', 'document.sdoc', '--projection', 'document', '--limit', '2'], 'CLI_PROJECTION_OPTION_NOT_SUPPORTED'],
  ])('rejects the projection combination matrix: %s', (_label, argv, code) => {
    try {
      parseArguments(argv);
      throw new Error('expected parseArguments to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ArgumentError);
      expect((error as ArgumentError).code).toBe(code);
    }
  });

  it('rejects discard-formatting without a synchronized title H1 id', () => {
    try {
      parseArguments([
        'set-document-title',
        'document.sdoc',
        '--title',
        'Title',
        '--expected-revision',
        'sha256:abc',
        '--discard-formatting',
      ]);
      throw new Error('expected parseArguments to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ArgumentError);
      expect((error as ArgumentError).code).toBe('CLI_OPTION_REQUIRES_ID');
    }
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
    expect(parseArguments(['help', 'capabilities']))
      .toEqual({ kind: 'help', command: 'capabilities' });
    expect(parseArguments(['capabilities', '--help']))
      .toEqual({ kind: 'help', command: 'capabilities' });
    expect(parseArguments(['create', '--help'])).toEqual({ kind: 'help', command: 'create' });
    expect(parseArguments(['inspect', 'document.sdoc', '--help']))
      .toEqual({ kind: 'help', command: 'inspect' });
  });

  it('parses capabilities as a pathless command and keeps --json as an option', () => {
    expect(parseArguments(['capabilities', '--json'])).toEqual({
      kind: 'command',
      command: 'capabilities',
      output: 'json',
      write: false,
      dryRun: false,
      upgradeLegacy: false,
      discardFormatting: false,
    });
    expect(parseArguments(['capabilities', '--human'])).toMatchObject({
      kind: 'command',
      command: 'capabilities',
      output: 'human',
    });
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
    expect(() => parseArguments(['capabilities', '--write']))
      .toThrowError(/does not support --write/);
  });
});
