import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'output');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const filename = `structured-doc-editor-${pkg.version}.vsix`;
const vsceCli = join(root, 'node_modules', '@vscode', 'vsce', 'vsce');

mkdirSync(outputDir, { recursive: true });
execFileSync(
  process.execPath,
  [
    vsceCli,
    'package',
    '--no-dependencies',
    '--out',
    join(outputDir, filename),
  ],
  { cwd: root, stdio: 'inherit' },
);

writeFileSync(
  join(outputDir, 'version.json'),
  `${JSON.stringify({ version: pkg.version, filename }, null, 2)}\n`,
);

console.log(`VSIX ready: output/${filename}`);
