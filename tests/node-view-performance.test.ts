import { describe, expect, it, vi } from 'vitest';
import { BoundedKatexRenderCache } from '../shared/editor/extensions/katexRenderCache';
import { areNodeViewAttributesEqual } from '../shared/editor/extensions/nodeViewUpdate';
import {
  createCodeBlockLanguageChoices,
  EditorScopedControllerRegistry,
} from '../shared/editor/extensions/CodeBlockLanguageController';
import {
  attachMaterializationTriggers,
  createViewportMaterializer,
} from '../shared/editor/extensions/viewportMaterializer';

describe('rich NodeView no-op boundaries', () => {
  it('keeps auto distinct from empty, Unicode, custom, and literal null languages', () => {
    const supported = ['typescript', 'null'];
    expect(createCodeBlockLanguageChoices(null, supported).map(({ value }) => value))
      .toEqual([null, 'typescript', 'null']);
    expect(createCodeBlockLanguageChoices('', supported).map(({ value }) => value))
      .toEqual([null, '', 'typescript', 'null']);
    expect(createCodeBlockLanguageChoices('custom:언어', supported).map(({ value }) => value))
      .toEqual([null, 'custom:언어', 'typescript', 'null']);
    expect(createCodeBlockLanguageChoices('null', supported).map(({ value }) => value))
      .toEqual([null, 'typescript', 'null']);
  });

  it('isolates singleton controllers per editor and destroys each after its last release', () => {
    const registry = new EditorScopedControllerRegistry<object, { destroy(): void }>();
    const firstEditor = {};
    const secondEditor = {};
    const firstController = { destroy: vi.fn() };
    const secondController = { destroy: vi.fn() };
    const first = registry.acquire(firstEditor, () => firstController);
    const firstAgain = registry.acquire(firstEditor, () => ({ destroy: vi.fn() }));
    const second = registry.acquire(secondEditor, () => secondController);

    expect(first.controller).toBe(firstAgain.controller);
    expect(second.controller).not.toBe(first.controller);
    first.release();
    first.release();
    expect(firstController.destroy).not.toHaveBeenCalled();
    firstAgain.release();
    expect(firstController.destroy).toHaveBeenCalledOnce();
    expect(secondController.destroy).not.toHaveBeenCalled();
    second.release();
    expect(secondController.destroy).toHaveBeenCalledOnce();
  });

  it('recognizes equivalent scalar attrs without trusting key order', () => {
    expect(areNodeViewAttributesEqual(
      { id: 'figure-1', caption: 'Overview', align: 'center' },
      { align: 'center', id: 'figure-1', caption: 'Overview' },
    )).toBe(true);
    expect(areNodeViewAttributesEqual(
      { id: 'figure-1', caption: 'Before' },
      { id: 'figure-1', caption: 'After' },
    )).toBe(false);
    expect(areNodeViewAttributesEqual({ id: 'figure-1' }, { id: 'figure-1', alt: '' }))
      .toBe(false);
  });

  it('caches identical KaTeX work by display mode and evicts least-recently-used entries', () => {
    const renderer = vi.fn((latex: string, displayMode: boolean) =>
      `<safe data-display="${displayMode}">${latex}</safe>`);
    const cache = new BoundedKatexRenderCache(2, renderer);

    expect(cache.get('x=1', false)).toBe(cache.get('x=1', false));
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(cache.get('x=1', true)).not.toBe(cache.get('x=1', false));
    expect(renderer).toHaveBeenCalledTimes(2);

    cache.get('x=2', false);
    cache.get('x=1', true);
    expect(renderer).toHaveBeenCalledTimes(4);
  });

  it('bounds many small KaTeX entries by their total UTF-16 weight', () => {
    const renderer = vi.fn((latex: string) => `rendered:${latex}`);
    const cache = new BoundedKatexRenderCache(200, renderer, {
      maxTotalCodeUnits: 400,
      maxEntryCodeUnits: 100,
    });

    for (let index = 0; index < 100; index += 1) {
      cache.get(`x${index}`, false);
    }

    expect(cache.entryCount).toBe(16);
    expect(cache.totalCodeUnits).toBe(400);
    expect(cache.get('x0', false)).toBe('rendered:x0');
    expect(renderer).toHaveBeenCalledTimes(101);
    expect(cache.totalCodeUnits).toBeLessThanOrEqual(400);
  });

  it('returns but does not cache an individually oversized KaTeX result', () => {
    const renderer = vi.fn((latex: string) => `<rendered>${latex}</rendered>`);
    const cache = new BoundedKatexRenderCache(10, renderer, {
      maxTotalCodeUnits: 1_000,
      maxEntryCodeUnits: 64,
    });
    const source = 'x'.repeat(64);

    expect(cache.get(source, false)).toContain(source);
    expect(cache.get(source, false)).toContain(source);
    expect(renderer).toHaveBeenCalledTimes(2);
    expect(cache.entryCount).toBe(0);
    expect(cache.totalCodeUnits).toBe(0);
  });

  it('accounts for refreshed weights and evicts multiple older entries', () => {
    let suffix = '';
    const renderer = vi.fn((latex: string) => `${latex}${suffix}`);
    const cache = new BoundedKatexRenderCache(10, renderer, {
      maxTotalCodeUnits: 90,
      maxEntryCodeUnits: 100,
    });

    cache.get('a', false);
    cache.get('b', false);
    cache.get('c', false);
    cache.get('d', false);
    expect(cache.totalCodeUnits).toBe(40);

    suffix = 'z'.repeat(70);
    cache.refresh('d', false);
    expect(cache.entryCount).toBe(2);
    expect(cache.totalCodeUnits).toBe(90);
    expect(cache.get('c', false)).toBe('c');
    expect(renderer).toHaveBeenCalledTimes(5);
  });

  it('clears weighted state and keeps live-preview prefixes as distinct LRU keys', () => {
    const renderer = vi.fn((latex: string, displayMode: boolean) =>
      `${displayMode ? 'block' : 'inline'}:${latex}`);
    const cache = new BoundedKatexRenderCache(10, renderer);

    expect(cache.get('live-preview:x', false)).toBe('inline:live-preview:x');
    expect(cache.get('live-preview:xy', false)).toBe('inline:live-preview:xy');
    expect(cache.get('live-preview:x', true)).toBe('block:live-preview:x');
    expect(cache.get('live-preview:x', false)).toBe('inline:live-preview:x');
    expect(renderer).toHaveBeenCalledTimes(3);
    expect(cache.entryCount).toBe(3);
    expect(cache.totalCodeUnits).toBeGreaterThan(0);

    cache.clear();
    expect(cache.entryCount).toBe(0);
    expect(cache.totalCodeUnits).toBe(0);
    cache.get('live-preview:x', false);
    expect(renderer).toHaveBeenCalledTimes(4);
  });

  it('uses KaTeX trust=false output rather than copying raw HTML into the cache', () => {
    const cache = new BoundedKatexRenderCache();
    const markup = cache.get('\\href{javascript:alert(1)}{unsafe}', false);

    expect(markup).not.toContain('href="javascript:');
    expect(markup).toContain('katex');
  });

  it('materializes viewport content once and has an eager unsupported-host fallback', () => {
    let callback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    class FakeIntersectionObserver {
      public readonly root = null;
      public readonly rootMargin = '800px 0px';
      public readonly thresholds = [0];
      public constructor(next: IntersectionObserverCallback) {
        callback = next;
      }
      public observe = observe;
      public disconnect = disconnect;
      public unobserve = vi.fn();
      public takeRecords = () => [];
    }
    const materialize = vi.fn();
    const target = {} as Element;
    const lazy = createViewportMaterializer({
      target,
      materialize,
      observer: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
    });

    expect(observe).toHaveBeenCalledWith(target);
    expect(materialize).not.toHaveBeenCalled();
    callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(materialize).not.toHaveBeenCalled();
    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    lazy.ensure();
    expect(materialize).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();

    const eager = vi.fn();
    expect(createViewportMaterializer({ target, materialize: eager, observer: undefined }).materialized)
      .toBe(true);
    expect(eager).toHaveBeenCalledOnce();
  });

  it('materializes on focus and beforeprint and detaches both triggers on destroy', () => {
    const focusTarget = new EventTarget();
    const printTarget = new EventTarget();
    const ensure = vi.fn();
    const triggers = attachMaterializationTriggers(focusTarget, printTarget, ensure);

    focusTarget.dispatchEvent(new Event('focusin'));
    printTarget.dispatchEvent(new Event('beforeprint'));
    expect(ensure).toHaveBeenCalledTimes(2);

    triggers.destroy();
    focusTarget.dispatchEvent(new Event('focusin'));
    printTarget.dispatchEvent(new Event('beforeprint'));
    expect(ensure).toHaveBeenCalledTimes(2);
  });
});
