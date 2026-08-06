import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import {
  ContainedFileError,
  readContainedTextFile,
  resolveContainedRegularFile,
} from '../src/utils/containedFile';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; outside: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'sdoc-contained-'));
  temporaryDirectories.push(parent);
  const root = path.join(parent, 'workspace');
  const outside = path.join(parent, 'outside');
  await Promise.all([mkdir(root), mkdir(outside)]);
  return { root, outside };
}

describe('contained regular files', () => {
  it('reads a bounded CSS file inside the approved root', async () => {
    const { root } = await fixture();
    await writeFile(path.join(root, 'theme.css'), 'body { color: red; }');
    await expect(readContainedTextFile(root, './theme.css', {
      extension: '.css', maximumBytes: 1024,
    })).resolves.toContain('color: red');
  });

  it('rejects traversal, absolute paths, wrong extensions, and oversized files', async () => {
    const { root, outside } = await fixture();
    const outsideCss = path.join(outside, 'secret.css');
    await writeFile(outsideCss, 'secret');
    await writeFile(path.join(root, 'theme.txt'), 'text');
    await writeFile(path.join(root, 'large.css'), 'x'.repeat(5));

    for (const candidate of ['../outside/secret.css', outsideCss]) {
      await expect(resolveContainedRegularFile(root, candidate, {
        extension: '.css', maximumBytes: 1024,
      })).rejects.toMatchObject<Partial<ContainedFileError>>({ code: 'UNSAFE_PATH' });
    }
    await expect(resolveContainedRegularFile(root, './theme.txt', {
      extension: '.css', maximumBytes: 1024,
    })).rejects.toMatchObject<Partial<ContainedFileError>>({ code: 'WRONG_EXTENSION' });
    await expect(resolveContainedRegularFile(root, './large.css', {
      extension: '.css', maximumBytes: 4,
    })).rejects.toMatchObject<Partial<ContainedFileError>>({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects a symlink that escapes the approved root', async () => {
    const { root, outside } = await fixture();
    const target = path.join(outside, 'secret.css');
    await writeFile(target, 'secret');
    const link = path.join(root, 'linked.css');
    try {
      await symlink(target, link, 'file');
    } catch {
      return;
    }
    await expect(resolveContainedRegularFile(root, './linked.css', {
      extension: '.css', maximumBytes: 1024,
    })).rejects.toMatchObject<Partial<ContainedFileError>>({ code: 'UNSAFE_PATH' });
  });
});
