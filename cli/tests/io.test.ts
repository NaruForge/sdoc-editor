import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicCreate, atomicReplace, IoError } from '../src/io.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

describe('atomicReplace', () => {
  it('preserves the original and removes its sibling temp when replacement fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-atomic-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, '문서.sdoc');
    const original = Buffer.from('original bytes');
    await writeFile(documentPath, original);

    await expect(atomicReplace(
      documentPath,
      Buffer.from('replacement bytes'),
      async () => {
        throw new Error('injected replacement failure');
      },
    )).rejects.toBeInstanceOf(IoError);

    expect(await readFile(documentPath)).toEqual(original);
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('atomicCreate', () => {
  it('publishes a complete file without leaving a sibling temporary link', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'new.sdoc');
    const bytes = Buffer.from('complete bytes');

    await expect(atomicCreate(documentPath, bytes)).resolves.toEqual({});

    expect(await readFile(documentPath)).toEqual(bytes);
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('never overwrites an existing target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'existing.sdoc');
    await writeFile(documentPath, 'original');

    await expect(atomicCreate(documentPath, Buffer.from('replacement')))
      .rejects.toMatchObject({ code: 'CLI_TARGET_EXISTS' });

    expect(await readFile(documentPath, 'utf8')).toBe('original');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('allows exactly one concurrent creator to publish the target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'race.sdoc');

    const results = await Promise.allSettled([
      atomicCreate(documentPath, Buffer.from('first')),
      atomicCreate(documentPath, Buffer.from('second')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'CLI_TARGET_EXISTS' },
    });
    expect(['first', 'second']).toContain(await readFile(documentPath, 'utf8'));
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('removes the sibling temp when publication fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdoc-create-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'failed.sdoc');

    await expect(atomicCreate(documentPath, Buffer.from('bytes'), async () => {
      throw new Error('injected publication failure');
    })).rejects.toBeInstanceOf(IoError);

    expect(await readFile(documentPath).catch(() => undefined)).toBeUndefined();
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
