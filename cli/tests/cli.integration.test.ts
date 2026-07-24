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
});
