import { describe, expect, it } from 'vitest';
import {
  parseDocumentContract,
  parseDocumentTextContract,
} from '../shared/document/documentContract';
import { createPerformanceRecorder } from '../shared/performance/instrumentation';
import { MAX_DOCUMENT_BYTES } from '../shared/resourceLimits';
import {
  acceptedPerformanceCorpusNames,
  countTiptapNodes,
  createAcceptedPerformanceCorpus,
  createRejectedPerformanceCorpus,
  PERFORMANCE_DOCUMENT_NODE_LIMIT,
  PERFORMANCE_FIXTURE_SEED,
} from './performance/fixtures';
import { createEditorTransactionSample } from './performance/editorTransactionSample';

describe('performance baseline corpora', () => {
  it('starts every editor transaction sample from identical dimensions without accumulating state', () => {
    const corpus = createAcceptedPerformanceCorpus('text-5k');
    const first = createEditorTransactionSample(corpus)!;
    const second = createEditorTransactionSample(corpus)!;
    expect(first.before).toEqual(second.before);
    first.run();
    second.run();
    expect(first.after()).toEqual(second.after());
    expect(first.after()).toEqual(first.before);
  });
  it('generates deterministic accepted corpora inside the persisted contract limits', () => {
    for (const name of acceptedPerformanceCorpusNames()) {
      const first = createAcceptedPerformanceCorpus(name);
      const second = createAcceptedPerformanceCorpus(name);
      const parsed = parseDocumentContract(first.envelope);

      expect(first.seed).toBeGreaterThanOrEqual(PERFORMANCE_FIXTURE_SEED);
      expect(first.text).toBe(second.text);
      expect(first.byteLength).toBe(second.byteLength);
      expect(first.nodeCount).toBe(countTiptapNodes(first.envelope.doc));
      expect(first.nodeCount).toBeLessThanOrEqual(PERFORMANCE_DOCUMENT_NODE_LIMIT);
      expect(first.byteLength).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
      expect(first.envelope.doc.content).toHaveLength(first.topLevelBlocks);
      expect(parsed.ok).toBe(true);
    }
  }, 15_000); // Rich 5k fixtures are generated twice and fully schema-validated on CI.

  it('keeps text, structure, and rich axes distinguishable by node operations', () => {
    const text = createAcceptedPerformanceCorpus('text-5k');
    const structure = createAcceptedPerformanceCorpus('structure-10k');
    const rich = createAcceptedPerformanceCorpus('rich-2k');

    expect(text.nodeCount).toBe(text.topLevelBlocks * 2 + 1);
    expect(structure.nodeCount).toBeGreaterThan(structure.topLevelBlocks * 2);
    expect(rich.nodeCount).toBeGreaterThan(rich.topLevelBlocks * 3);
    expect(new Set([text.axis, structure.axis, rich.axis])).toEqual(
      new Set(['text', 'structure', 'rich']),
    );
  });

  it('keeps the two 5k rich browser corpora reproducible without weakening their mix', () => {
    const mixed = createAcceptedPerformanceCorpus('rich-mixed-5k');
    const balanced = createAcceptedPerformanceCorpus('rich-balanced-5k');
    const countTypes = (corpus: typeof mixed): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const node of corpus.envelope.doc.content ?? []) {
        counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
      }
      return counts;
    };

    expect(mixed.topLevelBlocks).toBe(5_000);
    expect(countTypes(mixed)).toEqual(new Map([
      ['paragraph', 3_500], ['heading', 500], ['codeBlock', 250], ['mathBlock', 200],
      ['image', 150], ['table', 100], ['diagram', 100], ['callout', 150],
      ['blockquote', 50],
    ]));
    const mixedParagraphChildren = (mixed.envelope.doc.content ?? [])
      .filter((node) => node.type === 'paragraph')
      .flatMap((node) => node.content ?? []);
    expect(mixedParagraphChildren.filter((node) => node.type === 'mathInline')).toHaveLength(300);
    expect(mixedParagraphChildren.filter((node) => node.type === 'endnote')).toHaveLength(200);
    expect(balanced.topLevelBlocks).toBe(5_000);
    expect(countTypes(balanced).get('paragraph')).toBe(1_000);
    for (const type of ['heading', 'image', 'mathBlock', 'codeBlock', 'diagram', 'table', 'callout', 'blockquote']) {
      expect(countTypes(balanced).get(type), type).toBe(500);
    }
    expect(createAcceptedPerformanceCorpus('rich-mixed-5k').text).toBe(mixed.text);
    expect(createAcceptedPerformanceCorpus('rich-balanced-5k').text).toBe(balanced.text);
  });

  it('keeps rejection fixtures out of accepted corpora and exercises each guardrail', () => {
    const malformed = createRejectedPerformanceCorpus('malformed-schema');
    const tooManyNodes = createRejectedPerformanceCorpus('too-many-nodes');
    const tooLarge = createRejectedPerformanceCorpus('too-large-bytes');
    if (!('value' in malformed) || !('value' in tooManyNodes) || !('text' in tooLarge)) {
      throw new Error('unexpected rejection fixture shape');
    }

    const malformedResult = parseDocumentContract(malformed.value);
    const nodeResult = parseDocumentContract(tooManyNodes.value);
    const byteResult = parseDocumentTextContract(tooLarge.text);

    expect(malformedResult).toMatchObject({ ok: false, kind: malformed.expectedKind });
    expect(nodeResult).toMatchObject({ ok: false, kind: tooManyNodes.expectedKind });
    expect(byteResult).toMatchObject({ ok: false, kind: tooLarge.expectedKind });
    expect(new TextEncoder().encode(tooLarge.text).byteLength).toBeGreaterThan(MAX_DOCUMENT_BYTES);
  });
});

describe('host-neutral performance instrumentation', () => {
  it('records deterministic phase duration, outcome, and operation count', async () => {
    const ticks = [10, 13.5, 20, 26, 30, 32];
    const recorder = createPerformanceRecorder(
      () => ticks.shift()!,
      { corpus: 'fixture', documentBytes: 512, documentNodes: 21 },
    );

    expect(recorder.measure('parse', () => 'parsed', 512)).toBe('parsed');
    await expect(recorder.measureAsync('validate', async () => true, 21)).resolves.toBe(true);
    expect(() => recorder.measure('serialize', () => {
      throw new Error('expected');
    })).toThrow('expected');

    expect(recorder.report()).toEqual({
      schemaVersion: 1,
      clock: 'monotonic',
      unit: 'milliseconds',
      context: { corpus: 'fixture', documentBytes: 512, documentNodes: 21 },
      measurements: [
        { name: 'parse', durationMs: 3.5, operationCount: 512, outcome: 'ok' },
        { name: 'validate', durationMs: 6, operationCount: 21, outcome: 'ok' },
        { name: 'serialize', durationMs: 2, operationCount: 1, outcome: 'error' },
      ],
    });
  });

  it('rejects invalid counters and non-monotonic clocks', () => {
    const recorder = createPerformanceRecorder(() => 1);
    expect(() => recorder.measure('', () => undefined)).toThrow(/name/);
    expect(() => recorder.measure('phase', () => undefined, -1)).toThrow(/operation count/);

    const ticks = [2, 1];
    const nonMonotonic = createPerformanceRecorder(() => ticks.shift()!);
    expect(() => nonMonotonic.measure('phase', () => undefined)).toThrow(/monotonic/);
  });
});
