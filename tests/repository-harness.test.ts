import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const checker = path.join(process.cwd(), 'scripts', 'check-repository-harness.mjs');
const fixtures: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sdoc-harness-'));
  fixtures.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return root;
}

function check(root: string) {
  return spawnSync(process.execPath, [checker, '--root', root], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('repository engineering harness', () => {
  it('rejects duplicate ADR identifiers with remediation', () => {
    const root = fixture({
      'docs/adr/0001-first.md': '# ADR 0001: First\n',
      'docs/adr/0001-second.md': '# ADR 0001: Second\n',
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate ADR identifier 0001');
    expect(result.stderr).toContain('assign the conflicting decision an unused ID');
  });

  it('rejects broken repository-relative paths and heading fragments', () => {
    const root = fixture({
      'README.md': '[missing](docs/missing.md)\n[bad heading](docs/guide.md#absent)\n',
      'docs/guide.md': '# Present\n',
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('broken repository-relative link docs/missing.md');
    expect(result.stderr).toContain('missing Markdown heading #absent');
  });

  it('rejects stale configured-runtime claims and version-coupled current architecture', () => {
    const root = fixture({
      'package.json': JSON.stringify({ devDependencies: { react: '19.2.7' } }),
      'docs/architecture.md': '# Architecture\n\nStructured Doc Editor v1.2.3 has one surface.\n',
      'eslint.config.mjs': '// React 18 application\n',
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('current architecture is coupled to a release version');
    expect(result.stderr).toContain('says React 18, but package.json configures React 19.2.7');
  });

  it('rejects host APIs and delivery-surface dependencies in host-neutral code', () => {
    const root = fixture({
      'shared/converter/bad.ts': "import { readFile } from 'node:fs/promises';\nimport '../../src/extension';\nvoid readFile;\n",
      'src/extension.ts': 'export {};\n',
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('host-neutral shared code imports host API "node:fs/promises"');
    expect(result.stderr).toContain('shared code imports outside shared/');
  });

  it('rejects blocking extension-host I/O and ambient editor bridges', () => {
    const root = fixture({
      'src/blocking.ts': "import { readFileSync } from 'node:fs';\nreadFileSync('document.sdoc');\n",
      'webview-ui/src/ambient.ts': 'window.__hostBridge.postMessage({});\n',
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('extension-host code calls a synchronous filesystem API');
    expect(result.stderr).toContain('editor code uses an ambient window.__* bridge');
  });
});
