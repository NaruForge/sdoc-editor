import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeRevision } from '../../shared/document/operations/index.js';
import { run } from '../src/main.js';

const temporaryDirectories: string[] = [];

interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: Record<string, unknown>;
}

async function execute(argv: string[]): Promise<ExecutionResult> {
  let stdout = '';
  let stderr = '';
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const exitCode = await run(argv);
    const serialized = stdout || stderr;
    return {
      exitCode,
      stdout,
      stderr,
      ...(serialized.trimStart().startsWith('{')
        ? { json: JSON.parse(serialized) as Record<string, unknown> }
        : {}),
    };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

async function writeDocument(content: unknown[]): Promise<{ documentPath: string; bytes: Buffer }> {
  const directory = await mkdtemp(join(tmpdir(), 'sdoc-read-cli-'));
  temporaryDirectories.push(directory);
  const documentPath = join(directory, 'document.sdoc');
  const bytes = Buffer.from(JSON.stringify({
    sdoc: '1.0',
    meta: {
      documentId: 'read-document',
      title: 'Read projections',
      modified: '2026-08-07T00:00:00.000Z',
    },
    doc: { type: 'doc', content },
  }));
  await writeFile(documentPath, bytes);
  return { documentPath, bytes };
}

const textBlock = (type: 'heading' | 'paragraph', text: string, attrs?: Record<string, unknown>) => ({
  type,
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe('explicit inspect projections', () => {
  it('preserves default and targeted legacy inspect JSON shapes', async () => {
    const { documentPath } = await writeDocument([
      textBlock('heading', 'Intro', { level: 1, id: 'intro' }),
      textBlock('paragraph', 'Body'),
    ]);

    const defaultInspect = await execute(['inspect', documentPath]);
    expect(defaultInspect.exitCode).toBe(0);
    expect(defaultInspect.json).toMatchObject({
      contract: 'sdoc.cli.response/1',
      ok: true,
      command: 'inspect',
      metadata: { title: 'Read projections' },
      blocks: expect.any(Array),
      outline: expect.any(Array),
      references: expect.any(Array),
      referenceables: expect.any(Array),
      endnotes: expect.any(Array),
    });
    expect(defaultInspect.json).not.toHaveProperty('projection');
    expect(defaultInspect.json).not.toHaveProperty('readContract');

    const targeted = await execute(['inspect', documentPath, '--target-id', 'intro']);
    expect(targeted.exitCode).toBe(0);
    expect(targeted.json).toMatchObject({
      target: { path: [0], node: { type: 'heading' } },
      blocks: expect.any(Array),
      outline: expect.any(Array),
    });
    expect(targeted.json).not.toHaveProperty('projection');
  });

  it('inspects and pages the endnotes catalog in body order', async () => {
    const { documentPath } = await writeDocument([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'One' },
        { type: 'endnote', attrs: { id: 'note-a', body: 'First note' } },
        { type: 'text', text: 'Two' },
        { type: 'endnote', attrs: { id: 'note-b', body: 'Second note' } },
      ],
    }]);

    const inspected = await execute(['inspect', documentPath]);
    expect(inspected.exitCode).toBe(0);
    expect(inspected.json?.endnotes).toEqual([
      { id: 'note-a', number: 1, body: 'First note', path: [0, 1] },
      { id: 'note-b', number: 2, body: 'Second note', path: [0, 3] },
    ]);

    const projected = await execute([
      'inspect', documentPath, '--projection', 'catalog', '--catalog', 'endnotes', '--limit', '1',
    ]);
    expect(projected.exitCode).toBe(0);
    expect(projected.json).toMatchObject({
      projection: 'catalog',
      data: { kind: 'endnotes', items: [{ id: 'note-a', number: 1, body: 'First note' }] },
      page: { returned: 1, complete: false },
    });
  });

  it('rejects duplicate canonical endnote ids', async () => {
    const { documentPath } = await writeDocument([{
      type: 'paragraph',
      content: [
        { type: 'endnote', attrs: { id: 'same-note', body: 'First' } },
        { type: 'endnote', attrs: { id: 'same-note', body: 'Second' } },
      ],
    }]);

    const inspected = await execute(['inspect', documentPath]);
    expect(inspected.exitCode).not.toBe(0);
    expect(inspected.json).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'DUPLICATE_ID' })],
    });
  });

  it('reports an optional paragraph id as an id operation target', async () => {
    const { documentPath } = await writeDocument([
      textBlock('paragraph', 'Tracked', { id: 'para-1' }),
    ]);

    const inspected = await execute(['inspect', documentPath]);
    expect(inspected.exitCode).toBe(0);
    expect(inspected.json).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'paragraph',
          id: 'para-1',
          operationTarget: {
            kind: 'id',
            id: 'para-1',
            expectedType: 'paragraph',
          },
        }),
      ]),
    });
  });

  it('paginates the default block catalog beyond 1,000 entries without gaps or duplicates', async () => {
    const blocks = Array.from({ length: 1_005 }, (_, index) =>
      textBlock('paragraph', `Block ${index}`));
    const { documentPath } = await writeDocument(blocks);
    const paths: number[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const result = await execute([
        'inspect',
        documentPath,
        '--projection',
        'catalog',
        ...(cursor ? ['--cursor', cursor] : []),
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.json).toMatchObject({
        contract: 'sdoc.cli.response/1',
        readContract: 'sdoc.read/1',
        ok: true,
        command: 'inspect',
        projection: 'catalog',
        data: { kind: 'blocks', items: expect.any(Array) },
        page: { returned: expect.any(Number), complete: expect.any(Boolean) },
        budget: { bytes: { used: expect.any(Number), max: expect.any(Number) } },
      });
      const data = result.json?.data as { items: Array<{ path: number[] }> };
      paths.push(...data.items.map((item) => item.path[0]));
      const page = result.json?.page as { complete: boolean; nextCursor?: string };
      cursor = page.nextCursor;
      if (!page.complete) expect(cursor).toEqual(expect.any(String));
      pageCount += 1;
    } while (cursor);

    expect(pageCount).toBe(2);
    expect(paths).toEqual(Array.from({ length: 1_005 }, (_, index) => index));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('returns only the requested target projection and its budgets', async () => {
    const { documentPath } = await writeDocument([
      textBlock('heading', 'Intro', { level: 1, id: 'intro' }),
      textBlock('paragraph', 'Body'),
    ]);
    const result = await execute([
      'inspect', documentPath, '--projection', 'target', '--target-id', 'intro',
      '--max-bytes', '4096', '--max-nodes', '10',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      contract: 'sdoc.cli.response/1',
      readContract: 'sdoc.read/1',
      projection: 'target',
      data: {
        path: [0],
        node: { type: 'heading' },
        operationTarget: { kind: 'id', id: 'intro' },
      },
      page: { returned: 1, complete: true },
      budget: {
        bytes: { used: expect.any(Number), max: 4096 },
        nodes: { used: 2, max: 10 },
      },
    });
    for (const absent of ['target', 'blocks', 'outline', 'references', 'referenceables', 'endnotes', 'metadata']) {
      expect(result.json).not.toHaveProperty(absent);
    }
  });

  it('continues section and document projections by whole subtrees and renders human page state', async () => {
    const content = [
      textBlock('heading', 'First', { level: 1, id: 'first' }),
      textBlock('paragraph', 'First body'),
      textBlock('heading', 'Child', { level: 2, id: 'child' }),
      textBlock('paragraph', 'Child body'),
      textBlock('heading', 'Second', { level: 1, id: 'second' }),
      textBlock('paragraph', 'Second body'),
    ];
    const { documentPath } = await writeDocument(content);

    const sectionTypes: string[] = [];
    let sectionCursor: string | undefined;
    do {
      const page = await execute([
        'inspect', documentPath, '--projection', 'section', '--target-id', 'first',
        '--max-nodes', '2', ...(sectionCursor ? ['--cursor', sectionCursor] : []),
      ]);
      expect(page.exitCode).toBe(0);
      const data = page.json?.data as { path: number[]; content: Array<{ type: string }> };
      expect(data.path).toEqual([0]);
      sectionTypes.push(...data.content.map((node) => node.type));
      sectionCursor = (page.json?.page as { nextCursor?: string }).nextCursor;
    } while (sectionCursor);
    expect(sectionTypes).toEqual(['heading', 'paragraph', 'heading', 'paragraph']);

    const documentTypes: string[] = [];
    let documentCursor: string | undefined;
    do {
      const page = await execute([
        'inspect', documentPath, '--projection', 'document', '--max-nodes', '2',
        ...(documentCursor ? ['--cursor', documentCursor] : []),
      ]);
      expect(page.exitCode).toBe(0);
      documentTypes.push(...((page.json?.data as { content: Array<{ type: string }> }).content)
        .map((node) => node.type));
      documentCursor = (page.json?.page as { nextCursor?: string }).nextCursor;
    } while (documentCursor);
    expect(documentTypes).toEqual(content.map((node) => node.type));

    const human = await execute([
      'inspect', documentPath, '--projection', 'section', '--target-id', 'first',
      '--max-nodes', '2', '--human',
    ]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Projection: section');
    expect(human.stdout).toContain('Returned: 1');
    expect(human.stdout).toContain('Complete: false');
    expect(human.stdout).toContain('Truncated by: maxNodes');
    expect(human.stdout).toMatch(/Budget: \d+\/\d+ bytes, 2\/2 nodes/);
    expect(human.stdout).toContain('Section /0: 1 node');
    expect(human.stdout).toContain('Next cursor:');
  });

  it('maps invalid, stale, and explicit revision preconditions to stable exits', async () => {
    const { documentPath, bytes } = await writeDocument([
      textBlock('paragraph', 'First'),
      textBlock('paragraph', 'Second'),
    ]);

    const first = await execute([
      'inspect', documentPath, '--projection', 'catalog', '--limit', '1',
    ]);
    const cursor = (first.json?.page as { nextCursor: string }).nextCursor;
    expect(cursor).toEqual(expect.any(String));

    const invalid = await execute([
      'inspect', documentPath, '--projection', 'catalog', '--cursor', 'not-a-cursor',
    ]);
    expect(invalid.exitCode).toBe(2);
    expect(invalid.json).toMatchObject({
      contract: 'sdoc.cli.response/1',
      category: 'argument',
      diagnostics: [{ code: 'INVALID_READ_CURSOR' }],
    });

    await writeFile(documentPath, Buffer.concat([bytes, Buffer.from('\n')]));
    const staleCursor = await execute([
      'inspect', documentPath, '--projection', 'catalog', '--cursor', cursor,
    ]);
    expect(staleCursor.exitCode).toBe(4);
    expect(staleCursor.json).toMatchObject({
      contract: 'sdoc.cli.response/1',
      category: 'conflict',
      diagnostics: [{ code: 'STALE_READ_CURSOR' }],
    });

    const expected = await execute([
      'inspect', documentPath, '--projection', 'document',
      '--expected-revision', computeRevision(await readFile(documentPath)),
    ]);
    expect(expected.exitCode).toBe(0);

    const staleRevision = await execute([
      'inspect', documentPath, '--projection', 'document',
      '--expected-revision', `sha256:${'0'.repeat(64)}`,
    ]);
    expect(staleRevision.exitCode).toBe(4);
    expect(staleRevision.json).toMatchObject({
      diagnostics: [{ code: 'STALE_REVISION' }],
    });
  });

  it('rejects projection argument errors before trying to read the document', async () => {
    const missing = join(tmpdir(), 'sdoc-read-does-not-exist.sdoc');
    const cases = [
      [['inspect', missing, '--limit', '2'], 'CLI_PROJECTION_REQUIRED'],
      [['inspect', missing, '--projection', 'target'], 'CLI_PROJECTION_REQUIRES_TARGET'],
      [['inspect', missing, '--projection', 'catalog', '--max-nodes', '2'], 'CLI_PROJECTION_OPTION_NOT_SUPPORTED'],
      [['inspect', missing, '--projection', 'document', '--max-bytes', '1.5'], 'CLI_INVALID_POSITIVE_INTEGER'],
    ] as const;

    for (const [argv, code] of cases) {
      const result = await execute([...argv]);
      expect(result.exitCode).toBe(2);
      expect(result.json).toMatchObject({
        category: 'argument',
        diagnostics: [{ code }],
      });
    }
  });
});
