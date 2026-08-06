import { describe, expect, it, vi } from 'vitest';
import { prepareExportDiagrams, type DiagramPreparationScope } from '../shared/export';
import type { TiptapNode } from '../shared/types';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const SVG_DATA_URL = 'data:image/svg+xml;base64,PHN2Zy8+';

const diagram = (language: string, source: string): TiptapNode => ({
  type: 'diagram',
  attrs: { language, code: source },
});

const scope = (
  kind: DiagramPreparationScope['kind'],
  scopeId: string,
  content: TiptapNode[],
): DiagramPreparationScope => ({
  kind,
  scopeId,
  document: { type: 'doc', content },
});

describe('export diagram preparation', () => {
  it('reports completed when every external occurrence has a validated prepared image', async () => {
    const result = await prepareExportDiagrams(
      [scope('document', 'document', [diagram('plantuml', 'same'), diagram('plantuml', 'same')])],
      { render: async () => ({ dataUrl: PNG_DATA_URL }) },
    );

    expect(result).toMatchObject({
      status: 'completed',
      occurrenceCount: 2,
      uniqueDiagramCount: 1,
      preparedOccurrenceCount: 2,
      fallbackOccurrenceCount: 0,
      fallbackChapterCount: 0,
      diagnostics: [],
      omittedDiagnosticCount: 0,
    });
  });

  it('scans scopes and descendants deterministically, deduplicates renders, and counts occurrences', async () => {
    const render = vi.fn(async ({ language }: { language: string }) => ({
      dataUrl: language === 'd2' ? SVG_DATA_URL : PNG_DATA_URL,
    }));
    const scopes = [
      scope('chapter', 'chapter-a', [
        diagram('PlantUML', 'alpha'),
        { type: 'blockquote', content: [diagram('d2', 'beta')] },
        diagram('plantuml', 'alpha'),
        diagram('future-diagram', 'unsupported-source'),
        diagram('', 'defaults-to-local-mermaid'),
        diagram('mermaid', 'local-mermaid'),
      ]),
      scope('chapter', 'chapter-b', [
        diagram('D2', 'beta'),
        diagram('graphviz', 'gamma'),
        diagram('graphviz', 'gamma'),
      ]),
    ];

    const result = await prepareExportDiagrams(scopes, { render });

    expect(render.mock.calls.map(([request]) => [request.language, request.source])).toEqual([
      ['plantuml', 'alpha'],
      ['d2', 'beta'],
      ['graphviz', 'gamma'],
    ]);
    expect(result).toMatchObject({
      status: 'fallback',
      occurrenceCount: 7,
      scopeCount: 2,
      chapterCount: 2,
      uniqueDiagramCount: 4,
      preparedOccurrenceCount: 6,
      fallbackOccurrenceCount: 1,
      fallbackChapterCount: 1,
      omittedDiagnosticCount: 0,
    });
    expect(result.diagnostics).toEqual([
      {
        code: 'unsupported-language',
        language: 'future-diagram',
        occurrenceCount: 1,
        chapterCount: 1,
      },
    ]);
    expect(result.resolveDiagramImage({ language: 'plantuml', code: 'alpha' })).toEqual({
      dataUrl: PNG_DATA_URL,
    });
    expect(result.resolveDiagramImage({ language: 'd2', code: 'beta' })).toEqual({
      dataUrl: SVG_DATA_URL,
    });
  });

  it('reports deduplicated failures using occurrence and chapter counts without retaining source', async () => {
    const secretSource = 'secret-customer-diagram';
    const render = vi.fn(async () => {
      throw new Error(`renderer rejected ${secretSource}`);
    });
    const result = await prepareExportDiagrams(
      [
        scope('chapter', 'one', [diagram('plantuml', secretSource), diagram('plantuml', secretSource)]),
        scope('chapter', 'two', [diagram('plantuml', secretSource)]),
      ],
      { render },
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'fallback',
      occurrenceCount: 3,
      uniqueDiagramCount: 1,
      preparedOccurrenceCount: 0,
      fallbackOccurrenceCount: 3,
      fallbackChapterCount: 2,
    });
    expect(result.diagnostics).toEqual([
      {
        code: 'render-failed',
        language: 'plantuml',
        occurrenceCount: 3,
        chapterCount: 2,
      },
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain(secretSource);
  });

  it('accepts only validated language-specific image data and bounds diagnostics', async () => {
    const invalidFormat = vi.fn(async ({ language }: { language: string }) => ({
      dataUrl: language === 'd2' ? PNG_DATA_URL : SVG_DATA_URL,
    }));
    const invalid = await prepareExportDiagrams(
      [scope('document', 'document', [diagram('d2', 'wrong-png'), diagram('plantuml', 'wrong-svg')])],
      { render: invalidFormat },
    );

    expect(invalid.status).toBe('fallback');
    expect(invalid.fallbackOccurrenceCount).toBe(2);
    expect(invalid.diagnostics.map(({ code }) => code)).toEqual(['invalid-image', 'invalid-image']);

    const unsupportedSources = Array.from({ length: 25 }, (_, index) => diagram(`future-${index}`, `source-${index}`));
    const bounded = await prepareExportDiagrams([scope('chapter', 'chapter', unsupportedSources)], {});
    expect(bounded.diagnostics).toHaveLength(20);
    expect(bounded.omittedDiagnosticCount).toBe(5);
    expect(JSON.stringify(bounded.diagnostics)).not.toContain('source-');
  });

  it('propagates the caller signal and throws cancellation instead of returning fallback', async () => {
    const controller = new AbortController();
    const render = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          expect(signal).toBe(controller.signal);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const pending = prepareExportDiagrams([scope('document', 'document', [diagram('plantuml', 'cancel-me')])], {
      render,
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('throws renderer-owned cancellation even when the caller signal was not aborted', async () => {
    const cancelled = Object.assign(new Error('cancelled'), { code: 'cancelled' as const });

    await expect(
      prepareExportDiagrams([scope('document', 'document', [diagram('graphviz', 'cancelled')])], {
        render: async () => {
          throw cancelled;
        },
      }),
    ).rejects.toBe(cancelled);
  });
});
