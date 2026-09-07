import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { PerformanceMeasurement } from '../../../shared/performance/instrumentation';

test('measures code input and paragraph marks in the real mixed editor', async ({ page }) => {
  test.setTimeout(120_000);
  const results: Array<{ scenario: string; sample: number; measurements: PerformanceMeasurement[] }> = [];
  for (const scenario of ['code', 'marked', 'bold'] as const) {
    await page.goto(`/performance.html?corpus=rich-mixed-5k&scenario=${scenario}`);
    await page.waitForFunction(() => document.documentElement.dataset.performanceReady === 'true');
    await expect(page.locator('.code-block')).toHaveCount(250);
    for (let sample = -2; sample < 7; sample += 1) {
      expect(await page.evaluate((target) => window.__sdocBrowserPerformance?.focusLowlightTarget(target), scenario))
        .toBe(scenario === 'code' ? 'codeBlock' : 'paragraph');
      const before = await page.evaluate(() => window.__sdocBrowserPerformance!.report().measurements.length);
      // Hold the modifier before arming so the key probe starts at B, not Control.
      if (scenario === 'bold') await page.keyboard.down('Control');
      await page.evaluate(() => window.__sdocBrowserPerformance!.armKeyToNextPaint());
      await page.keyboard.press(scenario === 'bold' ? 'b' : 'x');
      if (scenario === 'bold') await page.keyboard.up('Control');
      await page.evaluate(() => window.__sdocBrowserPerformance!.readKeyToNextPaint());
      await page.evaluate(() => window.__sdocBrowserPerformance!.readDebouncedUpdate());
      const measurements = await page.evaluate((offset) =>
        window.__sdocBrowserPerformance!.report().measurements.slice(offset), before);
      if (sample >= 0) results.push({ scenario, sample, measurements });
    }
  }
  const directory = path.resolve('tests/ui/artifacts/performance');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'lowlight.json'), `${JSON.stringify({
    corpus: 'rich-mixed-5k', codeBlocks: 250, warmupPerScenario: 2, results,
  }, null, 2)}\n`);
  for (const result of results) {
    expect(result.measurements.filter(({ name }) => name === 'plugin-lowlight-highlight'))
      .toHaveLength(result.scenario === 'code' ? 1 : 0);
    expect(result.measurements.filter(({ name }) => name === 'editor-dispatch-cpu')).toHaveLength(1);
    expect(result.measurements.filter(({ name }) => name === 'key-to-next-paint')).toHaveLength(1);
  }
});
