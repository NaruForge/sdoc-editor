import katex from 'katex';

export type KatexMarkupRenderer = (latex: string, displayMode: boolean) => string;

export const KATEX_CACHE_MAX_ENTRIES = 256;
/** One Mi UTF-16 code units (roughly two MiB for the string payloads). */
export const KATEX_CACHE_MAX_TOTAL_CODE_UNITS = 1024 * 1024;
/** 64 Ki UTF-16 code units across one source, key, and rendered result. */
export const KATEX_CACHE_MAX_ENTRY_CODE_UNITS = 64 * 1024;

export interface KatexRenderCacheWeightLimits {
  readonly maxTotalCodeUnits?: number;
  readonly maxEntryCodeUnits?: number;
}

interface KatexRenderCacheEntry {
  readonly rendered: string;
  readonly weight: number;
}

const renderKatexMarkup: KatexMarkupRenderer = (latex, displayMode) =>
  katex.renderToString(latex || '\\square', {
    throwOnError: false,
    displayMode,
    output: 'htmlAndMathml',
    trust: false,
  });

/**
 * Per-webview LRU for trusted KaTeX output.
 *
 * Both the entry count and retained UTF-16 code units are bounded. The weight
 * deliberately includes source + lookup key + rendered output; an oversized
 * result is returned to the caller but never retained.
 */
export class BoundedKatexRenderCache {
  private readonly entries = new Map<string, KatexRenderCacheEntry>();
  private retainedCodeUnits = 0;
  private readonly maxTotalCodeUnits: number;
  private readonly maxEntryCodeUnits: number;

  public constructor(
    private readonly capacity = KATEX_CACHE_MAX_ENTRIES,
    private readonly renderMarkup: KatexMarkupRenderer = renderKatexMarkup,
    limits: KatexRenderCacheWeightLimits = {},
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('KaTeX cache capacity must be a positive safe integer');
    }
    this.maxTotalCodeUnits = limits.maxTotalCodeUnits ?? KATEX_CACHE_MAX_TOTAL_CODE_UNITS;
    this.maxEntryCodeUnits = limits.maxEntryCodeUnits ?? KATEX_CACHE_MAX_ENTRY_CODE_UNITS;
    if (!Number.isSafeInteger(this.maxTotalCodeUnits) || this.maxTotalCodeUnits < 1) {
      throw new Error('KaTeX cache total weight must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.maxEntryCodeUnits) || this.maxEntryCodeUnits < 1) {
      throw new Error('KaTeX cache entry weight must be a positive safe integer');
    }
  }

  public get(latex: string, displayMode: boolean): string {
    const source = latex || '\\square';
    const key = `${displayMode ? 'block' : 'inline'}\u0000${source}`;
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.rendered;
    }
    return this.renderAndStore(source, key, displayMode);
  }

  /** Re-renders one key and atomically replaces its cached weight. */
  public refresh(latex: string, displayMode: boolean): string {
    const source = latex || '\\square';
    const key = `${displayMode ? 'block' : 'inline'}\u0000${source}`;
    return this.renderAndStore(source, key, displayMode);
  }

  public clear(): void {
    this.entries.clear();
    this.retainedCodeUnits = 0;
  }

  public get entryCount(): number {
    return this.entries.size;
  }

  public get totalCodeUnits(): number {
    return this.retainedCodeUnits;
  }

  private renderAndStore(source: string, key: string, displayMode: boolean): string {
    const rendered = this.renderMarkup(source, displayMode);
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      this.retainedCodeUnits -= previous.weight;
    }

    const weight = source.length + key.length + rendered.length;
    if (weight > this.maxEntryCodeUnits || weight > this.maxTotalCodeUnits) {
      return rendered;
    }

    this.entries.set(key, { rendered, weight });
    this.retainedCodeUnits += weight;
    while (this.entries.size > this.capacity || this.retainedCodeUnits > this.maxTotalCodeUnits) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const evicted = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (evicted !== undefined) this.retainedCodeUnits -= evicted.weight;
    }
    return rendered;
  }
}

const sharedKatexCache = new BoundedKatexRenderCache();

export function renderKatexCached(
  latex: string,
  target: HTMLElement,
  displayMode: boolean,
): void {
  try {
    target.innerHTML = sharedKatexCache.get(latex, displayMode);
  } catch {
    target.textContent = latex;
  }
}
