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
  });

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
