import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicReplace, IoError } from '../src/io.js';

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
