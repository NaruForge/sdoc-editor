import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

const outfile = 'output/validation-performance.cjs';
await build({
  entryPoints: ['tests/performance/runValidation.ts'], outfile,
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'warning',
});
const result = spawnSync(process.execPath, ['--expose-gc', outfile, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
