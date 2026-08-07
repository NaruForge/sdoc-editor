import { build } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const dist = new URL('./dist/', import.meta.url);

await build({
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/sdoc.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  sourcemap: false,
});

await rm(new URL('./schemas/', dist), { recursive: true, force: true });
await rm(new URL('./examples/', dist), { recursive: true, force: true });
await mkdir(new URL('./schemas/', dist), { recursive: true });
await mkdir(new URL('./examples/operations/', dist), { recursive: true });
await cp(new URL('../sdoc.schema.json', import.meta.url), new URL('./schemas/sdoc.schema.json', dist));
await cp(
  new URL('../sdoc.operations.schema.json', import.meta.url),
  new URL('./schemas/sdoc.operations.schema.json', dist),
);
await cp(
  new URL('../sdoc.read.schema.json', import.meta.url),
  new URL('./schemas/sdoc.read.schema.json', dist),
);
await cp(
  new URL('./schemas/sdoc.cli.response.schema.json', import.meta.url),
  new URL('./schemas/sdoc.cli.response.schema.json', dist),
);
await cp(
  new URL('../examples/operations/', import.meta.url),
  new URL('./examples/operations/', dist),
  { recursive: true },
);
