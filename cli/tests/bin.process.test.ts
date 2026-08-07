import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(cliRoot, '..');
const directEntry = resolve(cliRoot, 'dist', 'sdoc.js');
const workspaceEntry = resolve(workspaceRoot, 'node_modules', 'sdoc-editor-cli', 'dist', 'sdoc.js');
const packageBinEntry = resolve(cliRoot, 'bin', 'sdoc.js');
const workspaceBinEntry = resolve(workspaceRoot, 'node_modules', 'sdoc-editor-cli', 'bin', 'sdoc.js');
const sourceResponseSchema = resolve(cliRoot, 'schemas', 'sdoc.cli.response.schema.json');
const builtResponseSchema = resolve(cliRoot, 'dist', 'schemas', 'sdoc.cli.response.schema.json');
let expectedVersion = '';

function executeNode(script: string, args: readonly string[] = [], cwd = workspaceRoot) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

beforeAll(async () => {
  const built = executeNode(resolve(cliRoot, 'build.mjs'), [], cliRoot);
  expect(built.status, built.stderr || built.stdout).toBe(0);
  const packageJson = JSON.parse(await readFile(resolve(cliRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  expectedVersion = `${packageJson.version}\n`;
});

describe('built CLI executable', () => {
  it('copies the versioned response schema into the package tree exactly', async () => {
    expect(await readFile(builtResponseSchema, 'utf8'))
      .toBe(await readFile(sourceResponseSchema, 'utf8'));
  });

  it('runs from the CLI workspace real path and writes the requested output', async () => {
    expect((await realpath(directEntry)).toLowerCase()).toBe(directEntry.toLowerCase());

    const result = executeNode(directEntry, ['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expectedVersion);
    expect(result.stderr).toBe('');
  });

  it('runs through the node_modules workspace junction or symlink and writes the same output', async () => {
    expect((await realpath(workspaceEntry)).toLowerCase())
      .toBe((await realpath(directEntry)).toLowerCase());

    const result = executeNode(workspaceEntry, ['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expectedVersion);
    expect(result.stderr).toBe('');
  });

  it('runs through the tracked package bin wrapper used by npm workspace links', async () => {
    expect((await realpath(workspaceBinEntry)).toLowerCase())
      .toBe((await realpath(packageBinEntry)).toLowerCase());

    const result = executeNode(workspaceBinEntry, ['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expectedVersion);
    expect(result.stderr).toBe('');
  });
});
