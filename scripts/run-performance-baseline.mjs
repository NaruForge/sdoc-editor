import { build } from 'esbuild';

const result = await build({
  entryPoints: ['tests/performance/runBaseline.ts'],
  absWorkingDir: process.cwd(),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  write: false,
  logLevel: 'warning',
});

const output = result.outputFiles?.[0];
if (!output) throw new Error('performance baseline bundle was not produced');

await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`);
