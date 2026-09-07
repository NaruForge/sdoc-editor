import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'sdoc-license-gates-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run license gate tests through npm test or npm exec vitest');
const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (typeof manifest !== 'object' || manifest === null || !('scripts' in manifest)
  || typeof manifest.scripts !== 'object' || manifest.scripts === null) throw new Error('Missing repository scripts');
const scripts: Record<string, string> = {};
for (const [name, command] of Object.entries(manifest.scripts)) {
  if (typeof command !== 'string') throw new Error(`Invalid script ${name}`);
  scripts[name] = command;
}
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(fixture, path)), { recursive: true });
  writeFileSync(join(fixture, path), content);
};
const run = (script: string) => {
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: fixture, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, SDOC_OUTPUT_DIR: '' },
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
};
let currentNotice: string;

beforeAll(() => {
  // Run the real command graph and generator against a tiny installed dependency
  // graph; replace only downstream builds/tests so failures cannot create packages.
  const fixtureScripts = Object.fromEntries(Object.keys(scripts).map((name) => [name, 'node -e ""']));
  for (const name of ['verify:fast', 'licenses:check', 'licenses:generate', 'package', 'package:cli']) {
    fixtureScripts[name] = scripts[name];
  }
  fixtureScripts.test = 'node scripts/downstream.cjs';
  write('package.json', JSON.stringify({ name: 'license-gate-fixture', version: '1.0.0', private: true,
    workspaces: ['cli'], dependencies: { 'notice-fixture': '^1.0.0' }, scripts: fixtureScripts }));
  write('cli/package.json', JSON.stringify({ name: 'sdoc-editor-cli', version: '1.0.0',
    scripts: { build: 'node ../scripts/downstream.cjs' } }));
  write('node_modules/notice-fixture/package.json', JSON.stringify({ name: 'notice-fixture', version: '1.0.0', license: 'MIT' }));
  write('node_modules/notice-fixture/LICENSE', 'Fixture license text.\n');
  symlinkSync(join(fixture, 'cli'), join(fixture, 'node_modules/sdoc-editor-cli'), process.platform === 'win32' ? 'junction' : 'dir');
  write('scripts/downstream.cjs', 'console.log("DOWNSTREAM_STARTED");');
  write('node_modules/@vscode/vsce/vsce', 'console.log("DOWNSTREAM_STARTED"); process.exitCode = 37;');
  for (const file of ['generate-third-party-notices.mjs', 'package-cli.mjs', 'package-vsix.mjs', 'artifact-output.mjs']) {
    cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file));
  }
  for (const directory of ['shared/editor/assets/fonts', 'licenses/fonts']) {
    cpSync(join(root, directory), join(fixture, directory), { recursive: true });
  }
  const generated = run('licenses:generate');
  expect(generated.status, generated.output).toBe(0);
  currentNotice = readFileSync(join(fixture, 'THIRD_PARTY_NOTICES.md'), 'utf8');
}, 30_000);

afterAll(() => {
  if (dirname(resolve(fixture)) !== resolve(tmpdir())) throw new Error('Unexpected fixture cleanup path');
  rmSync(fixture, { recursive: true, force: true });
});

describe('third-party notice gates', () => {
  it('accepts a generated notice and rejects dependency drift, then recovers after regeneration', () => {
    expect(run('licenses:check').status).toBe(0);
    write('node_modules/notice-fixture/package.json', JSON.stringify({ name: 'notice-fixture', version: '1.0.1', license: 'MIT' }));
    write('node_modules/notice-fixture/LICENSE', 'Updated fixture license text.\n');
    const stale = run('licenses:check');
    expect(stale.status).not.toBe(0);
    expect(stale.output).toContain('THIRD_PARTY_NOTICES.md is stale');
    expect(run('licenses:generate').status).toBe(0);
    expect(run('licenses:check').status).toBe(0);
    expect(readFileSync(join(fixture, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toContain('| notice-fixture | 1.0.1 |');
    write('node_modules/notice-fixture/package.json', JSON.stringify({ name: 'notice-fixture', version: '1.0.0', license: 'MIT' }));
    write('node_modules/notice-fixture/LICENSE', 'Fixture license text.\n');
    write('THIRD_PARTY_NOTICES.md', currentNotice);
  }, 30_000);

  it.each(['verify:fast', 'package', 'package:cli'])('%s rejects a missing notice without regenerating it', (script) => {
    rmSync(join(fixture, 'THIRD_PARTY_NOTICES.md'));
    const result = run(script);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('THIRD_PARTY_NOTICES.md is missing');
    expect(result.output).not.toContain('DOWNSTREAM_STARTED');
    expect(existsSync(join(fixture, 'THIRD_PARTY_NOTICES.md'))).toBe(false);
    expect(existsSync(join(fixture, 'output'))).toBe(false);
    write('THIRD_PARTY_NOTICES.md', currentNotice);
  }, 30_000);

  it.each(['verify:fast', 'package', 'package:cli'])('%s rejects a stale notice before downstream work', (script) => {
    write('THIRD_PARTY_NOTICES.md', `${currentNotice}\nStale inventory.\n`);
    const result = run(script);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('THIRD_PARTY_NOTICES.md is stale');
    expect(result.output).not.toContain('DOWNSTREAM_STARTED');
    expect(readFileSync(join(fixture, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toContain('Stale inventory.');
    expect(existsSync(join(fixture, 'output'))).toBe(false);
    write('THIRD_PARTY_NOTICES.md', currentNotice);
  }, 30_000);

  it('allows common verification to continue with current CRLF notices', () => {
    write('THIRD_PARTY_NOTICES.md', currentNotice.replace(/\n/g, '\r\n'));
    const result = run('verify:fast');
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('DOWNSTREAM_STARTED');
  }, 30_000);
});
