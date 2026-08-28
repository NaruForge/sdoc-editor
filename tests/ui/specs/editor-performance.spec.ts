import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { PerformanceReport } from '../../../shared/performance/instrumentation';

interface BrowserPerformanceWindow {
  armKeyToNextPaint(): void;
  readKeyToNextPaint(): Promise<void>;
  readDebouncedUpdate(): Promise<void>;
  focusInputTarget(target?: 'top' | 'middle' | 'bottom'): string;
  resetCodeBlockLanguageOperations(): void;
  measureSyncCheckpoint(): void;
  measureScroll(edge: 'start' | 'end'): Promise<void>;
  measureNavigation(edge: 'start' | 'end'): Promise<void>;
  documentTextLength(): number;
  selectionParentType(): string;
  setEditable(editable: boolean): void;
  undo(): boolean;
  redo(): boolean;
  deleteCodeBlock(index: number): boolean;
  replaceCodeBlockText(index: number): boolean;
  transactionCount(): number;
  report(jsHeapUsedBytes?: number): PerformanceReport;
}

declare global {
  interface Window {
    __sdocBrowserPerformance?: BrowserPerformanceWindow;
  }
}

const corpus = process.env.SDOC_BROWSER_PERF_CORPUS ?? 'text-5k';
const richReleaseCorpus = corpus === 'rich-mixed-5k' || corpus === 'rich-balanced-5k';
const requestedRunCount = Number.parseInt(process.env.SDOC_BROWSER_PERF_RUNS ?? '', 10);
const runCount = richReleaseCorpus && requestedRunCount >= 1 && requestedRunCount <= 3
  ? requestedRunCount
  : richReleaseCorpus ? 3 : 1;
const operationSamplesPerRun = richReleaseCorpus ? 5 : 1;
const inputSamplesPerRun = richReleaseCorpus ? 30 / runCount : 1;
const navigationSamplesPerRun = richReleaseCorpus ? 5 : 1;

const percentile95 = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const durations = (report: PerformanceReport, name: string): number[] =>
  report.measurements
    .filter((measurement) => measurement.name === name)
    .map((measurement) => measurement.durationMs);

const maximumContextValue = (
  reports: readonly PerformanceReport[],
  key: string,
): number => Math.max(...reports.map((report) => {
  const value = report.context[key];
  return typeof value === 'number' ? value : 0;
}));

test('measures the real Chromium editor path and enforces the accepted rich-document budgets', async ({ page }) => {
  // Three rich 5k mounts plus behavior probes exceed the default test timeout on
  // development Chromium; latency assertions below remain the release gate.
  test.setTimeout(richReleaseCorpus ? 180_000 : 30_000);
  const reports: PerformanceReport[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  for (let run = 0; run < runCount; run += 1) {
    await page.goto(`/performance.html?corpus=${encodeURIComponent(corpus)}&run=${run}`);
    await page.waitForFunction(() => document.documentElement.dataset.performanceReady === 'true');

    const editor = page.locator('.ProseMirror');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    const initialTextLength = await page.evaluate(
      () => window.__sdocBrowserPerformance?.documentTextLength() ?? 0,
    );

    if (richReleaseCorpus) {
      const languageTrigger = editor.locator('.code-block-language-trigger').first();
      await expect(languageTrigger).toHaveAttribute('aria-label', /.+/);
      await expect(languageTrigger).toHaveAttribute('aria-haspopup', 'listbox');
      await expect(languageTrigger).toHaveAttribute('aria-expanded', 'false');
      await expect(languageTrigger).toHaveAttribute('aria-controls', /.+/);
      await expect(page.locator('.code-block-language-popup:visible')).toHaveCount(0);

      const deferredMath = editor.locator('.math-block-render-placeholder').first();
      if (await deferredMath.count()) {
        expect(await deferredMath.evaluate((element) => {
          (element.parentElement as HTMLElement | null)?.focus();
          return !element.classList.contains('math-block-render-placeholder');
        })).toBe(true);
      }

      const image = editor.locator('.image-node-wrapper img').first();
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({
        complete: element.complete,
        width: element.naturalWidth,
        height: element.naturalHeight,
      }))).toEqual({ complete: true, width: 64, height: 48 });
    }

    for (let sample = 0; sample < navigationSamplesPerRun; sample += 1) {
      const edge = sample % 2 === 0 ? 'end' : 'start';
      await page.evaluate(
        (target) => window.__sdocBrowserPerformance?.measureScroll(target),
        edge,
      );
    }
    const inputTargets = ['top', 'middle', 'bottom'] as const;
    await page.evaluate(() => window.__sdocBrowserPerformance?.resetCodeBlockLanguageOperations());
    for (let sample = 0; sample < inputSamplesPerRun; sample += 1) {
      const target = inputTargets[(run * inputSamplesPerRun + sample) % inputTargets.length];
      expect(await page.evaluate(
        (position) => window.__sdocBrowserPerformance?.focusInputTarget(position),
        target,
      )).toBe('paragraph');
      await page.evaluate(() => window.__sdocBrowserPerformance?.armKeyToNextPaint());
      await page.keyboard.type('x');
      await page.evaluate(() => window.__sdocBrowserPerformance?.readKeyToNextPaint());
      await page.evaluate(() => window.__sdocBrowserPerformance?.readDebouncedUpdate());
    }
    await page.evaluate(() => window.__sdocBrowserPerformance?.measureSyncCheckpoint());
    for (let sample = 0; sample < navigationSamplesPerRun; sample += 1) {
      const edge = sample % 2 === 0 ? 'start' : 'end';
      await page.evaluate(
        (target) => window.__sdocBrowserPerformance?.measureNavigation(target),
        edge,
      );
    }

    const finalTextLength = await page.evaluate(
      () => window.__sdocBrowserPerformance?.documentTextLength() ?? 0,
    );
    expect(finalTextLength).toBe(initialTextLength + inputSamplesPerRun);

    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const report = await page.evaluate(
      (usedSize) => window.__sdocBrowserPerformance?.report(usedSize),
      heap.usedSize,
    );
    expect(report).toBeDefined();
    if (!report) throw new Error('browser performance report was not published');
    reports.push(report);

  }

  if (richReleaseCorpus && process.env.SDOC_BROWSER_PERF_INTEGRATED_BEHAVIOR === 'true') {
    const editor = page.locator('.ProseMirror');
    const firstBlock = editor.locator('.code-block').nth(0);
    const firstTrigger = firstBlock.locator('.code-block-language-trigger');
    const popup = page.locator('.code-block-language-popup');
    const languageSelect = popup.locator('select');
    await expect(firstBlock).toHaveAttribute('data-language', 'null');
    await expect(firstTrigger).toHaveText('null');
    await firstTrigger.focus();
    await expect(popup).toBeHidden();
    await firstTrigger.click();
    await expect(popup).toBeVisible();
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(languageSelect).toBeFocused();
    await expect(languageSelect).toHaveAttribute('aria-label', /.+/);
    await expect(popup.getByRole('listbox')).toHaveCount(1);
    await expect(page.locator('.code-block-language-popup')).toHaveCount(1);
    await expect(languageSelect.locator('option')).toHaveCount(194);
    const openTransactionCount = await page.evaluate(
      () => window.__sdocBrowserPerformance?.transactionCount() ?? -1,
    );
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(popup).toBeHidden();
    await expect(firstTrigger).toBeFocused();
    await expect(firstBlock).toHaveAttribute('data-language', '');
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.transactionCount()))
      .toBe(openTransactionCount + 1);
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);
    await expect(firstBlock).toHaveAttribute('data-language', 'null');
    await expect(firstTrigger).toHaveText('null');
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.redo())).toBe(true);
    await expect(firstBlock).toHaveAttribute('data-language', '');
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);

    const customBlock = editor.locator('.code-block').nth(1);
    const customTrigger = customBlock.locator('.code-block-language-trigger');
    await expect(customBlock).toHaveAttribute('data-language', 'custom:언어');
    await customTrigger.focus();
    await page.keyboard.press('Space');
    await expect(popup).toBeVisible();
    await expect(languageSelect.locator('option:checked')).toHaveText('custom:언어');
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(customTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('type');
    await languageSelect.dispatchEvent('compositionstart', { data: 't' });
    await page.keyboard.press('Enter');
    await expect(popup).toBeVisible();
    await languageSelect.dispatchEvent('compositionend', { data: 't' });
    await page.keyboard.press('Enter');
    await expect(customBlock).toHaveAttribute('data-language', 'typescript');
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);
    await expect(customBlock).toHaveAttribute('data-language', 'custom:언어');

    const emptyBlock = editor.locator('.code-block').nth(2);
    const emptyTrigger = emptyBlock.locator('.code-block-language-trigger');
    await expect(emptyBlock).toHaveAttribute('data-language', '');
    await emptyTrigger.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(popup).toBeVisible();
    await expect(languageSelect.locator('option:checked')).toHaveAttribute('data-language-empty', 'true');
    await page.keyboard.press('Tab');
    await expect(popup).toBeHidden();
    await expect(emptyTrigger).not.toBeFocused();

    const code = editor.locator('.code-block code').first();
    const initialCode = await code.textContent() ?? '';
    await firstTrigger.click();
    await expect(popup).toBeVisible();
    await code.click();
    await expect(popup).toBeHidden();
    await expect(editor).toBeFocused();
    await page.keyboard.press('End');
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.selectionParentType()))
      .toBe('codeBlock');
    await page.keyboard.type('Z');
    await expect(code).toHaveText(`${initialCode}Z`);
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);
    await expect(code).toHaveText(initialCode);
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.redo())).toBe(true);
    await expect(code).toHaveText(`${initialCode}Z`);
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);

    await code.click();
    await page.keyboard.press('End');
    await code.dispatchEvent('compositionstart', { data: '한' });
    await page.keyboard.insertText('한');
    await code.dispatchEvent('compositionend', { data: '한' });
    await expect(code).toHaveText(`${initialCode}한`);
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);
    await expect(code).toHaveText(initialCode);

    await customTrigger.click();
    await expect(popup).toBeVisible();
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.deleteCodeBlock(1)))
      .toBe(true);
    await expect(popup).toBeHidden();
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);

    await page.evaluate(() => window.__sdocBrowserPerformance?.setEditable(false));
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await expect(firstTrigger).toHaveAttribute('aria-disabled', 'true');
    await firstTrigger.focus();
    await expect(firstTrigger).toBeFocused();
    const readOnlyTransactionCount = await page.evaluate(
      () => window.__sdocBrowserPerformance?.transactionCount() ?? -1,
    );
    await page.keyboard.press('Enter');
    await expect(popup).toBeHidden();
    expect(await page.evaluate(() => window.__sdocBrowserPerformance?.transactionCount()))
      .toBe(readOnlyTransactionCount);
    const readOnlyCode = await code.textContent();
    await code.click();
    await page.keyboard.type('blocked');
    await expect(code).toHaveText(readOnlyCode ?? '');
    await page.evaluate(() => window.__sdocBrowserPerformance?.setEditable(true));
    await expect(editor).toHaveAttribute('contenteditable', 'true');
  }

  const latest = reports.at(-1)!;
  const pooledMeasurements = reports.flatMap((sample) => sample.measurements);
  const pooledInput = pooledMeasurements
    .filter(({ name }) => name === 'key-to-next-paint')
    .map(({ durationMs }) => durationMs);
  const inputStatistics = Object.fromEntries(['top', 'middle', 'bottom'].flatMap((position) => {
    const values = pooledMeasurements
      .filter(({ name }) => name === `key-to-next-paint-${position}`)
      .map(({ durationMs }) => durationMs);
    return [
      [`input${position}MedianMs`, median(values)],
      [`input${position}P95Ms`, percentile95(values)],
      [`input${position}MaxMs`, Math.max(...values)],
    ];
  }));
  const report: PerformanceReport = {
    ...latest,
    context: {
      ...latest.context,
      runCount,
      operationSamplesPerRun,
      inputSamplesPerRun,
      navigationSamplesPerRun,
      domNodeCount: maximumContextValue(reports, 'domNodeCount'),
      retainedJsHeapBytes: maximumContextValue(reports, 'jsHeapUsedBytes'),
      jsHeapUsedBytes: maximumContextValue(reports, 'jsHeapUsedBytes'),
      longTaskCount: reports.reduce(
        (total, sample) => total + Number(sample.context.longTaskCount ?? 0),
        0,
      ),
      inputRawSampleCount: pooledInput.length,
      inputPooledP95Ms: percentile95(pooledInput),
      inputPooledMaxMs: Math.max(...pooledInput),
      ...inputStatistics,
    },
    measurements: pooledMeasurements,
  };

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
      runCount,
      operationSamplesPerRun,
      inputSamplesPerRun,
      navigationSamplesPerRun,
    },
  });
  if (richReleaseCorpus) {
    expect(report.context.domLoadedImageCount).toBeGreaterThan(0);
    expect(report.context.firstLoadedImageNaturalWidth).toBe(64);
    expect(report.context.firstLoadedImageNaturalHeight).toBe(48);
    expect(report.context.codeBlockReactRootsCurrent).toBe(0);
    expect(report.context.codeBlockLanguageControllersCurrent).toBe(1);
    expect(report.context.codeBlockLanguageControllersMaximum).toBeLessThanOrEqual(1);
    expect(report.context.codeBlockLanguagePopupsCurrent).toBe(1);
    expect(report.context.codeBlockLanguagePopupsMaximum).toBeLessThanOrEqual(1);
    expect(report.context.codeBlockLanguageTriggersCurrent).toBe(250);
    expect(report.context.codeBlockLanguageResolverOperations).toBe(0);
    expect(report.context.codeBlockLanguageOptionMaterializationOperations).toBe(0);
    expect(report.context.codeBlockLanguageGeometryOperations).toBe(0);
    expect(report.context.codeBlockLanguageOwnerScanOperations).toBe(0);
  }
  expect(report.context.domNodeCount).toBeGreaterThan(report.context.topLevelBlocks as number);
  expect(report.context.jsHeapUsedBytes).toBeGreaterThan(0);
  expect(durations(report, 'open-to-editable-next-paint')).toHaveLength(runCount);
  expect(durations(report, 'key-to-next-paint'))
    .toHaveLength(runCount * inputSamplesPerRun);
  expect(durations(report, 'editor-dispatch-cpu'))
    .toHaveLength(runCount * inputSamplesPerRun);
  expect(durations(report, 'editor-state-apply-plugins-cpu'))
    .toHaveLength(runCount * inputSamplesPerRun);
  expect(durations(report, 'editor-view-update-state-cpu'))
    .toHaveLength(runCount * inputSamplesPerRun);
  expect(durations(report, 'editor-post-update-cpu'))
    .toHaveLength(runCount * inputSamplesPerRun);
  expect(durations(report, 'scroll-next-paint'))
    .toHaveLength(runCount * navigationSamplesPerRun);
  expect(durations(report, 'navigate-next-paint'))
    .toHaveLength(runCount * navigationSamplesPerRun);
  expect(report.measurements.filter(({ name }) => name === 'sync-checkpoint-cpu'))
    .toHaveLength(runCount);
  for (const phase of ['open', 'input', 'scroll', 'navigation']) {
    expect(report.measurements.some(({ name }) => name === `${phase}-long-task-total`)).toBe(true);
  }
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
  await writeFile(
    path.join(artifactDirectory, `browser-${corpus}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  const openDurations = durations(report, 'open-to-editable-next-paint');
  const inputDurations = durations(report, 'key-to-next-paint');
  if (corpus === 'rich-mixed-5k') {
    for (const position of ['top', 'middle', 'bottom']) {
      const positioned = durations(report, `key-to-next-paint-${position}`);
      expect(positioned).toHaveLength(10);
    }
  }
  const scrollDurations = durations(report, 'scroll-next-paint');
  const navigationDurations = durations(report, 'navigate-next-paint');
  const domNodeCount = Number(report.context.domNodeCount);
  const retainedJsHeapBytes = Number(report.context.retainedJsHeapBytes);
  if (corpus === 'rich-mixed-5k') {
    expect(percentile95(openDurations), 'mixed editable p95').toBeLessThanOrEqual(2_000);
    expect(percentile95(inputDurations), 'mixed input p95').toBeLessThanOrEqual(50);
    expect(Math.max(...inputDurations), 'mixed input max').toBeLessThan(100);
    expect(percentile95(scrollDurations), 'mixed scroll p95').toBeLessThanOrEqual(50);
    expect(percentile95(navigationDurations), 'mixed navigation p95').toBeLessThanOrEqual(100);
    expect(domNodeCount, 'mixed DOM nodes').toBeLessThanOrEqual(50_000);
    expect(retainedJsHeapBytes, 'mixed retained heap').toBeLessThanOrEqual(128 * 1024 * 1024);
  } else if (corpus === 'rich-balanced-5k') {
    expect(percentile95(openDurations), 'balanced editable p95').toBeLessThanOrEqual(5_000);
    expect(domNodeCount, 'balanced DOM nodes').toBeLessThanOrEqual(75_000);
    expect(retainedJsHeapBytes, 'balanced retained heap').toBeLessThanOrEqual(192 * 1024 * 1024);
  }
});
