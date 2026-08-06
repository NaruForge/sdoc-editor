import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runTests } from '@vscode/test-electron';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const workspacePath = await mkdtemp(path.join(tmpdir(), 'sdoc-vscode-host-'));
try {
  await cp(path.join(repositoryRoot, 'tests', 'vscode', 'workspace'), workspacePath, {
    recursive: true,
  });
  await runTests({
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    extensionDevelopmentPath: repositoryRoot,
    extensionTestsPath: path.join(repositoryRoot, 'tests', 'vscode', 'suite', 'index.cjs'),
    launchArgs: [
      workspacePath,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
} catch (error) {
  console.error('VS Code Extension Host tests failed:', error);
  process.exitCode = 1;
} finally {
  await rm(workspacePath, { recursive: true, force: true });
}
