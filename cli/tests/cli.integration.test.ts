import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      modified: '2025-01-01T00:00:00.000Z',
    },
    doc: {
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 1, id: 'intro' },
        content: [{ type: 'text', text: '소개' }],
      }],
    },
  };
  const bytes = Buffer.from(`\uFEFF${JSON.stringify(document, undefined, 4).replace(/\n/g, '\r\n')}\r\n`);
  await writeFile(documentPath, bytes);
  return { directory, documentPath, bytes };
}

async function renameRequest(directory: string, bytes: Uint8Array): Promise<string> {
  const path = join(directory, 'operations.json');
  await writeFile(path, JSON.stringify({
    contract: 'sdoc.operations/1',
    expected: { revision: computeRevision(bytes) },
    operations: [{
      op: 'renameHeading',
      target: { kind: 'id', id: 'intro' },
      title: '시험 결과',
    }],
  }));
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
      ok: false,
      diagnostics: [{ code: 'CLI_MISSING_OPERATIONS' }],
    });
  });

  it('accepts a Korean operation request from stdin', async () => {
    const { documentPath, bytes } = await fixture();
    const request = JSON.stringify({
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(bytes) },
      operations: [{
        op: 'renameHeading',
        target: { kind: 'id', id: 'intro' },
        title: '한글 표준 입력',
      }],
    });
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

  it('maps a stale revision to exit code 4 and leaves no lock', async () => {
    const { directory, documentPath, bytes } = await fixture();
    const operationsPath = await renameRequest(directory, bytes);
    const request = JSON.parse(await readFile(operationsPath, 'utf8')) as {
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
  });

  it('keeps JSON as the default and supports human inspection output', async () => {
    const { documentPath } = await fixture();
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    expect(await run(['inspect', documentPath])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, command: 'inspect' });
    stdout = '';
    expect(await run(['inspect', documentPath, '--human'])).toBe(0);
    expect(stdout).toContain('SDOC inspection');
    expect(stdout).toContain('Revision: sha256:');
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
    expect(created.doc.content[0]?.attrs?.id).toBe('document-title');
    expect(await run(['validate', documentPath])).toBe(0);
  });

  it('accepts every bundled template selector', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-cli-'));
    temporaryDirectories.push(directory);
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    const templateIds = [
      'builtin:blank',
      'builtin:technical-report',
      'builtin:design-specification',
      'builtin:verification-report',
    ];
    for (const [index, templateId] of templateIds.entries()) {
      const path = join(directory, `template-${index}.sdoc`);
      expect(await run(['create', path, '--template', templateId, '--dry-run'])).toBe(0);
    }

    const outputs = stdout.trim().split('\n').map((line) => JSON.parse(line) as {
      template: { id: string };
    });
    expect(outputs.map((output) => output.template.id)).toEqual(templateIds);
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
    await writeFile(templatePath, JSON.stringify(template));
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
    expect(created.doc.content[0]?.content?.[0]?.text).toBe('Created title');

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
});
