export interface BrowserBudgetMetric {
  readonly name: string;
  readonly actual: number;
  readonly limit: number;
  readonly comparison: '<=' | '<';
  readonly unit: 'ms' | 'nodes' | 'bytes';
  readonly passed: boolean;
}

export interface RichBrowserAssessment {
  readonly status: 'within-budget' | 'below-budget';
  readonly metrics: readonly BrowserBudgetMetric[];
}

export interface PerformanceRiskAcceptance {
  readonly reviewer: string;
  readonly reason: string;
}

export interface RichBrowserReview {
  readonly status: 'within-budget' | 'below-budget' | 'risk-accepted' | 'measurement-error';
  readonly assessment?: RichBrowserAssessment;
  readonly acceptance?: PerformanceRiskAcceptance;
  readonly error?: string;
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Missing or invalid ${label}`);
  }
  return value as Record<string, unknown>;
};

const finite = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid non-negative measurement: ${label}`);
  }
  return value;
};

const p95 = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

/** The existing development-harness budgets, shared by strict tests and release review. */
export function assessRichBrowserBudget(value: unknown): RichBrowserAssessment {
  const report = record(value, 'browser report');
  const context = record(report.context, 'browser context');
  if (report.schemaVersion !== 1 || report.clock !== 'monotonic' || report.unit !== 'milliseconds'
    || context.corpus !== 'rich-mixed-5k' || context.surface !== 'chromium-editor'
    || context.browserEngine !== 'chromium' || context.topLevelBlocks !== 5_000
    || context.keyProbeCapturedBeforeBubble !== true
    || typeof context.browserVersion !== 'string' || !context.browserVersion.trim()) {
    throw new Error('Report does not describe the fixed rich Chromium capture contract');
  }
  const runCount = finite(context.runCount, 'runCount');
  if (![1, 2, 3].includes(runCount) || context.inputSamplesPerRun !== 30 / runCount
    || context.navigationSamplesPerRun !== 5) throw new Error('Invalid browser sample configuration');
  if (!Array.isArray(report.measurements)) throw new Error('Missing browser measurements');
  const samples = report.measurements.map((value: unknown) => {
    const sample = record(value, 'measurement');
    if (typeof sample.name !== 'string' || sample.outcome !== 'ok') throw new Error('Invalid or failed measurement');
    finite(sample.operationCount, 'operationCount');
    return { name: sample.name, durationMs: finite(sample.durationMs, sample.name) };
  });
  const durations = (name: string, count: number): number[] => {
    const values = samples.filter((sample) => sample.name === name).map((sample) => sample.durationMs);
    if (values.length !== count) throw new Error(`Incomplete ${name}: expected ${count}, found ${values.length}`);
    return values;
  };
  for (const position of ['top', 'middle', 'bottom']) durations(`key-to-next-paint-${position}`, 10);
  const inputs = durations('key-to-next-paint', 30);
  const metric = (name: string, actual: number, limit: number,
    unit: BrowserBudgetMetric['unit'] = 'ms', comparison: BrowserBudgetMetric['comparison'] = '<='): BrowserBudgetMetric => ({
    name, actual, limit, comparison, unit, passed: comparison === '<' ? actual < limit : actual <= limit,
  });
  const domNodeCount = finite(context.domNodeCount, 'domNodeCount');
  const retainedHeap = finite(context.retainedJsHeapBytes, 'retainedJsHeapBytes');
  if (domNodeCount <= 5_000 || retainedHeap <= 0) throw new Error('Missing DOM or retained-heap evidence');
  const metrics = [
    metric('editable p95', p95(durations('open-to-editable-next-paint', runCount)), 2_000),
    metric('input p95', p95(inputs), 50),
    metric('input max', Math.max(...inputs), 100, 'ms', '<'),
    metric('scroll p95', p95(durations('scroll-next-paint', runCount * 5)), 50),
    metric('navigation p95', p95(durations('navigate-next-paint', runCount * 5)), 100),
    metric('DOM', domNodeCount, 50_000, 'nodes'),
    metric('retained heap', retainedHeap, 128 * 1024 * 1024, 'bytes'),
  ];
  return { status: metrics.every((item) => item.passed) ? 'within-budget' : 'below-budget', metrics };
}

export function reviewRichBrowserRun(
  value: unknown,
  measurementExitCode: number,
  acceptance?: PerformanceRiskAcceptance,
): RichBrowserReview {
  try {
    if (measurementExitCode !== 0) throw new Error(`Browser measurement command failed (${measurementExitCode})`);
    const context = record(record(value, 'browser report').context, 'browser context');
    if (context.runCount !== 3) throw new Error('Release review requires all three browser runs');
    const assessment = assessRichBrowserBudget(value);
    if (acceptance && (!acceptance.reviewer.trim() || !acceptance.reason.trim())) {
      throw new Error('Risk acceptance requires both reviewer and reason');
    }
    return {
      status: assessment.status === 'below-budget' && acceptance ? 'risk-accepted' : assessment.status,
      assessment,
      ...(acceptance ? { acceptance } : {}),
    };
  } catch (error) {
    return { status: 'measurement-error', error: error instanceof Error ? error.message : 'Invalid browser evidence' };
  }
}
