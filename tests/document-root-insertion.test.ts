import { describe, expect, it } from 'vitest';
import { applyOperationRequest, computeRevision, inspectDocumentBytes } from '../shared/document/operations';
import type { TiptapNode } from '../shared/types';

const paragraph = (text: string): TiptapNode => ({
  type: 'paragraph', content: [{ type: 'text', text }],
});
const source = (content?: TiptapNode[]) => JSON.stringify({
  sdoc: '1.0', meta: { modified: '2025-01-01T00:00:00.000Z' },
  doc: { type: 'doc', ...(content === undefined ? {} : { content }) },
});
const apply = (text: string, operations: unknown[], revision = computeRevision(text)) =>
  applyOperationRequest(text, {
    contract: 'sdoc.operations/1', expected: { revision }, operations,
  }, { clock: () => '2026-09-07T00:00:00.000Z' });
const block = (position: string, text = 'New') => ({
  op: 'insertBlock', destination: { position }, block: paragraph(text),
});
const section = (position: string) => ({
  op: 'insertSection', destination: { position }, title: 'First section', id: 'first',
  blocks: [paragraph('Section body')],
});

describe('document root insertion', () => {
  it.each(['document-start', 'document-end'])('inserts blocks and H1 sections into empty documents at %s', (position) => {
    for (const content of [[], undefined]) {
      const text = source(content);
      const inserted = apply(text, [block(position)]);
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) throw new Error(JSON.stringify(inserted));
      expect(inserted.envelope.doc.content).toEqual([paragraph('New')]);
      expect(inserted.diff.some((event) => event.kind === 'block-inserted')).toBe(true);
      const result = apply(text, [section(position)]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.envelope.doc.content?.map((node) => node.type)).toEqual(['heading', 'paragraph']);
      expect(result.envelope.doc.content?.[0].attrs).toMatchObject({ level: 1, id: 'first' });
      expect(result.diff.some((event) => event.kind === 'section-inserted')).toBe(true);
    }
  });

  it.each(['document-start', 'document-end'])('adds the first section at the exact %s boundary', (position) => {
    const original = paragraph('Existing prologue');
    const result = apply(source([original]), [section(position)]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const content = result.envelope.doc.content!;
    expect(content[position === 'document-start' ? 2 : 0]).toEqual(original);
    expect(content[position === 'document-start' ? 0 : 1].attrs).toMatchObject({ level: 1 });
  });

  it('recovers after deleting the last snapshot anchor in one batch and in a later request', () => {
    const text = source([paragraph('Last')]);
    const inspected = inspectDocumentBytes(text);
    if (!inspected.ok) throw new Error(JSON.stringify(inspected));
    const deletion = { op: 'deleteBlock', target: inspected.blocks[0].operationTarget };
    for (const insertion of [block('document-end'), section('document-start')]) {
      const batch = apply(text, [deletion, insertion]);
      expect(batch.ok).toBe(true);
      const empty = apply(text, [deletion]);
      if (!empty.ok) throw new Error(JSON.stringify(empty));
      expect(empty.envelope.doc.content).toEqual([]);
      const recovered = apply(empty.outputText, [insertion]);
      expect(recovered.ok).toBe(true);
      if (batch.ok && recovered.ok) expect(recovered.envelope).toEqual(batch.envelope);
    }
  });

  it('evaluates root boundaries in operation order while existing snapshot targets stay bound', () => {
    const text = source([paragraph('Original')]);
    const inspected = inspectDocumentBytes(text);
    if (!inspected.ok) throw new Error(JSON.stringify(inspected));
    const result = apply(text, [
      block('document-start', 'Start A'), block('document-start', 'Start B'),
      block('document-end', 'End A'), block('document-end', 'End B'),
      { op: 'replaceBlock', target: inspected.blocks[0].operationTarget, block: paragraph('Replaced') },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.envelope.doc.content?.map((node) => node.content?.[0].text))
      .toEqual(['Start B', 'Start A', 'Replaced', 'End A', 'End B']);
  });

  it('assigns a persistent root heading id and preserves existing levels at both document boundaries', () => {
    const text = source([
      { type: 'heading', attrs: { level: 1, id: 'existing' }, content: [{ type: 'text', text: 'Existing' }] },
      { type: 'heading', attrs: { level: 2, id: 'child' }, content: [{ type: 'text', text: 'Child' }] },
      paragraph('Existing body'),
    ]);
    const result = apply(text, [{
      op: 'insertSection', destination: { position: 'document-start' }, title: '새 장',
    }, { ...section('document-end'), id: 'last' }]);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const inspected = inspectDocumentBytes(result.outputText);
    if (!inspected.ok) throw new Error(JSON.stringify(inspected));
    expect(inspected.needsIdNormalization).toBe(false);
    expect(inspected.outline.map((heading) => heading.level)).toEqual([1, 1, 2, 1]);
    expect(inspected.outline.map((heading) => heading.id)).toEqual([
      expect.any(String), 'existing', 'child', 'last',
    ]);
    const renamed = apply(result.outputText, [{
      op: 'renameHeading', target: { kind: 'id', id: inspected.outline[0].id }, title: 'Renamed',
    }]);
    expect(renamed.ok).toBe(true);
    const premature = apply(source([]), [section('document-start'), {
      op: 'renameHeading', target: { kind: 'id', id: 'first' }, title: 'Too soon',
    }]);
    expect(premature.ok).toBe(false);
    expect(premature).not.toHaveProperty('outputText');
  });

  it('rejects ambiguous root selectors and does not extend movement destinations', () => {
    const target = { kind: 'id', id: 'existing' };
    const text = source([{ type: 'heading', attrs: { level: 1, id: 'existing' } }]);
    for (const operation of [
      { ...section('document-start'), target },
      { ...section('document-start'), position: 'child' },
      { ...section('document-start'), level: 2 },
      { ...section('before') },
      { ...block('document-start'), destination: { position: 'document-start', target } },
      { op: 'moveBlock', target, destination: { position: 'document-end' } },
      { op: 'moveSection', target, destination: { position: 'document-start' } },
    ]) {
      const result = apply(text, [operation]);
      expect(result.ok, JSON.stringify(operation)).toBe(false);
      if (!result.ok) expect(result.category).toBe('argument');
    }
  });

  it('preserves revision, heading, id, and atomic validation for root insertion', () => {
    const text = source([]);
    const stale = apply(text, [block('document-start')], computeRevision(source([paragraph('Other')])));
    expect(stale).toMatchObject({ ok: false, category: 'conflict', diagnostics: [{ code: 'STALE_REVISION' }] });
    const headingBlock = apply(text, [{
      ...block('document-start'), block: { type: 'heading', attrs: { level: 1 } },
    }]);
    expect(headingBlock).toMatchObject({ ok: false, diagnostics: [{ code: 'SECTION_OPERATION_REQUIRED' }] });
    const siblings = apply(text, [{
      ...section('document-start'), blocks: [{ type: 'heading', attrs: { level: 2 } }],
    }]);
    expect(siblings).toMatchObject({ ok: false, diagnostics: [{ code: 'SECTION_OPERATION_REQUIRED' }] });
    const duplicate = apply(text, [section('document-start'), section('document-end')]);
    expect(duplicate).toMatchObject({ ok: false, diagnostics: [{ code: 'DUPLICATE_ID' }] });
    expect(duplicate).not.toHaveProperty('outputText');
    const invalidId = apply(text, [{ ...section('document-start'), id: 'provisional:reserved' }]);
    expect(invalidId).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_NEW_ID' }] });
    const invalidNode = apply(text, [block('document-start'), {
      ...block('document-end'), block: { type: 'not-a-node' },
    }]);
    expect(invalidNode.ok).toBe(false);
    expect(invalidNode).not.toHaveProperty('outputText');
  });
});
