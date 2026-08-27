export type PerformanceMeasurementOutcome = 'ok' | 'error';

export interface PerformanceMeasurement {
  name: string;
  durationMs: number;
  operationCount: number;
  outcome: PerformanceMeasurementOutcome;
}

export interface PerformanceReportContext {
  corpus?: string;
  documentBytes?: number;
  documentNodes?: number;
  [key: string]: string | number | boolean | undefined;
}

/** Stable, host-neutral format for editor, webview, CLI, and benchmark timings. */
export interface PerformanceReport {
  schemaVersion: 1;
  clock: 'monotonic';
  unit: 'milliseconds';
  context: PerformanceReportContext;
  measurements: readonly PerformanceMeasurement[];
}

export type MonotonicNow = () => number;

export interface PerformanceRecorder {
  measure<T>(name: string, operation: () => T, operationCount?: number): T;
  measureAsync<T>(name: string, operation: () => Promise<T>, operationCount?: number): Promise<T>;
  report(): PerformanceReport;
}

const assertMeasurementInput = (name: string, operationCount: number): void => {
  if (!name.trim()) throw new Error('performance measurement name must not be empty');
  if (!Number.isSafeInteger(operationCount) || operationCount < 0) {
    throw new Error('performance operation count must be a non-negative safe integer');
  }
};

const elapsedMilliseconds = (startedAt: number, finishedAt: number): number => {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    throw new Error('performance clock must return finite monotonic timestamps');
  }
  return finishedAt - startedAt;
};

/**
 * Creates an in-memory recorder around an injected monotonic clock.
 *
 * The caller owns clock selection: browser and Node hosts can pass
 * `performance.now`, while tests can inject a deterministic clock. No wall-clock
 * timestamps or host APIs enter the portable report.
 */
export function createPerformanceRecorder(
  now: MonotonicNow,
  context: PerformanceReportContext = {},
): PerformanceRecorder {
  const measurements: PerformanceMeasurement[] = [];

  const run = <T>(
    name: string,
    operationCount: number,
    operation: () => T,
  ): T => {
    assertMeasurementInput(name, operationCount);
    const startedAt = now();
    try {
      const result = operation();
      measurements.push({
        name,
        durationMs: elapsedMilliseconds(startedAt, now()),
        operationCount,
        outcome: 'ok',
      });
      return result;
    } catch (error) {
      const finishedAt = now();
      measurements.push({
        name,
        durationMs: elapsedMilliseconds(startedAt, finishedAt),
        operationCount,
        outcome: 'error',
      });
      throw error;
    }
  };

  return {
    measure<T>(name: string, operation: () => T, operationCount = 1): T {
      return run(name, operationCount, operation);
    },
    async measureAsync<T>(
      name: string,
      operation: () => Promise<T>,
      operationCount = 1,
    ): Promise<T> {
      assertMeasurementInput(name, operationCount);
      const startedAt = now();
      try {
        const result = await operation();
        measurements.push({
          name,
          durationMs: elapsedMilliseconds(startedAt, now()),
          operationCount,
          outcome: 'ok',
        });
        return result;
      } catch (error) {
        const finishedAt = now();
        measurements.push({
          name,
          durationMs: elapsedMilliseconds(startedAt, finishedAt),
          operationCount,
          outcome: 'error',
        });
        throw error;
      }
    },
    report(): PerformanceReport {
      return {
        schemaVersion: 1,
        clock: 'monotonic',
        unit: 'milliseconds',
        context: { ...context },
        measurements: measurements.map((measurement) => ({ ...measurement })),
      };
    },
  };
}
