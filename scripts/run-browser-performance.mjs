import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const corpusArgument = process.argv.find((argument) => argument.startsWith('--corpus='));
const corpus = corpusArgument?.slice('--corpus='.length) || 'text-5k';
const port = process.env.SDOC_BROWSER_PERF_PORT || '4407';
const supportedCorpora = new Set(['text-5k', 'text-10k', 'structure-10k']);
if (!supportedCorpora.has(corpus)) {
  throw new Error(`Unsupported browser performance corpus: ${corpus}`);
}

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    playwrightCli,
    'test',
    '--config',
    'tests/ui/playwright.config.ts',
    'editor-performance.spec.ts',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SDOC_BROWSER_PERF_CORPUS: corpus,
      SDOC_UI_TEST_PORT: port,
    },
    stdio: 'inherit',
  });
  child.on('error', reject);
  child.on('exit', (code) => resolve(code ?? 1));
});

if (exitCode !== 0) process.exit(exitCode);

const reportPath = path.resolve('tests/ui/artifacts/performance/browser.json');
process.stdout.write(await readFile(reportPath, 'utf8'));
