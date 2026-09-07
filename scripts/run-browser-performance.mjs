import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const corpusArgument = process.argv.find((argument) => argument.startsWith('--corpus='));
const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='));
const scenario = scenarioArgument?.slice('--scenario='.length) || 'ordinary';
if (!['ordinary', 'lowlight'].includes(scenario)) throw new Error(`Unsupported scenario: ${scenario}`);
const corpus = corpusArgument?.slice('--corpus='.length) || (scenario === 'lowlight' ? 'rich-mixed-5k' : 'text-5k');
if (scenario === 'lowlight' && corpus !== 'rich-mixed-5k') {
  throw new Error('The lowlight scenario uses the fixed rich-mixed-5k corpus');
}
const port = process.env.SDOC_BROWSER_PERF_PORT || '4407';
const supportedCorpora = new Set([
  'text-5k',
  'text-10k',
  'structure-10k',
  'rich-mixed-5k',
  'rich-balanced-5k',
]);
if (!supportedCorpora.has(corpus)) {
  throw new Error(`Unsupported browser performance corpus: ${corpus}`);
}

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    playwrightCli,
    'test',
    '--config',
    'tests/ui/playwright.config.ts',
    scenario === 'lowlight' ? 'editor-lowlight-performance.spec.ts' : 'editor-performance.spec.ts',
    ...(process.env.SDOC_BROWSER_PERF_REVIEW === '1' ? ['--workers=1', '--retries=0'] : []),
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

const reportPath = path.resolve(`tests/ui/artifacts/performance/${scenario === 'lowlight' ? 'lowlight' : 'browser'}.json`);
process.stdout.write(await readFile(reportPath, 'utf8'));
