import { getKnownDiagramLanguage, resolveDiagramLanguage } from './languages';
import {
  DiagramRenderError,
  type DiagramRenderOutput,
  type DiagramRendererResolver,
  type DiagramRenderState,
} from './types';

export interface DiagramRenderCoordinatorOptions {
  resolveRenderer: DiagramRendererResolver;
  onStateChange: (state: DiagramRenderState) => void;
  debounceMs?: number;
  cacheSize?: number;
}

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_CACHE_SIZE = 32;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Diagram preview failed.';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DiagramRenderError) return error.retryable;
  if (typeof error !== 'object' || error === null) return true;
  const candidate = error as { retryable?: unknown };
  return typeof candidate.retryable === 'boolean' ? candidate.retryable : true;
}

/**
 * Owns every asynchronous preview concern. Consumers only submit the latest
 * language/source pair and render the emitted state.
 */
export class DiagramRenderCoordinator {
  private readonly resolveRenderer: DiagramRendererResolver;
  private readonly onStateChange: (state: DiagramRenderState) => void;
  private readonly debounceMs: number;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, DiagramRenderOutput>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private input = { language: resolveDiagramLanguage(undefined), code: '' };
  private state: DiagramRenderState = {
    ...this.input,
    status: 'source-only',
    reason: 'empty-source',
  };
  private disposed = false;

  constructor(options: DiagramRenderCoordinatorOptions) {
    this.resolveRenderer = options.resolveRenderer;
    this.onStateChange = options.onStateChange;
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.cacheSize = Math.max(1, options.cacheSize ?? DEFAULT_CACHE_SIZE);
  }

  get currentState(): DiagramRenderState {
    return this.state;
  }

  setInput(language: unknown, code: string): void {
    if (this.disposed) return;
    this.input = { language: resolveDiagramLanguage(language), code };
    this.cancelPending();
    const generation = ++this.generation;
    const knownLanguage = getKnownDiagramLanguage(this.input.language);

    if (!code.trim()) {
      this.emit({ ...this.input, status: 'source-only', reason: 'empty-source' });
      return;
    }
    if (!knownLanguage) {
      this.emit({
        ...this.input,
        status: 'source-only',
        reason: 'unsupported-language',
      });
      return;
    }

    const renderer = this.resolveRenderer(knownLanguage);
    if (!renderer) {
      this.emit({
        ...this.input,
        status: 'source-only',
        reason: 'renderer-unavailable',
      });
      return;
    }

    const cacheKey = this.cacheKey(knownLanguage, code);
    const cached = this.readCache(cacheKey);
    if (cached) {
      this.emit({ ...this.input, status: 'ready', output: cached, cached: true });
      return;
    }

    this.emit({ ...this.input, status: 'loading' });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.generate(generation, knownLanguage, code, renderer, cacheKey);
    }, this.debounceMs);
  }

  retry(): void {
    if (this.disposed || this.state.status !== 'error' || !this.state.retryable) {
      return;
    }
    const knownLanguage = getKnownDiagramLanguage(this.input.language);
    if (!knownLanguage) return;
    const renderer = this.resolveRenderer(knownLanguage);
    if (!renderer) {
      this.emit({
        ...this.input,
        status: 'source-only',
        reason: 'renderer-unavailable',
      });
      return;
    }

    this.cancelPending();
    const generation = ++this.generation;
    this.emit({ ...this.input, status: 'loading' });
    void this.generate(
      generation,
      knownLanguage,
      this.input.code,
      renderer,
      this.cacheKey(knownLanguage, this.input.code),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.cancelPending();
    this.cache.clear();
  }

  private async generate(
    generation: number,
    language: NonNullable<ReturnType<typeof getKnownDiagramLanguage>>,
    code: string,
    renderer: NonNullable<ReturnType<DiagramRendererResolver>>,
    cacheKey: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const result = await renderer({ language, code, signal: controller.signal });
      if (!this.isCurrent(generation, controller)) return;
      if (result.kind === 'source-only') {
        this.emit({
          ...this.input,
          status: 'source-only',
          reason: 'renderer-declined',
          detail: result.reason,
        });
        return;
      }
      this.writeCache(cacheKey, result);
      this.emit({ ...this.input, status: 'ready', output: result, cached: false });
    } catch (error: unknown) {
      if (!this.isCurrent(generation, controller) || isAbortError(error)) return;
      this.emit({
        ...this.input,
        status: 'error',
        message: errorMessage(error),
        retryable: isRetryable(error),
      });
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private emit(state: DiagramRenderState): void {
    this.state = state;
    this.onStateChange(state);
  }

  private isCurrent(generation: number, controller: AbortController): boolean {
    return !this.disposed
      && generation === this.generation
      && !controller.signal.aborted;
  }

  private cancelPending(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.controller?.abort();
    this.controller = undefined;
  }

  private cacheKey(language: string, code: string): string {
    return `${language}\u0000${code}`;
  }

  private readCache(key: string): DiagramRenderOutput | undefined {
    const value = this.cache.get(key);
    if (!value) return undefined;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  private writeCache(key: string, output: DiagramRenderOutput): void {
    this.cache.delete(key);
    this.cache.set(key, output);
    while (this.cache.size > this.cacheSize) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }
}
