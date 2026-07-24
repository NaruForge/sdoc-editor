import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'output');
const cliDir = join(root, 'cli');
const pkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('npm_execpath is unavailable; run package:cli through npm');
}

mkdirSync(outputDir, { recursive: true });
execFileSync(process.execPath, [npmCli, 'run', 'build', '--workspace=sdoc-editor-cli'], {
  cwd: root,
  stdio: 'inherit',
});
const packOutput = execFileSync(
  process.execPath,
  [npmCli, 'pack', cliDir, '--pack-destination', outputDir, '--json'],
  { cwd: root, encoding: 'utf8' },
);
const [packed] = JSON.parse(packOutput);
const actualFiles = packed.files.map((entry) => entry.path).sort();
const expectedFiles = ['LICENSE', 'README.md', 'dist/sdoc.js', 'package.json'];
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected CLI package contents: ${actualFiles.join(', ')}`);
}

console.log(`CLI package ready: output/${pkg.name}-${pkg.version}.tgz`);
