import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runReleaseReview } from './performance/releaseReview';
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
});
