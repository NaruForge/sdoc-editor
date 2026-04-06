import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outputDir = join(root, 'output');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const version = pkg.version;
const vsixName = `structured-doc-editor-${version}.vsix`;

mkdirSync(outputDir, { recursive: true });

// Package VSIX directly into output/
// Note: vsce runs vscode:prepublish which includes build + clean:dist
execSync(
  `npx @vscode/vsce package --allow-missing-repository --no-dependencies --out "${join(outputDir, vsixName)}"`,
  { cwd: root, stdio: 'inherit' }
);

// Generate version.json
const versionJson = {
  version,
  filename: vsixName,
};
writeFileSync(join(outputDir, 'version.json'), JSON.stringify(versionJson, null, 2) + '\n');

console.log(`\n📦 Output ready in ./output/`);
console.log(`   - ${vsixName}`);
console.log(`   - version.json (v${version})`);
