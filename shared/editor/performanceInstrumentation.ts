export type EditorPerformanceProbeName =
  | 'structure-index-classifier'
  | 'structure-index-map'
  | 'structure-index-build'
  | 'section-fold-map'
  | 'section-fold-decoration-map'
  | 'section-fold-rebuild'
  | 'semantic-numbering-decoration-map'
  | 'semantic-numbering-rebuild'
  | 'lowlight-decoration-map'
  | 'lowlight-rebuild'
  | 'block-identity-id-scan'
  | 'persistent-id-scan'
  | 'node-view-update-props';

export interface EditorPerformanceProbeSample {
  readonly name: EditorPerformanceProbeName;
  readonly durationMs: number;
  readonly operationCount: number;
}

type EditorPerformanceProbeListener = (sample: EditorPerformanceProbeSample) => void;

let testOnlyProbeListener: EditorPerformanceProbeListener | undefined;

const monotonicNow = (): number => globalThis.performance?.now() ?? Date.now();

/** Installs the typed browser-harness probe. Production has no listener and takes the direct path. */
export function installTestOnlyEditorPerformanceProbe(
  listener: EditorPerformanceProbeListener,
): () => void {
  if (testOnlyProbeListener) throw new Error('editor performance probe is already installed');
  testOnlyProbeListener = listener;
  return () => {
    if (testOnlyProbeListener === listener) testOnlyProbeListener = undefined;
  };
}

export function measureEditorPerformanceProbe<T>(
  name: EditorPerformanceProbeName,
  operationCount: number | (() => number),
  operation: () => T,
): T {
  const listener = testOnlyProbeListener;
  if (!listener) return operation();
  const resolvedOperationCount = typeof operationCount === 'function'
    ? operationCount()
    : operationCount;
  const startedAt = monotonicNow();
  const result = operation();
  listener({ name, durationMs: monotonicNow() - startedAt, operationCount: resolvedOperationCount });
  return result;
}

export function recordEditorPerformanceProbe(
  name: EditorPerformanceProbeName,
  operationCount: number,
  durationMs = 0,
): void {
  testOnlyProbeListener?.({ name, durationMs, operationCount });
}
