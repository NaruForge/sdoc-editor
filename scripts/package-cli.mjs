import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mirrorArtifact } from './artifact-output.mjs';

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
const expectedFiles = [
  'LICENSE',
  'README.md',
  'dist/examples/operations/delete-block.json',
  'dist/examples/operations/delete-section.json',
  'dist/examples/operations/insert-block.json',
  'dist/examples/operations/insert-section.json',
  'dist/examples/operations/move-block.json',
  'dist/examples/operations/move-section.json',
  'dist/examples/operations/rename-heading.json',
  'dist/examples/operations/replace-block.json',
  'dist/examples/operations/update-block-attrs.json',
  'dist/schemas/sdoc.operations.schema.json',
  'dist/schemas/sdoc.schema.json',
  'dist/sdoc.js',
  'package.json',
].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected CLI package contents: ${actualFiles.join(', ')}`);
}

mirrorArtifact(root, join(outputDir, packed.filename));
console.log(`CLI package ready: output/${pkg.name}-${pkg.version}.tgz`);
