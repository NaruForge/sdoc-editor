import { describe, expect, it } from 'vitest';
import { ExtensionHostPerformanceProbe } from '../src/performance/ExtensionHostPerformanceProbe';

describe('ExtensionHostPerformanceProbe', () => {
  it('uses an injected monotonic clock and the portable report schema', async () => {
    const ticks = [1, 4, 10, 15, 20, 28, 30, 39];
    const probe = new ExtensionHostPerformanceProbe(true, () => ticks.shift()!);

    expect(probe.measure('sync-phase', () => 'ok', 2)).toBe('ok');
    await expect(probe.measureAsync('async-phase', async () => 7, 3)).resolves.toBe(7);
    probe.beginSave(4);
    probe.finishSave(4);
    const manual = probe.start('manual-phase', 5);
    probe.finish(manual);
    probe.record('external-phase', 2.5, 6);

    expect(probe.report()).toEqual({
      schemaVersion: 1,
      clock: 'monotonic',
      unit: 'milliseconds',
      context: { surface: 'vscode-extension-host' },
      measurements: [
        { name: 'sync-phase', durationMs: 3, operationCount: 2, outcome: 'ok' },
        { name: 'async-phase', durationMs: 5, operationCount: 3, outcome: 'ok' },
        { name: 'save-lifecycle-to-did-save', durationMs: 8, operationCount: 1, outcome: 'ok' },
        { name: 'manual-phase', durationMs: 9, operationCount: 5, outcome: 'ok' },
        { name: 'external-phase', durationMs: 2.5, operationCount: 6, outcome: 'ok' },
      ],
    });
  });

  it('does not read the clock or retain measurements when disabled', () => {
    const probe = new ExtensionHostPerformanceProbe(false, () => {
      throw new Error('disabled probe must not read the clock');
    });

    expect(probe.measure('phase', () => 'result')).toBe('result');
    probe.beginSave(1);
    probe.finishSave(1);
    expect(probe.report().measurements).toEqual([]);
  });
});
