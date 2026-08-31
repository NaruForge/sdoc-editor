import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagramRenderCoordinator } from '../shared/editor/diagram/DiagramRenderCoordinator';
import {
  createEditorDiagramRendererResolver,
  createInteractionGatedDiagramRendererResolver,
  NOOP_HOST_DIAGRAM_RENDERER,
} from '../shared/editor/diagram/editorRenderer';
import {
  getExternalDiagramLanguages,
  hasExternalDiagramNodes,
} from '../shared/editor/diagram/externalDiagramNodes';
import { DiagramRenderError, type DiagramRenderState } from '../shared/editor/diagram/types';

afterEach(() => {
  vi.useRealTimers();
});

describe('DiagramRenderCoordinator', () => {
  it('debounces generation and aborts the prior request when input changes', async () => {
    vi.useFakeTimers();
    const states: DiagramRenderState[] = [];
    const signals: AbortSignal[] = [];
    const resolvers: Array<(value: { kind: 'svg'; markup: string }) => void> = [];
    const render = vi.fn(({ signal }: { code: string; signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise<{ kind: 'svg'; markup: string }>((resolve) => {
        resolvers.push(resolve);
      });
    });
    const coordinator = new DiagramRenderCoordinator({
      resolveRenderer: () => render,
      onStateChange: (state) => states.push(state),
      debounceMs: 50,
    });

    coordinator.setInput('mermaid', 'first');
    await vi.advanceTimersByTimeAsync(50);
    coordinator.setInput('mermaid', 'second');
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    resolvers[1]?.({ kind: 'svg', markup: '<svg>second</svg>' });
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      code: 'second',
      output: { kind: 'svg', markup: '<svg>second</svg>' },
    });
  });

  it('ignores an out-of-order renderer that resolves after its abort', async () => {
    vi.useFakeTimers();
    const states: DiagramRenderState[] = [];
    const resolvers: Array<(value: { kind: 'svg'; markup: string }) => void> = [];
    const render = vi.fn(() => new Promise<{ kind: 'svg'; markup: string }>((resolve) => {
      resolvers.push(resolve);
    }));
    const coordinator = new DiagramRenderCoordinator({
      resolveRenderer: () => render,
      onStateChange: (state) => states.push(state),
      debounceMs: 0,
    });

    coordinator.setInput('mermaid', 'old');
    await vi.runAllTimersAsync();
    coordinator.setInput('mermaid', 'new');
    await vi.runAllTimersAsync();
    resolvers[1]?.({ kind: 'svg', markup: '<svg>new</svg>' });
    await Promise.resolve();
    resolvers[0]?.({ kind: 'svg', markup: '<svg>old</svg>' });
    await Promise.resolve();

    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      code: 'new',
      output: { markup: '<svg>new</svg>' },
    });
    expect(states).not.toContainEqual(expect.objectContaining({
      status: 'ready',
      code: 'old',
    }));
  });

  it('reuses a successful cached rendering without calling the renderer again', async () => {
    vi.useFakeTimers();
    const states: DiagramRenderState[] = [];
    const render = vi.fn(async ({ code }: { code: string }) => ({
      kind: 'svg' as const,
      markup: `<svg>${code}</svg>`,
    }));
    const coordinator = new DiagramRenderCoordinator({
      resolveRenderer: () => render,
      onStateChange: (state) => states.push(state),
      debounceMs: 0,
    });

    coordinator.setInput('d2', 'a -> b');
    await vi.runAllTimersAsync();
    coordinator.setInput('d2', 'other');
    await vi.runAllTimersAsync();
    coordinator.setInput('d2', 'a -> b');

    expect(render).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ status: 'ready', cached: true });
  });

  it('keeps unknown languages source-only without invoking a renderer', () => {
    const states: DiagramRenderState[] = [];
    const render = vi.fn();
    const coordinator = new DiagramRenderCoordinator({
      resolveRenderer: () => render,
      onStateChange: (state) => states.push(state),
    });

    coordinator.setInput('future-lang', 'shape source');

    expect(render).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({
      status: 'source-only',
      reason: 'unsupported-language',
      language: 'future-lang',
      code: 'shape source',
    });
  });

  it('treats the no-op host renderer as an immediate source-only fallback', () => {
    const states: DiagramRenderState[] = [];
    const coordinator = new DiagramRenderCoordinator({
      resolveRenderer: createEditorDiagramRendererResolver(NOOP_HOST_DIAGRAM_RENDERER),
      onStateChange: (state) => states.push(state),
    });

    coordinator.setInput('plantuml', '@startuml\nA -> B\n@enduml');

    expect(states).toEqual([expect.objectContaining({
      status: 'source-only',
      reason: 'renderer-unavailable',
    })]);
  });

  it('gates external renderer resolution before the host renderer can be called', () => {
    const hostRenderer = vi.fn(async () => ({ kind: 'source-only' as const }));
    const blocked = createEditorDiagramRendererResolver(hostRenderer, false);
    const allowed = createEditorDiagramRendererResolver(hostRenderer, true);

    expect(blocked('plantuml')).toBeUndefined();
    expect(blocked('d2')).toBeUndefined();
    expect(blocked('graphviz')).toBeUndefined();
    expect(blocked('mermaid')).toBeTypeOf('function');
    expect(allowed('plantuml')).toBeTypeOf('function');
    expect(hostRenderer).not.toHaveBeenCalled();
  });

  it('keeps passive external nodes source-only until the user interacts', () => {
    let interacted = false;
    const hostRenderer = vi.fn(async () => ({ kind: 'source-only' as const }));
    const resolver = createInteractionGatedDiagramRendererResolver(
      hostRenderer,
      () => interacted,
    );

    expect(resolver('plantuml')).toBeUndefined();
    expect(resolver('mermaid')).toBeTypeOf('function');
    interacted = true;
    expect(resolver('plantuml')).toBeTypeOf('function');
    expect(hostRenderer).not.toHaveBeenCalled();
  });

  it('only retries failures classified as retryable', async () => {
    vi.useFakeTimers();
    const retryableRender = vi.fn()
      .mockRejectedValueOnce(new DiagramRenderError('Timed out', true))
      .mockResolvedValueOnce({
        kind: 'image', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1,
      });
    const coordinator = new DiagramRenderCoordinator({
      resolveRenderer: () => retryableRender,
      onStateChange: () => {},
      debounceMs: 0,
    });
    coordinator.setInput('plantuml', 'A -> B');
    await vi.runAllTimersAsync();
    expect(coordinator.currentState).toMatchObject({
      status: 'error',
      retryable: true,
    });

    coordinator.retry();
    await Promise.resolve();
    expect(retryableRender).toHaveBeenCalledTimes(2);
    expect(coordinator.currentState).toMatchObject({ status: 'ready' });

    const nonRetryableRender = vi.fn()
      .mockRejectedValue(Object.assign(new Error('Invalid source'), { retryable: false }));
    const nonRetryable = new DiagramRenderCoordinator({
      resolveRenderer: () => nonRetryableRender,
      onStateChange: () => {},
      debounceMs: 0,
    });
    nonRetryable.setInput('mermaid', 'invalid');
    await vi.runAllTimersAsync();
    nonRetryable.retry();
    expect(nonRetryableRender).toHaveBeenCalledTimes(1);
  });
});

describe('external diagram document detection', () => {
  it('finds supported external languages once in document order', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'diagram', attrs: { language: 'mermaid', code: 'graph TD' } },
        { type: 'diagram', attrs: { language: 'plantuml', code: '@startuml' } },
        {
          type: 'blockquote',
          content: [
            { type: 'diagram', attrs: { language: 'D2', code: 'a -> b' } },
            { type: 'diagram', attrs: { language: 'plantuml', code: '@enduml' } },
          ],
        },
        { type: 'diagram', attrs: { language: 'future-language', code: 'source' } },
      ],
    };

    expect(getExternalDiagramLanguages(document)).toEqual(['plantuml', 'd2']);
    expect(hasExternalDiagramNodes(document)).toBe(true);
  });

  it('ignores Mermaid, unknown languages, and non-diagram code blocks', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'diagram', attrs: { language: 'mermaid', code: 'graph TD' } },
        { type: 'diagram', attrs: { language: 'unknown', code: 'source' } },
        { type: 'codeBlock', attrs: { language: 'plantuml' } },
      ],
    };

    expect(getExternalDiagramLanguages(document)).toEqual([]);
    expect(hasExternalDiagramNodes(document)).toBe(false);
  });
});
