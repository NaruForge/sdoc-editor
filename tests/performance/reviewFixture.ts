import type { PerformanceReport } from '../../shared/performance/instrumentation';

export const richReport = (): PerformanceReport => ({
  schemaVersion: 1, clock: 'monotonic', unit: 'milliseconds',
  context: {
    corpus: 'rich-mixed-5k', surface: 'chromium-editor', browserEngine: 'chromium',
    browserVersion: 'test-chromium', fixtureSeed: 1, topLevelBlocks: 5_000,
    runCount: 3, inputSamplesPerRun: 10, navigationSamplesPerRun: 5,
    keyProbeCapturedBeforeBubble: true, domNodeCount: 40_000, retainedJsHeapBytes: 60 * 1024 * 1024,
  },
  measurements: Object.entries({
    'open-to-editable-next-paint': [3, 1_000], 'key-to-next-paint': [30, 40],
    'key-to-next-paint-top': [10, 40], 'key-to-next-paint-middle': [10, 40],
    'key-to-next-paint-bottom': [10, 40], 'scroll-next-paint': [15, 40],
    'navigate-next-paint': [15, 40],
  }).flatMap(([name, [count, durationMs]]) => Array.from({ length: count }, () => ({
    name, durationMs, operationCount: 1, outcome: 'ok' as const,
  }))),
});
