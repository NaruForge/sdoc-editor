import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeRevision, inspectDocumentBytes } from '../../shared/document/operations/index.js';
import { run } from '../src/main.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('CLI document root insertion', () => {
  it('creates a blank document, previews and writes its first section, and rejects replay', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-root-insertion-'));
    directories.push(directory);
    const path = join(directory, 'blank.sdoc');
    const operations = join(directory, 'operations.json');
    let stdout = '';
    let stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout += String(chunk); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr += String(chunk); return true; });
    expect(await run(['create', path, '--template', 'builtin:blank'])).toBe(0);
    const original = await readFile(path);
    const inspected = inspectDocumentBytes(original);
    if (!inspected.ok) throw new Error(JSON.stringify(inspected));
    expect(inspected.outline).toHaveLength(0);
    await writeFile(operations, JSON.stringify({
      contract: 'sdoc.operations/1', expected: { revision: inspected.revision },
      operations: [{
        op: 'insertSection', destination: { position: 'document-start' }, title: '첫 장', id: 'first',
      }],
    }));
    stdout = '';
    expect(await run(['apply', path, '--operations', operations])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, preview: true, written: false,
      diff: expect.arrayContaining([expect.objectContaining({ kind: 'section-inserted' })]) });
    expect(await readFile(path)).toEqual(original);
    expect(await run(['apply', path, '--operations', operations, '--write'])).toBe(0);
    const written = await readFile(path);
    const result = inspectDocumentBytes(written);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.outline).toMatchObject([{ id: 'first', level: 1, text: '첫 장', path: [0] }]);
    expect(result.blocks.filter((entry) => entry.type === 'paragraph')).toHaveLength(1);
    expect(await run(['apply', path, '--operations', operations, '--write'])).toBe(4);
    expect(stderr).toContain('STALE_REVISION');
    expect(await readFile(path)).toEqual(written);
  });

  it('deletes the final block, recovers via root insertion, and rejects an invalid batch without writing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-empty-recovery-'));
    directories.push(directory);
    const path = join(directory, 'empty.sdoc');
    const operations = join(directory, 'operations.json');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await run(['create', path, '--template', 'builtin:blank'])).toBe(0);
    const initial = await readFile(path);
    const inspected = inspectDocumentBytes(initial);
    if (!inspected.ok) throw new Error(JSON.stringify(inspected));
    const request = async (items: unknown[]) => {
      await writeFile(operations, JSON.stringify({
        contract: 'sdoc.operations/1', expected: { revision: computeRevision(await readFile(path)) }, operations: items,
      }));
    };
    await request([{ op: 'deleteBlock', target: inspected.blocks[0].operationTarget }]);
    expect(await run(['apply', path, '--operations', operations, '--write'])).toBe(0);
    const empty = await readFile(path);
    expect(inspectDocumentBytes(empty)).toMatchObject({ ok: true, blockCount: 0 });
    const insertion = {
      op: 'insertBlock', destination: { position: 'document-end' },
      block: { type: 'paragraph', content: [{ type: 'text', text: 'Recovered' }] },
    };
    await request([insertion, {
      op: 'insertSection', destination: { position: 'document-end' }, title: 'Invalid', id: 'provisional:reserved',
    }]);
    expect(await run(['apply', path, '--operations', operations, '--write'])).toBe(2);
    expect(await readFile(path)).toEqual(empty);
    await request([insertion]);
    expect(await run(['apply', path, '--operations', operations, '--write'])).toBe(0);
    expect(inspectDocumentBytes(await readFile(path))).toMatchObject({
      ok: true, blockCount: 1, blocks: [{ type: 'paragraph', summary: 'paragraph: Recovered' }],
    });
  });
});
