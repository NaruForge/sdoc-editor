import { performance } from 'node:perf_hooks';
import type {
  MonotonicNow,
  PerformanceMeasurement,
  PerformanceReport,
  PerformanceReportContext,
} from '../../shared/performance/instrumentation';

export type ExtensionHostPerformanceSpan = Readonly<{
  name: string;
  operationCount: number;
  startedAt: number;
}>;

/**
 * Opt-in monotonic timings for the real Extension Host test seam.
 *
 * Reports intentionally contain phase names, durations, and numeric operation
 * counts only. Document text, URIs, user paths, and wall-clock timestamps never
 * enter this probe.
 */
export class ExtensionHostPerformanceProbe {
  private readonly measurements: PerformanceMeasurement[] = [];
  private readonly saveSpans = new Map<number, ExtensionHostPerformanceSpan>();

  public constructor(
    private readonly enabled: boolean,
    private readonly now: MonotonicNow = () => performance.now(),
  ) {}

  public start(name: string, operationCount = 1): ExtensionHostPerformanceSpan | undefined {
    if (!this.enabled) return undefined;
    return { name, operationCount, startedAt: this.now() };
  }

  public finish(span: ExtensionHostPerformanceSpan | undefined, outcome: 'ok' | 'error' = 'ok'): void {
    if (!span) return;
    this.measurements.push({
      name: span.name,
      durationMs: this.now() - span.startedAt,
      operationCount: span.operationCount,
      outcome,
    });
  }

  public record(name: string, durationMs: number, operationCount = 1): void {
    if (!this.enabled) return;
    if (!name.trim() || !Number.isFinite(durationMs) || durationMs < 0
      || !Number.isSafeInteger(operationCount) || operationCount < 0) {
      throw new Error('invalid external performance measurement');
    }
    this.measurements.push({ name, durationMs, operationCount, outcome: 'ok' });
  }

  public measure<T>(name: string, operation: () => T, operationCount = 1): T {
    const span = this.start(name, operationCount);
    try {
      const result = operation();
      this.finish(span);
      return result;
    } catch (error) {
      this.finish(span, 'error');
      throw error;
    }
  }

  public async measureAsync<T>(
    name: string,
    operation: () => Promise<T>,
    operationCount = 1,
  ): Promise<T> {
    const span = this.start(name, operationCount);
    try {
      const result = await operation();
      this.finish(span);
      return result;
    } catch (error) {
      this.finish(span, 'error');
      throw error;
    }
  }

  public beginSave(saveGeneration: number): void {
    const span = this.start('save-lifecycle-to-did-save');
    if (span) this.saveSpans.set(saveGeneration, span);
  }

  public finishSave(saveGeneration: number, outcome: 'ok' | 'error' = 'ok'): void {
    const span = this.saveSpans.get(saveGeneration);
    if (!span) return;
    this.saveSpans.delete(saveGeneration);
    this.finish(span, outcome);
  }

  public reset(): void {
    this.measurements.length = 0;
    this.saveSpans.clear();
  }

  public report(context: PerformanceReportContext = {}): PerformanceReport {
    return {
      schemaVersion: 1,
      clock: 'monotonic',
      unit: 'milliseconds',
      context: { surface: 'vscode-extension-host', ...context },
      measurements: this.measurements.map((measurement) => ({ ...measurement })),
    };
  }
}
