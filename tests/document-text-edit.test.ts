import { describe, expect, it } from 'vitest';
import {
  applyDocumentTextEdit,
  applyDocumentTextEdits,
  isDocumentTextEditApplicationConfirmed,
  isDocumentTextEditSourceCurrent,
  measureDocumentTextEdit,
  measureDocumentTextEdits,
  planDocumentTextEdit,
  planSdocDocumentTextEdits,
  type DocumentTextEditCandidate,
} from '../src/utils/documentTextEdit';
import { createAcceptedPerformanceCorpus } from './performance/fixtures';

const isUnsafeBoundary = (text: string, offset: number): boolean => {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (before === 0x0d && after === 0x0a)
    || (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
};

describe('VS Code document text edit planning', () => {
  it('uses the smallest contiguous replacement for a canonical document change', () => {
    const current = '{\n  "title": "Before",\n  "body": "Stable"\n}\n';
    const next = '{\n  "title": "After",\n  "body": "Stable"\n}\n';

    const edit = planDocumentTextEdit(current, next);

    expect(edit).toEqual({
      kind: 'minimal',
      startOffset: 14,
      endOffset: 20,
      text: 'After',
    });
    expect(applyDocumentTextEdit(current, edit)).toBe(next);
  });

  it('does not split CRLF or a UTF-16 surrogate pair at either range boundary', () => {
    for (const [current, next] of [
      ['left\r\nright', 'left\nright'],
      ['before😀after', 'before😁after'],
      ['😀 suffix', '😁 suffix'],
    ] as const) {
      const edit = planDocumentTextEdit(current, next);

      expect(edit.kind).toBe('minimal');
      expect(isUnsafeBoundary(current, edit.startOffset)).toBe(false);
      expect(isUnsafeBoundary(current, edit.endOffset)).toBe(false);
      expect(applyDocumentTextEdit(current, edit)).toBe(next);
    }
  });

  it('falls back to a full replacement when a candidate is invalid or calculation throws', () => {
    const invalidCandidate = (): DocumentTextEditCandidate => ({
      startOffset: 50,
      endOffset: 2,
      text: 'broken',
    });
    const throwingCandidate = (): DocumentTextEditCandidate => {
      throw new Error('planner failed');
    };

    for (const candidate of [invalidCandidate, throwingCandidate]) {
      const edit = planDocumentTextEdit('old', 'new', candidate);
      expect(edit).toEqual({ kind: 'full', startOffset: 0, endOffset: 3, text: 'new' });
      expect(applyDocumentTextEdit('old', edit)).toBe('new');
    }
  });

  it('rejects a candidate that would preserve only half of a next-text surrogate pair', () => {
    const current = 'a\ud83dXb';
    const next = 'a😀b';
    const splitNextPair = (): DocumentTextEditCandidate => ({
      startOffset: 2,
      endOffset: 3,
      text: '\ude00',
    });

    expect(planDocumentTextEdit(current, next, splitNextPair)).toEqual({
      kind: 'full',
      startOffset: 0,
      endOffset: current.length,
      text: next,
    });
  });

  it('retains the existing revision-producing full edit for identical text', () => {
    const edit = planDocumentTextEdit('same', 'same');

    expect(edit).toEqual({ kind: 'full', startOffset: 0, endOffset: 4, text: 'same' });
  });

  it('fails closed when the unversioned WorkspaceEdit source or result races', () => {
    const source = { version: 7, text: 'before' };

    expect(isDocumentTextEditSourceCurrent(source, 7, 'before')).toBe(true);
    expect(isDocumentTextEditSourceCurrent(source, 8, 'before')).toBe(false);
    expect(isDocumentTextEditSourceCurrent(source, 7, 'external')).toBe(false);
    expect(isDocumentTextEditApplicationConfirmed(source, 8, 'after', 'after', 8)).toBe(true);
    expect(isDocumentTextEditApplicationConfirmed(source, 7, 'after', 'after', 7)).toBe(false);
    expect(isDocumentTextEditApplicationConfirmed(source, 8, 'after', 'external', 8)).toBe(false);
    expect(isDocumentTextEditApplicationConfirmed(source, 8, 'after', 'after', undefined)).toBe(false);
    expect(isDocumentTextEditApplicationConfirmed(source, 9, 'after', 'after', 8)).toBe(false);
  });

  it('round-trips deterministic arbitrary UTF-16 edits without unsafe boundaries', () => {
    let state = 0x2160_2026;
    const nextRandom = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const atoms = ['a', 'b', '한', '😀', '\r\n', '\n', ' ', '[]'] as const;
    const randomText = (): string => Array.from(
      { length: nextRandom() % 24 },
      () => atoms[nextRandom() % atoms.length],
    ).join('');

    for (let sample = 0; sample < 500; sample += 1) {
      const current = randomText();
      const next = randomText();
      const edit = planDocumentTextEdit(current, next);

      expect(isUnsafeBoundary(current, edit.startOffset)).toBe(false);
      expect(isUnsafeBoundary(current, edit.endOffset)).toBe(false);
      expect(applyDocumentTextEdit(current, edit)).toBe(next);
    }
  });

  it('keeps a localized change in the 5k-block corpus below one percent of the source', () => {
    const corpus = createAcceptedPerformanceCorpus('text-5k');
    const nextEnvelope = structuredClone(corpus.envelope);
    nextEnvelope.doc.content![2_500].content![0].text = 'Localized replacement';
    const current = `${JSON.stringify(corpus.envelope, null, 2)}\n`;
    const next = `${JSON.stringify(nextEnvelope, null, 2)}\n`;

    const startedAt = performance.now();
    const edit = planDocumentTextEdit(current, next);
    const durationMs = performance.now() - startedAt;
    const replacedSourceCodeUnits = edit.endOffset - edit.startOffset;

    expect(edit.kind).toBe('minimal');
    expect(replacedSourceCodeUnits / current.length).toBeLessThan(0.01);
    expect(applyDocumentTextEdit(current, edit)).toBe(next);
    expect(Number.isFinite(durationMs)).toBe(true);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports portable code-unit counters and an integer symmetric replacement ratio', () => {
    const current = '0123456789';
    const next = '0123AB6789';
    const edit = planDocumentTextEdit(current, next);

    expect(measureDocumentTextEdit(current, next, edit)).toEqual({
      sourceCodeUnits: 10,
      targetCodeUnits: 10,
      sourceRangeCodeUnits: 2,
      insertedCodeUnits: 2,
      replacementRatioPpm: 200_000,
    });
    expect(measureDocumentTextEdit('', 'new', planDocumentTextEdit('', 'new'))
      .replacementRatioPpm).toBe(1_000_000);
  });

  it('separates canonical meta.modified and localized body changes into two ranges', () => {
    const current = `${JSON.stringify({
      sdoc: '1.0',
      meta: { modified: '2026-01-01T00:00:00.000Z' },
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }] },
    }, null, 2)}\n`;
    const next = current
      .replace('2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z')
      .replace('Before', 'Before localized');

    const plan = planSdocDocumentTextEdits(current, next);

    expect(plan.kind).toBe('modified-and-content');
    expect(plan.edits).toHaveLength(2);
    expect(plan.edits[0].endOffset).toBeLessThanOrEqual(plan.edits[1].startOffset);
    expect(applyDocumentTextEdits(current, plan.edits)).toBe(next);
    expect(measureDocumentTextEdits(current, next, plan.edits)).toMatchObject({
      sourceCodeUnits: current.length,
      targetCodeUnits: next.length,
      sourceRangeCodeUnits: 26,
      insertedCodeUnits: 36,
    });
  });

  it('uses one lexical token edit when only canonical meta.modified changes', () => {
    const current = '{"sdoc":"1.0","meta":{"modified":"2026-01-01T00:00:00.000Z"},"doc":{"type":"doc"}}';
    const next = current.replace('2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z');

    const plan = planSdocDocumentTextEdits(current, next);

    expect(plan).toMatchObject({ kind: 'single-span', edits: [{ kind: 'minimal' }] });
    expect(plan.edits[0].startOffset).toBeGreaterThan(0);
    expect(plan.edits[0].endOffset - plan.edits[0].startOffset).toBe(26);
    expect(applyDocumentTextEdits(current, plan.edits)).toBe(next);
  });

  it.each([
    [
      '{"sdoc":"1.0","meta":{"modified":"a","modified":"a"},"doc":{"type":"doc"}}',
      '{"sdoc":"1.0","meta":{"modified":"b","modified":"b"},"doc":{"type":"doc","content":[]}}',
    ],
    [
      '{"sdoc":"1.0","meta":{"modified":1},"doc":{"type":"doc"}}',
      '{"sdoc":"1.0","meta":{"modified":2},"doc":{"type":"doc","content":[]}}',
    ],
    [
      '{"sdoc":"1.0","meta":{"modified":"short"},"doc":{"type":"doc"}}',
      '{"sdoc":"1.0","meta":{"modified":"much-longer"},"doc":{"type":"doc","content":[]}}',
    ],
    [
      '{"sdoc":"1.0","meta":{"title":"old","modified":"same-length"},"doc":{"type":"doc"}}',
      '{"sdoc":"1.0","meta":{"title":"new","modified":"next-length"},"doc":{"type":"doc","content":[]}}',
    ],
    [
      '{"sdoc":"1.0","meta":{"modified":"same-length"},"meta":{"modified":"same-length"},"doc":{"type":"doc"}}',
      '{"sdoc":"1.0","meta":{"modified":"next-length"},"doc":{"type":"doc","content":[]}}',
    ],
    [
      '{"sdoc":"1.0","meta":{"modified":"same-length"},"doc":{"type":"doc"}}',
      '{\n  "sdoc": "1.0",\n  "meta": { "modified": "next-length" },\n  "doc": { "type": "doc", "content": [] }\n}',
    ],
  ])('falls back to one range when the modified split is unsafe', (current, next) => {
    const plan = planSdocDocumentTextEdits(current, next);

    expect(plan.kind).toBe('single-span');
    expect(plan.edits).toHaveLength(1);
    expect(applyDocumentTextEdits(current, plan.edits)).toBe(next);
  });
});
