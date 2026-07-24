import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/sdoc.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  sourcemap: false,
});
