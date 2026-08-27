import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { PerformanceReport } from '../../../shared/performance/instrumentation';

interface BrowserPerformanceWindow {
  armKeyToNextPaint(): void;
  readKeyToNextPaint(): Promise<void>;
  readDebouncedUpdate(): Promise<void>;
  measureSyncCheckpoint(): void;
  measureScrollToBottom(): Promise<void>;
  measureNavigationToStart(): Promise<void>;
  report(jsHeapUsedBytes?: number): PerformanceReport;
}

declare global {
  interface Window {
    __sdocBrowserPerformance?: BrowserPerformanceWindow;
  }
}

const corpus = process.env.SDOC_BROWSER_PERF_CORPUS ?? 'text-5k';

test('measures the real Chromium editor path without an absolute-time gate', async ({ page }) => {
  await page.goto(`/performance.html?corpus=${encodeURIComponent(corpus)}`);
  await page.waitForFunction(() => document.documentElement.dataset.performanceReady === 'true');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  const initialTextLength = await editor.evaluate((element) => element.textContent?.length ?? 0);

  await page.evaluate(() => window.__sdocBrowserPerformance?.measureScrollToBottom());
  await editor.focus();
  await page.evaluate(() => window.__sdocBrowserPerformance?.armKeyToNextPaint());
  await page.keyboard.type('x');
  await page.evaluate(() => window.__sdocBrowserPerformance?.readKeyToNextPaint());
  await page.evaluate(() => window.__sdocBrowserPerformance?.readDebouncedUpdate());
  await page.evaluate(() => window.__sdocBrowserPerformance?.measureSyncCheckpoint());
  await page.evaluate(() => window.__sdocBrowserPerformance?.measureNavigationToStart());

  const finalTextLength = await editor.evaluate((element) => element.textContent?.length ?? 0);
  expect(finalTextLength).toBe(initialTextLength + 1);

  const cdp = await page.context().newCDPSession(page);
  const heap = await cdp.send('Runtime.getHeapUsage');
  const report = await page.evaluate(
    (usedSize) => window.__sdocBrowserPerformance?.report(usedSize),
    heap.usedSize,
  );
  expect(report).toBeDefined();
  if (!report) throw new Error('browser performance report was not published');

  expect(report).toMatchObject({
    schemaVersion: 1,
    clock: 'monotonic',
    unit: 'milliseconds',
    context: {
      surface: 'chromium-editor',
      browserEngine: 'chromium',
      corpus,
      keyProbeCapturedBeforeBubble: true,
      syncSubmitCallbacks: 1,
    },
  });
  expect(report.context.domNodeCount).toBeGreaterThan(report.context.topLevelBlocks as number);
  expect(report.context.jsHeapUsedBytes).toBeGreaterThan(0);
  expect(report.measurements.map(({ name }) => name)).toEqual([
    'open-to-editable-next-paint',
    'scroll-to-bottom-next-paint',
    'key-to-next-paint',
    'debounced-update-wait',
    'sync-checkpoint-cpu',
    'navigate-to-start-next-paint',
    'observed-long-task-total',
  ]);
  expect(report.measurements.find(({ name }) => name === 'sync-checkpoint-cpu'))
    .toMatchObject({ operationCount: 1, outcome: 'ok' });
  for (const measurement of report.measurements) {
    expect(Number.isFinite(measurement.durationMs)).toBe(true);
    expect(measurement.durationMs).toBeGreaterThanOrEqual(0);
    expect(measurement.operationCount).toBeGreaterThanOrEqual(0);
    expect(measurement.outcome).toBe('ok');
  }

  const artifactDirectory = path.resolve('tests/ui/artifacts/performance');
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    path.join(artifactDirectory, 'browser.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
});
