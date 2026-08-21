import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageFile = path.join(root, 'output', `structured-doc-editor-${manifest.version}.vsix`);
const arguments_ = new Set(process.argv.slice(2));
const runExtensionHost = arguments_.delete('--extension-host');

if (arguments_.size > 0) {
  throw new Error(`Unknown VSIX verification option(s): ${[...arguments_].join(', ')}`);
}
if (!existsSync(packageFile)) {
  throw new Error(`Expected VSIX does not exist: ${packageFile}. Run npm run verify:package:vscode first.`);
}

const archive = await JSZip.loadAsync(await readFile(packageFile));
const entries = Object.values(archive.files);
const entryNames = new Set(entries.map((entry) => entry.name));
const requiredEntries = [
  'extension/dist/extension.js',
  'extension/dist/webview/assets/index.js',
  'extension/dist/webview/assets/book.js',
  'extension/dist/webview/assets/webview.css',
];

for (const required of requiredEntries) {
  if (!entryNames.has(required)) {
    throw new Error(`Packaged VSIX is missing ${required}. Rebuild the extension and inspect the packaging include/exclude rules.`);
  }
}

const stylesheets = entries.filter((entry) => (
  !entry.dir && /^extension\/dist\/webview\/assets\/[^/]+\.css$/.test(entry.name)
));
if (stylesheets.length !== 1 || stylesheets[0].name !== 'extension/dist/webview/assets/webview.css') {
  throw new Error(`Expected one canonical packaged webview stylesheet, found: ${stylesheets.map((entry) => entry.name).join(', ') || '(none)'}.`);
}

const stylesheet = await stylesheets[0].async('string');
for (const selector of ['.editor-shell{', '.activity-bar{', '.book-workspace{', '.katex{']) {
  if (!stylesheet.includes(selector)) {
    throw new Error(`Packaged webview stylesheet is missing ${selector}. Check the shared editor CSS build and VSIX packaging inputs.`);
  }
}

console.log('VSIX contents and editor stylesheet checks passed.');

if (runExtensionHost) {
  const extractRoot = await mkdtemp(path.join(tmpdir(), 'sdoc-vsix-package-'));
  try {
    for (const entry of entries) {
      if (entry.dir || !entry.name.startsWith('extension/')) continue;
      const segments = entry.name.split('/');
      if (entry.name.includes('\\') || entry.name.startsWith('/') || segments.includes('..')) {
        throw new Error(`Refusing unsafe VSIX entry path: ${entry.name}`);
      }
      const target = path.join(extractRoot, ...segments);
      const relativeTarget = path.relative(extractRoot, target);
      if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        throw new Error(`Refusing VSIX entry outside extraction root: ${entry.name}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await entry.async('nodebuffer'));
    }

    const testRunner = path.join(root, 'tests', 'vscode', 'run.mjs');
    const options = {
      cwd: root,
      env: {
        ...process.env,
        SDOC_EXTENSION_PATH: path.join(extractRoot, 'extension'),
      },
      stdio: 'inherit',
    };
    if (process.platform === 'linux' && !process.env.DISPLAY) {
      execFileSync('xvfb-run', ['-a', process.execPath, testRunner], options);
    } else {
      execFileSync(process.execPath, [testRunner], options);
    }
    console.log('Packaged VSIX Extension Host checks passed.');
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}
