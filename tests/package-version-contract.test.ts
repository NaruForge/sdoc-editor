import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/check-versions.mjs');
const temporaryRoots: string[] = [];

function writeManifest(root: string, relativePath: string, manifest: object): void {
  const destination = join(root, relativePath);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function runVersionCheck(options: {
  rootTiptap: Record<string, string>;
  webviewTiptap: Record<string, string>;
}) {
  const root = mkdtempSync(join(tmpdir(), 'sdoc-version-contract-'));
  temporaryRoots.push(root);
  writeManifest(root, 'package.json', {
    version: '1.2.3',
    devDependencies: options.rootTiptap,
  });
  writeManifest(root, 'cli/package.json', { version: '1.2.3' });
  writeManifest(root, 'webview-ui/package.json', {
    dependencies: options.webviewTiptap,
  });
  return spawnSync(process.execPath, [script, '--root', root], {
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('package version contract', () => {
  it('accepts exact matching Tiptap dependencies owned by root and webview', () => {
    const result = runVersionCheck({
      rootTiptap: {
        '@tiptap/core': '3.30.2',
        '@tiptap/react': '3.30.2',
      },
      webviewTiptap: {
        '@tiptap/core': '3.30.2',
        '@tiptap/react': '3.30.2',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 Tiptap packages use 3.30.2');
  });

  it('rejects missing, ranged, and mismatched Tiptap declarations', () => {
    const result = runVersionCheck({
      rootTiptap: {
        '@tiptap/core': '^3.30.2',
        '@tiptap/react': '3.30.1',
      },
      webviewTiptap: {
        '@tiptap/core': '3.30.2',
        '@tiptap/extension-image': '3.30.2',
        '@tiptap/react': '3.30.2',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('@tiptap/core: root version ^3.30.2 must be exact');
    expect(result.stderr).toContain('@tiptap/extension-image: missing from root devDependencies');
    expect(result.stderr).toContain('@tiptap/react: root 3.30.1 does not match webview 3.30.2');
  });
});
