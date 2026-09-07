import { describe, expect, it } from 'vitest';
import { richReport } from './performance/reviewFixture';
import { assessRichBrowserBudget, reviewRichBrowserRun } from '../shared/performance/browserReleaseReview';

describe('rich browser release assessment', () => {
  it('uses the existing budgets, including the strict input maximum', () => {
    expect(assessRichBrowserBudget(richReport()).status).toBe('within-budget');
    const report = richReport();
    const inputs = report.measurements.filter((sample) => sample.name === 'key-to-next-paint');
    inputs.forEach((sample) => { sample.durationMs = 50; });
    expect(assessRichBrowserBudget(report).status).toBe('within-budget');
    inputs[0].durationMs = 100;
    const assessment = assessRichBrowserBudget(report);
    expect(assessment.metrics.filter((metric) => !metric.passed).map((metric) => metric.name))
      .toEqual(['input max']);
  });

  it('reports every miss and keeps acceptance separate from compliance', () => {
    const report = richReport();
    report.measurements.forEach((sample) => { sample.durationMs = 3_000; });
    report.context.domNodeCount = 60_000;
    report.context.retainedJsHeapBytes = 200 * 1024 * 1024;
    const missed = reviewRichBrowserRun(report, 0);
    expect(missed.status).toBe('below-budget');
    expect(missed.assessment?.metrics.filter((metric) => !metric.passed)).toHaveLength(7);
    const accepted = reviewRichBrowserRun(report, 0, { reviewer: 'maintainer', reason: 'Measured variance reviewed.' });
    expect(accepted.status).toBe('risk-accepted');
    expect(accepted.assessment?.status).toBe('below-budget');
    expect(accepted.acceptance).toEqual({ reviewer: 'maintainer', reason: 'Measured variance reviewed.' });
    expect(reviewRichBrowserRun(report, 0, { reviewer: '', reason: 'reason' }).status).toBe('measurement-error');
  });

  it('does not turn functional failure, missing or malformed evidence into acceptance', () => {
    const acceptance = { reviewer: 'maintainer', reason: 'not a functional waiver' };
    expect(reviewRichBrowserRun(richReport(), 1, acceptance).status).toBe('measurement-error');
    for (const value of [undefined, {}, { ...richReport(), schemaVersion: 2 }]) {
      expect(reviewRichBrowserRun(value, 0, acceptance).status).toBe('measurement-error');
    }
    const incomplete = richReport();
    expect(reviewRichBrowserRun({ ...incomplete, measurements: incomplete.measurements.slice(1) }, 0).status)
      .toBe('measurement-error');
    const nonFinite = richReport();
    nonFinite.measurements[0].durationMs = Number.NaN;
    expect(reviewRichBrowserRun(nonFinite, 0).status).toBe('measurement-error');
    const failedSample = richReport();
    failedSample.measurements[0].outcome = 'error';
    expect(reviewRichBrowserRun(failedSample, 0).status).toBe('measurement-error');
  });

  it('rejects reduced release runs and a substituted corpus', () => {
    for (const context of [{ corpus: 'text-5k' }, { runCount: 1 }, { topLevelBlocks: 4999 },
      { keyProbeCapturedBeforeBubble: false }, { browserVersion: '' }]) {
      const report = richReport();
      expect(reviewRichBrowserRun({ ...report, context: { ...report.context, ...context } }, 0).status)
        .toBe('measurement-error');
    }
  });
});
