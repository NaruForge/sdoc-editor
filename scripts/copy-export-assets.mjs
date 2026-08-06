import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destinationRoot = path.join(repositoryRoot, 'dist', 'export-assets');
const katexRoot = path.join(repositoryRoot, 'node_modules', 'katex', 'dist');
const mermaidRoot = path.join(repositoryRoot, 'node_modules', 'mermaid', 'dist');

await rm(destinationRoot, { recursive: true, force: true });
await mkdir(path.join(destinationRoot, 'fonts'), { recursive: true });

await Promise.all([
  copyFile(path.join(katexRoot, 'katex.min.css'), path.join(destinationRoot, 'katex.min.css')),
  copyFile(path.join(katexRoot, 'katex.min.js'), path.join(destinationRoot, 'katex.min.js')),
  copyFile(
    path.join(katexRoot, 'contrib', 'auto-render.min.js'),
    path.join(destinationRoot, 'auto-render.min.js'),
  ),
  copyFile(path.join(mermaidRoot, 'mermaid.min.js'), path.join(destinationRoot, 'mermaid.min.js')),
]);

const fontNames = (await readdir(path.join(katexRoot, 'fonts')))
  .filter((name) => name.endsWith('.woff2'));
await Promise.all(fontNames.map((name) => copyFile(
  path.join(katexRoot, 'fonts', name),
  path.join(destinationRoot, 'fonts', name),
)));

console.log(`Copied offline export runtime (${fontNames.length} KaTeX fonts).`);
