import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
});

const mcpCtx = await esbuild.context({
  entryPoints: ['src/mcp/server.ts'],
  bundle: true,
  outfile: 'dist/mcp-server.js',
  external: [],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  await mcpCtx.watch();
  console.log('Watching for changes...');
} else {
  await ctx.rebuild();
  await mcpCtx.rebuild();
  await ctx.dispose();
  await mcpCtx.dispose();
}
