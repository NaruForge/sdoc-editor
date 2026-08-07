import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('packaged read contract', () => {
  it('copies the root read schema and lists it in the exact package manifest', async () => {
    const root = resolve(import.meta.dirname, '..', '..');
    const packageJson = JSON.parse(await readFile(resolve(root, 'cli', 'package.json'), 'utf8')) as {
      files: string[];
    };
    const build = await readFile(resolve(root, 'cli', 'build.mjs'), 'utf8');
    const pack = await readFile(resolve(root, 'scripts', 'package-cli.mjs'), 'utf8');

    expect(packageJson.files).toContain('dist/schemas/*.json');
    expect(build).toContain("new URL('../sdoc.read.schema.json', import.meta.url)");
    expect(build).toContain("new URL('./schemas/sdoc.read.schema.json', dist)");
    expect(pack).toContain("'dist/schemas/sdoc.read.schema.json'");
  });
});
