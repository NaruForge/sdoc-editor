import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reviewRichBrowserRun, type RichBrowserReview } from '../../shared/performance/browserReleaseReview';

interface MeasurementResult { exitCode: number; output: string }
interface ReviewOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  runMeasurement?: (env: NodeJS.ProcessEnv) => Promise<MeasurementResult>;
}

const git = (root: string, args: string[]): string => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'unknown'; }
};

const readUnknown = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
const versionOf = async (file: string): Promise<string> => {
  try {
    const value = await readUnknown(file);
    if (typeof value === 'object' && value !== null && 'version' in value && typeof value.version === 'string') return value.version;
  } catch { /* Setup failures still produce an error report. */ }
  return 'unavailable';
};
const browserVersionOf = (value: unknown): string => {
  if (typeof value === 'object' && value !== null && 'context' in value
    && typeof value.context === 'object' && value.context !== null && 'browserVersion' in value.context
    && typeof value.context.browserVersion === 'string') return value.context.browserVersion;
  return 'unavailable';
};
const escapeMarkdown = (text: string): string => text.replace(/[\r\n]+/gu, ' ')
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  .replace(/([\\`*_{}\[\]()#+.!|])/gu, '\\$1');

function summary(review: RichBrowserReview, commit: string, dirty: boolean): string {
  const lines = [
    '# Rich browser release review', '',
    `Result: **${review.status}**`, `Measured commit: \`${commit}\``,
    `Source tree: ${dirty ? 'modified (not an exact-commit measurement)' : 'clean'}`, '',
    'Harness: Vite development Chromium; fixed rich-mixed-5k; 3 opens / 30 inputs / 15 scrolls / 15 navigations.',
    'Budget misses are advisory, not a passing budget result. Measurement errors block the release review.', '',
  ];
  if (review.assessment) {
    lines.push('| Metric | Measured | Budget | Result |', '|---|---:|---:|---|');
    for (const metric of review.assessment.metrics) {
      lines.push(`| ${metric.name} | ${metric.actual.toFixed(2)} ${metric.unit} | ${metric.comparison} ${metric.limit} ${metric.unit} | ${metric.passed ? 'within' : 'NOT MET'} |`);
    }
    lines.push('');
  }
  if (review.error) lines.push(`Measurement error: ${escapeMarkdown(review.error)}`, '');
  if (review.acceptance) lines.push(
    `Explicit reviewer: ${escapeMarkdown(review.acceptance.reviewer)}`,
    `Reason for this run/commit: ${escapeMarkdown(review.acceptance.reason)}`, '',
  );
  else lines.push('No explicit risk acceptance was supplied for this run.', '');
  lines.push(
    'Artifacts: review.json (environment, source, decision), measurement.log, raw browser JSON and per-run samples; Playwright failure evidence when available.', '',
    '[Prior #216 decision](https://github.com/SWBaek/sdoc-editor/issues/216#issuecomment-5447837216) is historical context, not automatic acceptance of this result.',
    'This is not production-bundle latency evidence. Production comparisons must retain the corpus/capture points and be labeled separately.', '',
  );
  return lines.join('\n');
}

export async function runReleaseReview(options: ReviewOptions = {}): Promise<number> {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;
  const rawDirectory = path.join(root, 'tests/ui/artifacts/performance');
  const directory = path.join(root, 'tests/ui/artifacts/performance-release');
  await mkdir(directory, { recursive: true });
  const commit = git(root, ['rev-parse', 'HEAD']);
  const dirty = git(root, ['diff', '--name-only', 'HEAD']) !== ''
    || git(root, ['ls-files', '--others', '--exclude-standard']) !== '';
  const startedAt = new Date().toISOString();
  const unfinished: RichBrowserReview = { status: 'measurement-error', error: 'Measurement has not completed.' };
  // Invalidate the previous decision before launching. Cancellation must not
  // leave a prior successful review looking like the result of this run.
  await writeFile(path.join(directory, 'review.json'), `${JSON.stringify({
    schemaVersion: 1, startedAt, source: { commit, dirty }, ...unfinished,
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(directory, 'summary.md'), summary(unfinished, commit, dirty), 'utf8');
  await writeFile(path.join(directory, 'measurement.log'), '', 'utf8');
  // Clear only this command's known raw outputs. A failed browser start must not
  // accidentally review samples from an earlier successful run.
  for (const name of ['browser.json', 'browser-rich-mixed-5k.json', 'browser-budget.json', 'browser-incomplete.json',
    'browser-run-0.json', 'browser-run-1.json', 'browser-run-2.json']) {
    await rm(path.join(rawDirectory, name), { force: true });
  }
  const measurementEnv = {
    ...env, CI: 'true', SDOC_BROWSER_PERF_REVIEW: '1', SDOC_BROWSER_PERF_RUNS: '3',
    SDOC_BROWSER_PERF_CORPUS: 'rich-mixed-5k',
  };
  const run = options.runMeasurement ?? ((childEnv: NodeJS.ProcessEnv) => new Promise<MeasurementResult>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/run-browser-performance.mjs'), '--corpus=rich-mixed-5k'], {
      cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ exitCode: code ?? 1, output }));
  }));
  let result: MeasurementResult;
  try { result = await run(measurementEnv); }
  catch (error) { result = { exitCode: 1, output: error instanceof Error ? error.message : 'Browser process could not start' }; }
  await writeFile(path.join(directory, 'measurement.log'), result.output, 'utf8');
  let raw: unknown;
  try { raw = await readUnknown(path.join(rawDirectory, 'browser-rich-mixed-5k.json')); }
  catch { raw = undefined; }
  const reason = env.SDOC_PERF_ACCEPT_REASON?.trim();
  const review = reviewRichBrowserRun(raw, result.exitCode, reason ? {
    reviewer: env.GITHUB_ACTOR?.trim() || env.SDOC_PERF_REVIEWER?.trim() || '', reason,
  } : undefined);
  let lockfileSha256 = 'unavailable';
  try { lockfileSha256 = createHash('sha256').update(await readFile(path.join(root, 'package-lock.json'))).digest('hex'); }
  catch { /* A failed setup still leaves a review record. */ }
  const evidence = {
    schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
    source: { commit, ref: env.SDOC_REVIEW_REF || git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty, lockfileSha256 },
    environment: {
      platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version,
      playwright: await versionOf(path.join(root, 'node_modules/@playwright/test/package.json')),
      chromium: browserVersionOf(raw),
      npmUserAgent: env.npm_config_user_agent ?? 'unknown', runnerOs: env.RUNNER_OS ?? 'local',
      runnerImage: env.ImageOS ?? 'local', runnerImageVersion: env.ImageVersion ?? 'local',
    },
    command: 'npm run perf:browser -- --corpus=rich-mixed-5k',
    harness: 'vite-development', workers: 1, retries: 0, runs: 3,
    budgetPolicy: 'advisory', measurementExitCode: result.exitCode,
    rawReport: '../performance/browser-rich-mixed-5k.json', ...review,
  };
  await writeFile(path.join(directory, 'review.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const markdown = summary(review, commit, dirty);
  await writeFile(path.join(directory, 'summary.md'), markdown, 'utf8');
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `status=${review.status}\n`, 'utf8');
  process.stdout.write(`Rich browser release review: ${review.status}\n`);
  if (review.status === 'below-budget') {
    const prefix = env.GITHUB_ACTIONS === 'true' ? '::warning title=Rich browser budget not met::' : 'Warning: ';
    process.stdout.write(`${prefix}See performance review artifacts; no explicit risk acceptance was supplied.\n`);
  }
  return review.status === 'measurement-error' ? 1 : 0;
}
