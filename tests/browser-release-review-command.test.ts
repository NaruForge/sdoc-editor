import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureBrowserMeasurement, runReleaseReview } from './performance/releaseReview';
import { richReport } from './performance/reviewFixture';

let root: string;
const rawPath = () => path.join(root, 'tests/ui/artifacts/performance/browser-rich-mixed-5k.json');
const artifact = (name: string) => path.join(root, 'tests/ui/artifacts/performance-release', name);
const writeReport = async (report = richReport()) => {
  await mkdir(path.dirname(rawPath()), { recursive: true });
  await writeFile(rawPath(), JSON.stringify(report), 'utf8');
};
const readReview = async (): Promise<unknown> => JSON.parse(await readFile(artifact('review.json'), 'utf8'));

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'sdoc-perf-review-')); });
afterEach(async () => {
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture path');
  await rm(root, { recursive: true, force: true });
});

describe('release review execution and evidence', () => {
  it('forces the fixed measurement environment and writes pass evidence and GitHub outputs', async () => {
    const summary = path.join(root, 'step-summary.md');
    const output = path.join(root, 'step-output.txt');
    const result = await runReleaseReview({ root,
      env: { SDOC_BROWSER_PERF_RUNS: '1', SDOC_BROWSER_PERF_CORPUS: 'text-5k', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output },
      runMeasurement: async (env) => {
        expect(await readReview()).toMatchObject({ status: 'measurement-error', error: 'Measurement has not completed.' });
        expect(env).toMatchObject({ CI: 'true', SDOC_BROWSER_PERF_RUNS: '3',
          SDOC_BROWSER_PERF_CORPUS: 'rich-mixed-5k', SDOC_BROWSER_PERF_REVIEW: '1' });
        await writeReport();
        return { exitCode: 0, output: 'browser completed' };
      },
    });
    expect(result).toBe(0);
    expect(await readReview()).toMatchObject({ status: 'within-budget', harness: 'vite-development',
      workers: 1, retries: 0, runs: 3, measurementExitCode: 0 });
    expect(await readFile(output, 'utf8')).toBe('status=within-budget\n');
    expect(await readFile(summary, 'utf8')).toContain('**within-budget**');
    expect(await readFile(artifact('measurement.log'), 'utf8')).toBe('browser completed');
  });

  it('retains budget misses as advisory and records an explicit acceptance separately', async () => {
    const runMeasurement = async () => {
      const report = richReport();
      report.measurements.filter((sample) => sample.name === 'key-to-next-paint')
        .forEach((sample) => { sample.durationMs = 60; });
      await writeReport(report);
      return { exitCode: 0, output: 'measured over budget' };
    };
    expect(await runReleaseReview({ root, env: {}, runMeasurement })).toBe(0);
    expect(await readReview()).toMatchObject({ status: 'below-budget', assessment: { status: 'below-budget' } });
    expect(await runReleaseReview({ root,
      env: { GITHUB_ACTOR: 'maintainer', SDOC_PERF_ACCEPT_REASON: 'Reviewed <details> | bounded variance' }, runMeasurement,
    })).toBe(0);
    expect(await readReview()).toMatchObject({ status: 'risk-accepted', assessment: { status: 'below-budget' },
      acceptance: { reviewer: 'maintainer', reason: 'Reviewed <details> | bounded variance' } });
    expect(await readFile(artifact('summary.md'), 'utf8')).toContain('&lt;details&gt;');
  });

  it('removes stale samples and preserves logs when the measurement cannot start', async () => {
    await writeReport();
    await mkdir(path.dirname(artifact('review.json')), { recursive: true });
    await writeFile(artifact('review.json'), '{"status":"within-budget"}', 'utf8');
    const result = await runReleaseReview({ root, env: {}, runMeasurement: async () => {
      expect(existsSync(rawPath())).toBe(false);
      expect(await readReview()).toMatchObject({ status: 'measurement-error' });
      throw new Error('injected launch failure');
    } });
    expect(result).toBe(1);
    expect(await readReview()).toMatchObject({ status: 'measurement-error', measurementExitCode: 1 });
    expect(await readFile(artifact('measurement.log'), 'utf8')).toContain('injected launch failure');
    expect(existsSync(rawPath())).toBe(false);
  });

  it('preserves incomplete evidence and never accepts a failed functional command', async () => {
    expect(await runReleaseReview({ root,
      env: { GITHUB_ACTOR: 'maintainer', SDOC_PERF_ACCEPT_REASON: 'does not waive errors' },
      runMeasurement: async () => { await writeReport(); return { exitCode: 1, output: 'functional assertion failed' }; },
    })).toBe(1);
    expect(await readReview()).toMatchObject({ status: 'measurement-error' });
    expect(existsSync(rawPath())).toBe(true);
    expect(await runReleaseReview({ root, env: {}, runMeasurement: async () => ({ exitCode: 0, output: 'missing raw data' }) })).toBe(1);
    expect(await readReview()).toMatchObject({ status: 'measurement-error' });
  });

  it('does not reuse an original actor\'s acceptance on a rerun by another actor', async () => {
    const runMeasurement = async () => {
      const report = richReport();
      report.context.domNodeCount = 60_000;
      await writeReport(report);
      return { exitCode: 0 };
    };
    expect(await runReleaseReview({ root, runMeasurement, env: {
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_ACTOR: 'alice',
      GITHUB_TRIGGERING_ACTOR: 'bob', SDOC_PERF_ACCEPT_REASON: 'Original run rationale',
    } })).toBe(0);
    expect(await readReview()).toMatchObject({ status: 'below-budget',
      github: { runId: '123', runAttempt: '2', actor: 'alice', triggeringActor: 'bob' },
      ignoredInheritedAcceptance: { reason: 'Original run rationale' } });
    expect(await readReview()).not.toHaveProperty('acceptance');
    expect(await readFile(artifact('summary.md'), 'utf8')).toContain('Inherited risk acceptance was ignored');
    expect(await runReleaseReview({ root, runMeasurement, env: {
      GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1', GITHUB_ACTOR: 'bob',
      GITHUB_TRIGGERING_ACTOR: 'bob', SDOC_PERF_ACCEPT_REASON: 'New dispatch rationale',
    } })).toBe(0);
    expect(await readReview()).toMatchObject({ status: 'risk-accepted',
      acceptance: { reviewer: 'bob', reason: 'New dispatch rationale' } });
  });

  it('persists child stdout and stderr before completion and retains them on cancellation', async () => {
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await mkdir(path.dirname(artifact('measurement.log')), { recursive: true });
    await writeFile(path.join(root, 'scripts/run-browser-performance.mjs'),
      'process.stdout.write("early stdout\\n"); process.stderr.write("early stderr\\n"); setInterval(() => {}, 1000);', 'utf8');
    const controller = new AbortController();
    let settled = false;
    const pending = captureBrowserMeasurement(root, {}, artifact('measurement.log'), controller.signal)
      .then((result) => { settled = true; return result; });
    try {
      await vi.waitFor(async () => {
        const log = await readFile(artifact('measurement.log'), 'utf8');
        expect(log).toContain('early stdout');
        expect(log).toContain('early stderr');
      });
      expect(settled).toBe(false);
    } finally { controller.abort(); }
    expect((await pending).exitCode).toBe(1);
    expect(await readFile(artifact('measurement.log'), 'utf8')).toContain('early stdout');
  });

  it('delivers the final child pipe output before reporting completion', async () => {
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await mkdir(path.dirname(artifact('measurement.log')), { recursive: true });
    await writeFile(path.join(root, 'scripts/run-browser-performance.mjs'),
      'process.stdout.write("final stdout\\n"); process.stderr.write("final stderr\\n");', 'utf8');
    expect((await captureBrowserMeasurement(root, {}, artifact('measurement.log'))).exitCode).toBe(0);
    const log = await readFile(artifact('measurement.log'), 'utf8');
    expect(log).toContain('final stdout');
    expect(log).toContain('final stderr');
  });

  it('emits only the exact clean measured commit for a publishing checkout', async () => {
    await writeFile(path.join(root, '.gitignore'), 'tests/\n', 'utf8');
    await writeFile(path.join(root, 'source.txt'), 'original\n', 'utf8');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init');
    git('add', '.gitignore', 'source.txt');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    const output = path.join(root, 'tests/github-output.txt');
    const runMeasurement = async () => { await writeReport(); return { exitCode: 0 }; };
    expect(await runReleaseReview({ root, env: { GITHUB_OUTPUT: output }, runMeasurement })).toBe(0);
    expect(await readFile(output, 'utf8')).toContain(`commit=${sha}\n`);
    expect(await readReview()).toMatchObject({ source: { commit: sha, dirty: false } });
    await rm(output);
    await writeFile(path.join(root, 'source.txt'), 'modified\n', 'utf8');
    expect(await runReleaseReview({ root, env: { GITHUB_OUTPUT: output }, runMeasurement })).toBe(0);
    expect(await readFile(output, 'utf8')).not.toContain('commit=');
    expect(await readReview()).toMatchObject({ source: { dirty: true } });
    await rm(output);
    await writeFile(path.join(root, 'source.txt'), 'original\n', 'utf8');
    expect(await runReleaseReview({ root, env: { GITHUB_OUTPUT: output }, runMeasurement: async () => {
      await writeReport(); return { exitCode: 1 };
    } })).toBe(1);
    expect(await readFile(output, 'utf8')).not.toContain('commit=');
    expect(await readReview()).toMatchObject({ status: 'measurement-error', source: { dirty: false } });
  });
});
import { execFileSync } from 'node:child_process';
