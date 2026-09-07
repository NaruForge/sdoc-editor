import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runTests } from '@vscode/test-electron';
import { resolveVSCodeTestVersion, selectVSCodeTestVersions } from './versions.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = process.env.SDOC_EXTENSION_PATH
  ? path.resolve(process.env.SDOC_EXTENSION_PATH)
  : repositoryRoot;
process.env.SDOC_VSCODE_UI_TEST = '1';

const requestedVersions = selectVSCodeTestVersions(process.argv.slice(2), process.env.VSCODE_TEST_VERSION);
for (const requested of requestedVersions) {
  let runPath;
  try {
    const manifest = JSON.parse(await readFile(path.join(extensionPath, 'package.json'), 'utf8'));
    const { version, minimum, expectedVersion } = resolveVSCodeTestVersion(manifest, requested);
    console.log(`VS Code Host target: ${requested} -> ${version}; manifest minimum: ${minimum}`);
    runPath = await mkdtemp(path.join(tmpdir(), 'sdoc-vscode-host-'));
    const workspacePath = path.join(runPath, 'workspace');
    await cp(path.join(repositoryRoot, 'tests', 'vscode', 'workspace'), workspacePath, {
      recursive: true,
    });
    await runTests({
      version,
      extensionDevelopmentPath: extensionPath,
      extensionTestsPath: path.join(repositoryRoot, 'tests', 'vscode', 'suite', 'index.cjs'),
      extensionTestsEnv: { SDOC_EXPECTED_VSCODE_VERSION: expectedVersion },
      launchArgs: [
        workspacePath,
        `--user-data-dir=${path.join(runPath, 'user-data')}`,
        `--extensions-dir=${path.join(runPath, 'extensions')}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
      ],
    });
  } catch (error) {
    console.error(`VS Code Extension Host tests failed (${requested}):`, error);
    process.exitCode = 1;
    break;
  } finally {
    if (runPath) await rm(runPath, { recursive: true, force: true });
  }
}
