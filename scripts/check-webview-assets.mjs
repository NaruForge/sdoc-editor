import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webviewRoot = join(root, 'dist', 'webview');
const assetsRoot = join(webviewRoot, 'assets');
const expectedStylesheet = 'webview.css';

function fail(message) {
  throw new Error(`Webview asset contract failed: ${message}`);
}

const cssAssets = readdirSync(assetsRoot)
  .filter((name) => name.endsWith('.css'))
  .sort();

if (cssAssets.length !== 1 || cssAssets[0] !== expectedStylesheet) {
  fail(`expected only ${expectedStylesheet}, found ${cssAssets.join(', ') || 'no CSS assets'}`);
}

const css = readFileSync(join(assetsRoot, expectedStylesheet), 'utf8');
for (const selector of ['.editor-shell{', '.activity-bar{', '.book-workspace{', '.katex{']) {
  if (!css.includes(selector)) fail(`${expectedStylesheet} is missing ${selector}`);
}

for (const entry of ['index', 'book']) {
  const html = readFileSync(join(webviewRoot, `${entry}.html`), 'utf8');
  const expectedHref = `./assets/${expectedStylesheet}`;
  if (!html.includes(expectedHref)) fail(`${entry}.html does not reference ${expectedHref}`);
}

console.log(
  `Webview asset contract passed: ${expectedStylesheet} contains standalone, Book, and KaTeX styles.`,
);
