import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mirrorArtifact } from './artifact-output.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'output');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const filename = `structured-doc-editor-${pkg.version}.vsix`;
const artifactPath = join(outputDir, filename);
const vsceCli = join(root, 'node_modules', '@vscode', 'vsce', 'vsce');

mkdirSync(outputDir, { recursive: true });
execFileSync(
  process.execPath,
  [
    vsceCli,
    'package',
    '--no-dependencies',
    '--out',
    artifactPath,
  ],
  { cwd: root, stdio: 'inherit' },
);

mirrorArtifact(root, artifactPath);
console.log(`VSIX ready: output/${filename}`);
