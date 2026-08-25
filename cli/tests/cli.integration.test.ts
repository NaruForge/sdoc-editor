import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeRevision } from '../../shared/document/operations/index.js';
import { run } from '../src/main.js';
import { IoError } from '../src/io.js';

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ directory: string; documentPath: string; bytes: Buffer }> {
  const directory = await mkdtemp(join(tmpdir(), 'sdoc-cli-'));
  temporaryDirectories.push(directory);
  const documentPath = join(directory, '한글 문서.sdoc');
  const document = {
    sdoc: '1.0',
    meta: {
      documentId: 'doc-1',
      title: '소개',
      modified: '2025-01-01T00:00:00.000Z',
    },
    doc: {
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 1, id: 'intro' },
        content: [{ type: 'text', text: '소개' }],
      }, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Body' }],
      }],
    },
  };
  const bytes = Buffer.from(`\uFEFF${JSON.stringify(document, undefined, 4).replace(/\n/g, '\r\n')}\r\n`);
  await writeFile(documentPath, bytes);
  return { directory, documentPath, bytes };
}

async function renameRequest(directory: string, bytes: Uint8Array): Promise<string> {
  const path = join(directory, 'operations.json');
  await writeFile(path, `\uFEFF${JSON.stringify({
    contract: 'sdoc.operations/1',
    expected: { revision: computeRevision(bytes) },
    operations: [{
      op: 'renameHeading',
      target: { kind: 'id', id: 'intro' },
      title: '시험 결과',
    }],
  })}`);
  return path;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('CLI integration', () => {
  it('previews without changing document bytes and emits one JSON object', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = await renameRequest(directory, bytes);
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    const exitCode = await run(['apply', documentPath, '--operations', operationsPath, '--json']);

    expect(exitCode).toBe(0);
    expect(await readFile(documentPath)).toEqual(bytes);
    const output = JSON.parse(stdout) as Record<string, unknown>;
    expect(output).toMatchObject({ ok: true, preview: true, written: false });
    expect(output).not.toHaveProperty('envelope');
    expect(output).not.toHaveProperty('outputText');
  });

  it('writes through the guarded path while preserving source formatting', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = await renameRequest(directory, bytes);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const exitCode = await run(['apply', documentPath, '--operations', operationsPath, '--write']);
    const written = await readFile(documentPath);
    const text = written.toString('utf8');

    expect(exitCode).toBe(0);
    expect(text.startsWith('\uFEFF{\r\n    "sdoc"')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text).toContain('시험 결과');
    expect(await readFile(`${documentPath}.lock`).catch(() => undefined)).toBeUndefined();
  });

  it('preserves the original and releases the lock when replacement fails', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = await renameRequest(directory, bytes);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await run(
      ['apply', documentPath, '--operations', operationsPath, '--write'],
      {
        replaceDocument: async () => {
          throw new IoError('CLI_ATOMIC_WRITE_FAILED', 'injected replacement failure');
        },
      },
    );

    expect(exitCode).toBe(5);
    expect(await readFile(documentPath)).toEqual(bytes);
    expect(await readFile(`${documentPath}.lock`).catch(() => undefined)).toBeUndefined();
  });

  it('keeps the JSON failure shape and exit code when a lock requires manual recovery', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = await renameRequest(directory, bytes);
    const lockPath = `${documentPath}.lock`;
    const legacyOwner = '8080:legacy-token\n';
    await writeFile(lockPath, legacyOwner);
    let stdout = '';
    let stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    const exitCode = await run([
      'apply',
      documentPath,
      '--operations',
      operationsPath,
      '--write',
      '--json',
    ]);

    expect(exitCode).toBe(5);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({
      contract: 'sdoc.cli.response/1',
      ok: false,
      category: 'io',
      diagnostics: [{
        code: 'CLI_LOCK_UNAVAILABLE',
        message: expect.stringMatching(/manually only after confirming no writer is active/i),
      }],
    });
    expect(await readFile(documentPath)).toEqual(bytes);
    expect(await readFile(lockPath, 'utf8')).toBe(legacyOwner);
  });

  it('uses the documented argument-error exit code and stderr JSON', async () => {
    const { documentPath } = await fixture();
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    const exitCode = await run(['apply', documentPath]);

    expect(exitCode).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      contract: 'sdoc.cli.response/1',
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'CLI_MISSING_OPERATIONS' }],
    });
  });

  it('accepts a Korean operation request from stdin', async () => {
    const { documentPath, bytes } = await fixture();
    const request = `\uFEFF${JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes) },
      operations: [{
        op: 'renameHeading',
        target: { kind: 'id', id: 'intro' },
        title: '한글 표준 입력',
      }],
    })}`;
    let stdout = '';
    vi.spyOn(process, 'stdin', 'get')
      .mockReturnValue(Readable.from([request]) as unknown as typeof process.stdin);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    const exitCode = await run(['apply', documentPath, '--operations', '-', '--json']);

    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout) as { ok: boolean; diff: Array<{ kind: string }> };
    expect(output.ok).toBe(true);
    expect(output.diff).toContainEqual(expect.objectContaining({ kind: 'heading-renamed' }));
  });

  it('rejects malformed UTF-8 operation files before creating a lock or changing either file', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = join(directory, 'malformed-utf8.json');
    const request = Buffer.from(JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes) },
      operations: [{
        op: 'renameHeading',
        target: { kind: 'id', id: 'intro' },
        title: 'INVALID_UTF8',
      }],
    }));
    const marker = request.indexOf('INVALID_UTF8');
    const malformed = Buffer.concat([
      request.subarray(0, marker),
      Buffer.from([0xc3, 0x28]),
      request.subarray(marker + 'INVALID_UTF8'.length),
    ]);
    await writeFile(operationsPath, malformed);
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run([
      'apply',
      documentPath,
      '--operations',
      operationsPath,
      '--write',
    ])).toBe(2);
    expect(JSON.parse(stderr)).toEqual({
      contract: 'sdoc.cli.response/1',
      ok: false,
      category: 'argument',
      diagnostics: [{
        code: 'CLI_INVALID_UTF8',
        message: 'Operation input is not valid UTF-8',
      }],
    });
    expect(await readFile(operationsPath)).toEqual(malformed);
    expect(await readFile(documentPath)).toEqual(bytes);
    expect(await readFile(`${documentPath}.lock`).catch(() => undefined)).toBeUndefined();
  });

  it('rejects malformed UTF-8 operation stdin before creating a lock or changing the document', async () => {
    const { documentPath, bytes } = await fixture();
    const request = Buffer.from(JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes) },
      operations: [{
        op: 'renameHeading',
        target: { kind: 'id', id: 'intro' },
        title: 'INVALID_UTF8',
      }],
    }));
    const marker = request.indexOf('INVALID_UTF8');
    const malformed = Buffer.concat([
      request.subarray(0, marker),
      Buffer.from([0xe2, 0x28, 0xa1]),
      request.subarray(marker + 'INVALID_UTF8'.length),
    ]);
    let stderr = '';
    vi.spyOn(process, 'stdin', 'get')
      .mockReturnValue(Readable.from([malformed]) as unknown as typeof process.stdin);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run([
      'apply',
      documentPath,
      '--operations',
      '-',
      '--write',
    ])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'CLI_INVALID_UTF8' }],
    });
    expect(await readFile(documentPath)).toEqual(bytes);
    expect(await readFile(`${documentPath}.lock`).catch(() => undefined)).toBeUndefined();
  });

  it('maps a stale revision to exit code 4 and leaves no lock', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = await renameRequest(directory, bytes);
    const request = JSON.parse((await readFile(operationsPath, 'utf8')).replace(/^\uFEFF/, '')) as {
      expected: { revision: string };
    };
    request.expected.revision = `sha256:${'0'.repeat(64)}`;
    await writeFile(operationsPath, JSON.stringify(request));
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    const exitCode = await run(['apply', documentPath, '--operations', operationsPath, '--write']);

    expect(exitCode).toBe(4);
    expect(JSON.parse(stderr)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'STALE_REVISION' }],
    });
    expect(await readFile(`${documentPath}.lock`).catch(() => undefined)).toBeUndefined();
  });

  it('reports the original revision for a no-op preview without reserializing', async () => {
    const { directory, documentPath } = await fixture();
    const document = {
      sdoc: '1.0',
      meta: { modified: '2025-01-01T00:00:00.000Z' },
      doc: {
        type: 'doc',
        content: [{
          type: 'heading',
          attrs: { level: 1, id: 'intro' },
          content: [{ type: 'text', text: 'Intro' }],
        }],
      },
    };
    const irregular = Buffer.from(JSON.stringify(document).replace(',"meta"', ',  "meta"'));
    await writeFile(documentPath, irregular);
    const operationsPath = join(directory, 'noop.json');
    await writeFile(operationsPath, JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(irregular) },
      operations: [{
        op: 'renameHeading',
        target: { kind: 'id', id: 'intro' },
        title: 'Intro',
      }],
    }));
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    const exitCode = await run(['apply', documentPath, '--operations', operationsPath, '--json']);
    const output = JSON.parse(stdout) as {
      changed: boolean;
      revision: string;
      outputRevision: string;
    };
    expect(exitCode).toBe(0);
    expect(output.changed).toBe(false);
    expect(output.outputRevision).toBe(output.revision);
    expect(await readFile(documentPath)).toEqual(irregular);
  });

  it('maps invalid documents and filesystem failures to exit codes 3 and 5', async () => {
    const { directory, documentPath } = await fixture();
    await writeFile(documentPath, '{');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await run(['validate', documentPath, '--json'])).toBe(3);
    expect(await run(['inspect', join(directory, 'missing.sdoc'), '--json'])).toBe(5);
  });

  it('rejects documentId expectations that the CLI cannot independently establish', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = join(directory, 'identity.json');
    await writeFile(operationsPath, JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes), documentId: 'doc-1' },
      operations: [],
    }));
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run(['apply', documentPath, '--operations', operationsPath, '--json'])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'DOCUMENT_ID_UNVERIFIABLE' }],
    });
  });

  it('renders top-level and command help without reading a document', async () => {
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run(['inspect', '--help'])).toBe(0);
    expect(stdout).toContain('Usage: sdoc inspect');
    expect(stdout).toContain('--target-id');
    expect(stdout).toContain('--target-path');

    stdout = '';
    expect(await run(['set-document-title', '--help'])).toBe(0);
    expect(stdout).toContain('Usage: sdoc set-document-title');
    expect(stdout).toContain('[--id <id>]');
    expect(stdout).toContain('--discard-formatting');
    expect(stdout).toContain('requires --id');
  });

  it('keeps JSON as the default and supports human inspection output', async () => {
    const { documentPath } = await fixture();
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run(['inspect', documentPath])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: 'inspect',
      metadata: { title: '소개' },
    });
    stdout = '';
    expect(await run(['inspect', documentPath, '--human'])).toBe(0);
    expect(stdout).toContain('SDOC inspection');
    expect(stdout).toContain('Title: 소개');
    expect(stdout).toContain('Revision: sha256:');
  });

  it('selects canonical operation targets by ID or content path', async () => {
    const { documentPath } = await fixture();
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run(['inspect', documentPath, '--target-id', 'intro'])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      target: {
        path: [0],
        operationTarget: {
          kind: 'id',
          id: 'intro',
          expectedType: 'heading',
        },
      },
    });

    stdout = '';
    expect(await run(['inspect', documentPath, '--target-path', '/1'])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      target: {
        path: [1],
        node: { type: 'paragraph' },
        operationTarget: {
          kind: 'snapshot',
          path: [1],
          nodeType: 'paragraph',
          digest: expect.stringMatching(/^sha256:/),
        },
      },
    });

    stdout = '';
    expect(await run(['inspect', documentPath, '--target-path', '/1', '--human'])).toBe(0);
    expect(stdout).toContain('Selected target: paragraph at /1');
    expect(stdout).toContain('Content: Body');
    expect(stdout).toMatch(/Digest: sha256:[0-9a-f]{64}/);
  });

  it('distinguishes malformed, missing, and non-block target paths', async () => {
    const { documentPath } = await fixture();
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run(['inspect', documentPath, '--target-path', '1/0'])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'CLI_INVALID_TARGET_PATH' }],
    });

    stderr = '';
    expect(await run([
      'inspect',
      documentPath,
      '--target-id',
      'intro',
      '--target-path',
      '/1',
    ])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'CLI_CONFLICTING_OPTIONS' }],
    });

    stderr = '';
    expect(await run(['inspect', documentPath, '--target-path', '/9'])).toBe(4);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'TARGET_NOT_FOUND' }],
    });

    stderr = '';
    expect(await run(['inspect', documentPath, '--target-path', '/1/0'])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'TARGET_NOT_BLOCK' }],
    });
  });

  it('previews a document-title update without changing bytes', async () => {
    const { documentPath, bytes } = await fixture();
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run([
      'set-document-title',
      documentPath,
      '--id',
      'intro',
      '--title',
      '시험 결과',
      '--expected-revision',
      computeRevision(bytes),
    ])).toBe(0);

    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: 'set-document-title',
      changed: true,
      preview: true,
      written: false,
    });
    expect(await readFile(documentPath)).toEqual(bytes);
  });

  it('writes a metadata-only document title without changing an unrelated H1', async () => {
    const { documentPath, bytes } = await fixture();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(await run([
      'set-document-title',
      documentPath,
      '--title',
      '메타데이터 제목',
      '--expected-revision',
      computeRevision(bytes),
      '--write',
    ])).toBe(0);

    const written = JSON.parse((await readFile(documentPath, 'utf8')).replace(/^\uFEFF/, '')) as {
      meta: { title: string };
      doc: { content: Array<{ content?: Array<{ text?: string }> }> };
    };
    expect(written.meta.title).toBe('메타데이터 제목');
    expect(written.doc.content[0]?.content?.[0]?.text).toBe('소개');
  });

  it('writes a Korean document title to metadata and the explicit H1', async () => {
    const { documentPath, bytes } = await fixture();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(await run([
      'set-document-title',
      documentPath,
      '--id',
      'intro',
      '--title',
      '한글 시험 결과',
      '--expected-revision',
      computeRevision(bytes),
      '--write',
    ])).toBe(0);

    const text = (await readFile(documentPath, 'utf8')).replace(/^\uFEFF/, '');
    const written = JSON.parse(text) as {
      meta: { title: string };
      doc: { content: Array<{ content?: Array<{ text?: string }> }> };
    };
    expect(written.meta.title).toBe('한글 시험 결과');
    expect(written.doc.content[0]?.content?.[0]?.text).toBe('한글 시험 결과');
  });

  it('rejects a stale document-title revision without writing', async () => {
    const { documentPath, bytes } = await fixture();
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run([
      'set-document-title',
      documentPath,
      '--id',
      'intro',
      '--title',
      'Stale title',
      '--expected-revision',
      `sha256:${'0'.repeat(64)}`,
      '--write',
    ])).toBe(4);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'STALE_REVISION' }],
    });
    expect(await readFile(documentPath)).toEqual(bytes);
    expect(await readFile(`${documentPath}.lock`).catch(() => undefined)).toBeUndefined();
  });

  it('requires explicit formatting discard for a formatted title H1', async () => {
    const { documentPath } = await fixture();
    const formatted = {
      sdoc: '1.0',
      meta: {
        title: 'Formatted',
        modified: '2025-01-01T00:00:00.000Z',
      },
      doc: {
        type: 'doc',
        content: [{
          type: 'heading',
          attrs: { level: 1, id: 'intro' },
          content: [{ type: 'text', text: 'Formatted', marks: [{ type: 'bold' }] }],
        }],
      },
    };
    const formattedBytes = Buffer.from(JSON.stringify(formatted));
    await writeFile(documentPath, formattedBytes);
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const baseArguments = [
      'set-document-title',
      documentPath,
      '--id',
      'intro',
      '--title',
      'Plain title',
      '--expected-revision',
      computeRevision(formattedBytes),
    ];

    expect(await run(baseArguments)).toBe(4);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'FORMATTED_HEADING' }],
    });

    expect(await run([
      'rename-heading',
      documentPath,
      '--id',
      'intro',
      '--title',
      'Plain heading',
      '--expected-revision',
      computeRevision(formattedBytes),
      '--discard-formatting',
    ])).toBe(0);
    expect(await readFile(documentPath)).toEqual(formattedBytes);

    expect(await run([...baseArguments, '--discard-formatting', '--write'])).toBe(0);
    const written = JSON.parse(await readFile(documentPath, 'utf8')) as {
      meta: { title: string };
      doc: { content: Array<{ content?: Array<Record<string, unknown>> }> };
    };
    expect(written.meta.title).toBe('Plain title');
    expect(written.doc.content[0]?.content).toEqual([{ type: 'text', text: 'Plain title' }]);
  });

  it('creates a valid blank document immediately and previews without writing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-cli-'));
    temporaryDirectories.push(directory);
    const previewPath = join(directory, 'Preview title.sdoc');
    const documentPath = join(directory, '실제 문서.sdoc');
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run(['create', previewPath, '--dry-run'])).toBe(0);
    const preview = JSON.parse(stdout) as Record<string, unknown>;
    expect(preview).toMatchObject({
      ok: true,
      command: 'create',
      title: 'Preview title',
      preview: true,
      written: false,
    });
    expect(await readFile(previewPath).catch(() => undefined)).toBeUndefined();

    stdout = '';
    expect(await run(['create', documentPath, '--title', '시험 문서'])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: 'create',
      title: '시험 문서',
      preview: false,
      written: true,
      template: { kind: 'builtin', id: 'builtin:blank' },
    });
    const created = JSON.parse(await readFile(documentPath, 'utf8')) as {
      meta: { title: string; template?: unknown };
      doc: { content: Array<{ attrs?: { id?: string } }> };
    };
    expect(created.meta.title).toBe('시험 문서');
    expect(created.meta).not.toHaveProperty('template');
    expect(created.doc.content.some((node) => node.attrs?.id === 'document-title')).toBe(false);
    expect(await run(['validate', documentPath])).toBe(0);
  });

  it('creates and metadata-renames every current bundled template selector', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-cli-'));
    temporaryDirectories.push(directory);
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    const templateIds = [
      'builtin:blank',
      'builtin:feature-showcase',
      'builtin:technical-report',
      'builtin:design-specification',
      'builtin:verification-report',
    ];
    for (const [index, templateId] of templateIds.entries()) {
      const path = join(directory, `template-${index}.sdoc`);
      expect(await run(['create', path, '--template', templateId])).toBe(0);
      const createdBytes = await readFile(path);
      const created = JSON.parse(createdBytes.toString('utf8')) as {
        doc: unknown;
      };
      expect(await run([
        'set-document-title',
        path,
        '--title',
        `Updated ${index}`,
        '--expected-revision',
        computeRevision(createdBytes),
        '--write',
      ])).toBe(0);
      const updated = JSON.parse(await readFile(path, 'utf8')) as {
        meta: { title: string };
        doc: unknown;
      };
      expect(updated.meta.title).toBe(`Updated ${index}`);
      expect(updated.doc).toEqual(created.doc);
    }

    const outputs = stdout.trim().split('\n').map((line) => JSON.parse(line) as {
      command: string;
      template?: { id: string };
    });
    expect(outputs
      .filter((output) => output.command === 'create')
      .map((output) => output.template?.id)).toEqual(templateIds);
  });

  it('prints the complete selected block text in human inspection output', async () => {
    const { documentPath } = await fixture();
    const content = `start-${'한글-content-'.repeat(40)}-end`;
    await writeFile(documentPath, JSON.stringify({
      sdoc: '1.0',
      meta: { title: 'Long target', modified: '2025-01-01T00:00:00.000Z' },
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, id: 'title' },
            content: [{ type: 'text', text: 'Long target' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: content }] },
        ],
      },
    }));
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run(['inspect', documentPath, '--target-path', '/1', '--human'])).toBe(0);
    expect(stdout).toContain(`Content: ${content}`);
  });

  it('creates a peer H1 section without using the metadata title as a body heading', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-sibling-cli-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'peer-sections.sdoc');
    const templatePath = join(directory, 'section-template.sdoc');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await writeFile(templatePath, JSON.stringify({
      sdoc: '1.0',
      meta: { title: 'Template' },
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, id: 'first-h1' }, content: [{ type: 'text', text: 'First H1' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'First body' }] },
        ],
      },
    }));
    expect(await run([
      'create', documentPath, '--template', templatePath, '--title', 'Peer sections',
    ])).toBe(0);
    const bytes = await readFile(documentPath);
    const operationsPath = join(directory, 'insert-sibling.json');
    await writeFile(operationsPath, JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes) },
      operations: [{
        op: 'insertSection',
        target: { kind: 'id', id: 'first-h1', expectedType: 'heading' },
        position: 'after',
        title: 'Peer H1',
        id: 'peer-h1',
        blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Peer body' }] }],
      }],
    }));
    expect(await run(['apply', documentPath, '--operations', operationsPath, '--write'])).toBe(0);

    let stdout = '';
    vi.mocked(process.stdout.write).mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    expect(await run(['inspect', documentPath])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      outline: [
        { id: 'first-h1', level: 1, path: [0] },
        { id: 'peer-h1', level: 1, path: [2] },
      ],
    });
  });

  it('reports invalid file templates and missing destination parents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-cli-'));
    temporaryDirectories.push(directory);
    const templatePath = join(directory, 'invalid.sdoc');
    await writeFile(templatePath, '{}');
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run([
      'create',
      join(directory, 'invalid-target.sdoc'),
      '--template',
      templatePath,
    ])).toBe(3);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'CLI_TEMPLATE_INVALID' }],
    });

    stderr = '';
    expect(await run(['create', join(directory, 'missing', 'target.sdoc')])).toBe(5);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'CLI_CREATE_FAILED' }],
    });
  });

  it('rejects malformed template UTF-8 without changing the template or creating a target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-cli-'));
    temporaryDirectories.push(directory);
    const templatePath = join(directory, 'malformed-utf8.sdoc');
    const targetPath = join(directory, 'target.sdoc');
    const template = Buffer.from(JSON.stringify({
      sdoc: '1.0',
      meta: { title: 'INVALID_UTF8' },
      doc: { type: 'doc', content: [] },
    }));
    const marker = template.indexOf('INVALID_UTF8');
    const malformed = Buffer.concat([
      template.subarray(0, marker),
      Buffer.from([0xc3, 0x28]),
      template.subarray(marker + 'INVALID_UTF8'.length),
    ]);
    await writeFile(templatePath, malformed);
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run([
      'create',
      targetPath,
      '--template',
      templatePath,
    ])).toBe(3);
    expect(JSON.parse(stderr)).toEqual({
      contract: 'sdoc.cli.response/1',
      ok: false,
      category: 'io',
      diagnostics: [{
        code: 'CLI_TEMPLATE_INVALID',
        message: 'Template is not valid UTF-8',
      }],
    });
    expect(await readFile(templatePath)).toEqual(malformed);
    expect(await readFile(targetPath).catch(() => undefined)).toBeUndefined();
    expect(await readFile(`${targetPath}.lock`).catch(() => undefined)).toBeUndefined();
  });

  it('creates from an explicit file template and never overwrites a target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-cli-'));
    temporaryDirectories.push(directory);
    const templatePath = join(directory, 'template.sdoc');
    const targetPath = join(directory, 'target.sdoc');
    const template = {
      sdoc: '1.0',
      meta: {
        title: 'Template',
        documentId: 'must-not-copy',
        template: { name: 'CLI template', titleNodeId: 'title' },
      },
      doc: {
        type: 'doc',
        content: [{
          type: 'heading',
          attrs: { level: 1, id: 'title' },
          content: [{ type: 'text', text: 'Template' }],
        }],
      },
    };
    await writeFile(templatePath, `\uFEFF${JSON.stringify({
      ...template,
      meta: { ...template.meta, title: '한글 템플릿' },
    })}`);
    let stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run([
      'create',
      targetPath,
      '--template',
      templatePath,
      '--title',
      'Created title',
    ])).toBe(0);
    const created = JSON.parse(await readFile(targetPath, 'utf8')) as {
      meta: Record<string, unknown>;
      doc: { content: Array<{ content?: Array<{ text?: string }> }> };
    };
    expect(created.meta).not.toHaveProperty('documentId');
    expect(created.meta.title).toBe('Created title');
    expect(created.doc.content).toEqual([]);

    expect(await run(['create', targetPath])).toBe(5);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'CLI_TARGET_EXISTS' }],
    });
  });

  it('adds a structured warning when a legacy file keeps its extension', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-legacy-cli-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'legacy.tiptap.json');
    const legacy = {
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 1, id: 'legacy-title' },
        content: [{ type: 'text', text: 'Legacy' }],
      }],
    };
    const bytes = Buffer.from(JSON.stringify(legacy));
    await writeFile(documentPath, bytes);
    const operationsPath = join(directory, 'legacy-ops.json');
    await writeFile(operationsPath, JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes) },
      operations: [{
        op: 'renameHeading',
        target: { kind: 'id', id: 'legacy-title' },
        title: 'Updated',
      }],
    }));
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run([
      'apply',
      documentPath,
      '--operations',
      operationsPath,
      '--upgrade-legacy',
    ])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      warnings: [{
        code: 'LEGACY_FILE_EXTENSION_RETAINED',
        severity: 'warning',
        message: expect.stringContaining('Writing this preview'),
        suggestedPath: join(directory, 'legacy.sdoc'),
      }],
    });
  });

  it('renames a heading persistent id and updates cross-references', async () => {
    const { directory, documentPath } = await fixture();
    // Create a document with an internal cross-reference to #intro
    const doc = {
      sdoc: '1.0',
      meta: { title: 'Ref test', modified: '2025-01-01T00:00:00.000Z' },
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, id: 'intro' },
            content: [{ type: 'text', text: 'Intro' }],
          },
          {
            type: 'paragraph',
            content: [{
              type: 'text',
              text: 'See intro',
              marks: [{ type: 'link', attrs: { href: '#intro' } }],
            }],
          },
        ],
      },
    };
    const docBytes = Buffer.from(JSON.stringify(doc));
    await writeFile(documentPath, docBytes);
    const operationsPath = join(directory, 'rename-id.json');
    await writeFile(operationsPath, JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(docBytes) },
      operations: [{
        op: 'renameBlockId',
        target: { kind: 'id', id: 'intro', expectedType: 'heading' },
        newId: 'introduction',
      }],
    }));
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    // Preview
    expect(await run(['apply', documentPath, '--operations', operationsPath])).toBe(0);
    const preview = JSON.parse(stdout) as { ok: boolean; changed: boolean; diff: Array<{ kind: string }> };
    expect(preview.ok).toBe(true);
    expect(preview.changed).toBe(true);
    expect(preview.diff).toContainEqual(expect.objectContaining({ kind: 'block-id-renamed' }));

    // Write
    stdout = '';
    expect(await run(['apply', documentPath, '--operations', operationsPath, '--write'])).toBe(0);
    const written = JSON.parse(await readFile(documentPath, 'utf8')) as {
      doc: { content: Array<{ attrs?: { id?: string }; content?: Array<{ marks?: Array<{ attrs?: { href?: string } }> }> }> };
    };
    expect(written.doc.content[0]?.attrs?.id).toBe('introduction');
    // Cross-reference should be updated to #introduction
    expect(written.doc.content[1]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe('#introduction');
  });

  it('rejects renaming to a duplicate id', async () => {
    const { directory, documentPath } = await fixture();
    const doc = {
      sdoc: '1.0',
      meta: { title: 'Dup test', modified: '2025-01-01T00:00:00.000Z' },
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, id: 'first' },
            content: [{ type: 'text', text: 'First' }],
          },
          {
            type: 'heading',
            attrs: { level: 2, id: 'second' },
            content: [{ type: 'text', text: 'Second' }],
          },
        ],
      },
    };
    const docBytes = Buffer.from(JSON.stringify(doc));
    await writeFile(documentPath, docBytes);
    const operationsPath = join(directory, 'dup-id.json');
    await writeFile(operationsPath, JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(docBytes) },
      operations: [{
        op: 'renameBlockId',
        target: { kind: 'id', id: 'first', expectedType: 'heading' },
        newId: 'second',
      }],
    }));
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run(['apply', documentPath, '--operations', operationsPath])).toBe(3);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'DUPLICATE_ID' }],
    });
  });

  it('rejects renaming a non-referenceable node id', async () => {
    const { documentPath, bytes } = await fixture();
    // Try renaming a paragraph (which is snapshot-targeted, not id-targeted)
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    // First inspect to get the paragraph's snapshot target
    expect(await run(['inspect', documentPath, '--target-path', '/1'])).toBe(0);
    const inspection = JSON.parse(stdout) as {
      target: { operationTarget: Record<string, unknown> };
    };
    const operationsPath = join(dirname(documentPath), 'bad-rename.json');
    await writeFile(operationsPath, JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes) },
      operations: [{
        op: 'renameBlockId',
        target: inspection.target.operationTarget,
        newId: 'new-paragraph-id',
      }],
    }));
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    expect(await run(['apply', documentPath, '--operations', operationsPath])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      diagnostics: [{ code: 'ID_RENAME_NOT_SUPPORTED' }],
    });
  });
});
