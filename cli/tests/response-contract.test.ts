import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeRevision } from '../../shared/document/operations/index.js';
import { getBuiltInTemplates } from '../../shared/template/index.js';
import { run, type RunDependencies } from '../src/main.js';

const RESPONSE_CONTRACT = 'sdoc.cli.response/1';
const temporaryDirectories: string[] = [];
let validateResponse: ValidateFunction;

interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: Record<string, unknown>;
}

async function execute(
  argv: string[],
  dependencies?: RunDependencies,
): Promise<ExecutionResult> {
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
    const exitCode = await run(argv, dependencies);
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

async function fixture(): Promise<{
  directory: string;
  documentPath: string;
  bytes: Buffer;
  operationsPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sdoc-response-contract-'));
  temporaryDirectories.push(directory);
  const documentPath = join(directory, 'document.sdoc');
  const bytes = Buffer.from(JSON.stringify({
    sdoc: '1.0',
    meta: {
      documentId: 'response-contract-document',
      title: 'Response contract',
      modified: '2026-08-07T00:00:00.000Z',
    },
    doc: {
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 1, id: 'title' },
        content: [{ type: 'text', text: 'Response contract' }],
      }, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Body' }],
      }],
    },
  }));
  await writeFile(documentPath, bytes);
  const operationsPath = join(directory, 'operations.json');
  await writeFile(operationsPath, JSON.stringify({
    contract: 'sdoc.operations/1',
    expected: { revision: computeRevision(bytes) },
    operations: [{
      op: 'renameHeading',
      target: { kind: 'id', id: 'title' },
      title: 'Renamed',
    }],
  }));
  return { directory, documentPath, bytes, operationsPath };
}

beforeAll(async () => {
  const schema = JSON.parse(await readFile(
    resolve(import.meta.dirname, '..', 'schemas', 'sdoc.cli.response.schema.json'),
    'utf8',
  )) as object;
  validateResponse = new Ajv({ allErrors: true, strict: true }).compile(schema);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

function expectSchemaValid(value: unknown): void {
  expect(validateResponse(value), JSON.stringify(validateResponse.errors, undefined, 2)).toBe(true);
}

describe('sdoc.cli.response/1', () => {
  it('validates representative output from every public JSON command and preserves useful fields', async () => {
    const { directory, documentPath, bytes, operationsPath } = await fixture();
    const revision = computeRevision(bytes);
    const cases = [
      await execute(['inspect', documentPath]),
      await execute(['inspect', documentPath, '--projection', 'target', '--target-id', 'title']),
      await execute(['validate', documentPath]),
      await execute(['apply', documentPath, '--operations', operationsPath]),
      await execute([
        'rename-heading', documentPath, '--id', 'title', '--title', 'Renamed',
        '--expected-revision', revision,
      ]),
      await execute([
        'set-document-title', documentPath, '--title', 'Metadata title',
        '--expected-revision', revision,
      ]),
      await execute(['create', join(directory, 'created.sdoc'), '--dry-run']),
      await execute(['capabilities', '--json']),
    ];

    expect(cases.map((result) => result.exitCode)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    for (const result of cases) {
      expect(result.stderr).toBe('');
      expect(result.json).toMatchObject({ contract: RESPONSE_CONTRACT, ok: true });
      expectSchemaValid(result.json);
      expectSchemaValid({ ...result.json, futureAdditiveField: { supported: true } });
    }

    expect(cases[0]?.json).toMatchObject({ command: 'inspect', blockCount: 2 });
    expect(cases[1]?.json).toMatchObject({
      contract: RESPONSE_CONTRACT,
      readContract: 'sdoc.read/1',
      command: 'inspect',
      projection: 'target',
      page: { returned: 1, complete: true },
    });
    expect(cases[1]?.json).not.toHaveProperty('metadata');
    expect(cases[2]?.json).not.toHaveProperty('readContract');
    expect(cases[3]?.json).toMatchObject({
      command: 'apply',
      preview: true,
      written: false,
    });
    expect(cases[3]?.json?.diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heading-renamed' }),
    ]));
    expect(cases[6]?.json).toMatchObject({
      command: 'create',
      template: { kind: 'builtin', id: 'builtin:blank' },
    });
  });

  it('requires readContract on projected inspect success records', () => {
    const projected = {
      contract: RESPONSE_CONTRACT,
      readContract: 'sdoc.read/1',
      ok: true,
      command: 'inspect',
      path: 'document.sdoc',
      projection: 'document',
      revision: `sha256:${'0'.repeat(64)}`,
      legacy: false,
      needsIdNormalization: false,
      data: { content: [] },
      page: { returned: 0, complete: true },
      budget: {
        bytes: { used: 14, max: 262144 },
        nodes: { used: 0, max: 1000 },
      },
      warnings: [],
    };

    expectSchemaValid(projected);
    expect(validateResponse({ ...projected, readContract: undefined })).toBe(false);
    expect(validateResponse({ ...projected, contract: 'sdoc.read/1' })).toBe(false);
    expect(validateResponse({
      ...projected,
      projection: 'catalog',
      data: { content: [] },
    })).toBe(false);
    expect(validateResponse({
      ...projected,
      projection: 'target',
      data: { content: [] },
    })).toBe(false);
    expect(validateResponse({
      ...projected,
      projection: 'section',
      data: { content: [] },
    })).toBe(false);
    expect(validateResponse({
      ...projected,
      projection: 'document',
      data: { path: [], node: {}, digest: `sha256:${'0'.repeat(64)}`, operationTarget: {} },
    })).toBe(false);
  });

  it('reports complete pathless capabilities in JSON by default', async () => {
    const result = await execute(['capabilities']);

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      contract: RESPONSE_CONTRACT,
      ok: true,
      command: 'capabilities',
      cliVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      contracts: {
        document: 'sdoc/1.0',
        operations: 'sdoc.operations/1',
        read: 'sdoc.read/1',
        response: RESPONSE_CONTRACT,
      },
      commands: [
        'capabilities',
        'inspect',
        'validate',
        'apply',
        'rename-heading',
        'set-document-title',
        'create',
      ],
      semanticOperations: [
        'renameHeading',
        'setDocumentTitle',
        'updateDocumentMetadata',
        'updateDocumentSettings',
        'insertBlock',
        'insertSection',
        'replaceBlock',
        'updateBlockAttrs',
        'moveBlock',
        'deleteBlock',
        'moveSection',
        'deleteSection',
        'setHeadingLevel',
        'renameBlockId',
      ],
      limits: {
        documentBytes: 32 * 1024 * 1024,
        operationInputBytes: 4 * 1024 * 1024,
        operationCount: 100,
        documentNodes: 100_000,
        inspectLegacyMaxBlocks: 10_000,
        readCatalogLimit: 10_000,
        readMaxBytes: 32 * 1024 * 1024,
        readMaxNodes: 100_000,
      },
      projections: ['catalog', 'target', 'section', 'document'],
      catalogKinds: ['blocks', 'outline', 'references', 'referenceables'],
      builtInTemplateIds: getBuiltInTemplates().map((template) => template.descriptor.id),
    });
  });

  it.each([
    ['argument', 2],
    ['document', 3],
    ['conflict', 4],
    ['io', 5],
    ['internal', 3],
  ] as const)('normalizes the %s failure branch and validates it', async (category, exitCode) => {
    const { directory, documentPath } = await fixture();
    let result: ExecutionResult;
    if (category === 'argument') {
      result = await execute(['unknown-command']);
    } else if (category === 'document') {
      const invalidPath = join(directory, 'invalid.sdoc');
      await writeFile(invalidPath, '{}');
      result = await execute(['validate', invalidPath]);
    } else if (category === 'conflict') {
      result = await execute(['inspect', documentPath, '--target-path', '/99']);
    } else if (category === 'io') {
      result = await execute(['inspect', join(directory, 'missing.sdoc')]);
    } else {
      result = await execute(['create', join(directory, 'internal.sdoc')], {
        replaceDocument: async () => undefined,
        createDocument: async () => {
          throw new Error('Injected internal failure');
        },
      });
    }

    expect(result.exitCode).toBe(exitCode);
    expect(result.stdout).toBe('');
    expect(result.json).toMatchObject({
      contract: RESPONSE_CONTRACT,
      ok: false,
      category,
    });
    expect(result.json?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    ]));
    expectSchemaValid(result.json);
  });

  it('supports capabilities help and human output without changing human records into JSON', async () => {
    const help = await execute(['capabilities', '--help']);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('Usage: sdoc capabilities');
    expect(help.stdout).toContain('--human');
    expect(help.json).toBeUndefined();

    const human = await execute(['capabilities', '--human']);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('SDOC CLI capabilities');
    expect(human.stdout).toContain('sdoc.cli.response/1');
    expect(human.stdout.trimStart().startsWith('{')).toBe(false);
    expect(human.json).toBeUndefined();
  });
});
