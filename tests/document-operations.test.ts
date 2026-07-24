import { describe, expect, it } from 'vitest';
import type { SdocEnvelope, TiptapNode } from '../shared/types';
import {
  applyOperationRequest, computeRevision, inspectDocumentBytes, validateDocumentBytes,
  type NodeTarget, type SdocOperation,
} from '../shared/document/operations';
import comparison from './fixtures/operations-payload-comparison.json';

const heading = (level: number, id: string | undefined, title: string): TiptapNode => ({
  type: 'heading',
  attrs: { level, ...(id ? { id } : {}) },
  content: [{ type: 'text', text: title }],
});
const paragraph = (value: string): TiptapNode => ({
  type: 'paragraph', content: [{ type: 'text', text: value }],
});
const envelope = (content: TiptapNode[]): SdocEnvelope => ({
  sdoc: '1.0',
  meta: {
    documentId: 'doc-1',
    modified: '2025-01-01T00:00:00.000Z',
    settings: { captionStyle: 'korean', headingNumbering: true },
  },
  doc: { type: 'doc', content },
});
const source = (content: TiptapNode[]): string => JSON.stringify(envelope(content));
const target = (id: string): NodeTarget => ({ kind: 'id', id });
const apply = (text: string, operations: SdocOperation[]) => applyOperationRequest(text, {
  contract: 'sdoc.operations/1',
  expected: { revision: computeRevision(text), documentId: 'doc-1' },
  operations,
}, {
  clock: () => '2026-07-24T00:00:00.000Z',
  currentDocumentId: 'doc-1',
});

describe('document operations core', () => {
  it('computes standard SHA-256 revisions from UTF-8 bytes', () => {
    expect(computeRevision('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(computeRevision('한글')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('inspects legacy documents and exposes guarded snapshot locators and provisional ids', () => {
    const text = JSON.stringify({
      type: 'doc',
      content: [heading(1, undefined, '소개'), paragraph('본문')],
    });
    const result = inspectDocumentBytes(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legacy).toBe(true);
    expect(result.needsIdNormalization).toBe(true);
    expect(result.outline[0].provisionalId).toMatch(/^provisional:/);
    expect(result.blocks.find((block) => block.type === 'paragraph')?.digest)
      .toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('rejects malformed/future documents and duplicate existing ids without throwing', () => {
    expect(validateDocumentBytes('{').ok).toBe(false);
    const future = validateDocumentBytes(JSON.stringify({ sdoc: '2.0', doc: { type: 'doc' } }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.diagnostics[0].code).toBe('UNSUPPORTED_VERSION');
    const duplicate = validateDocumentBytes(source([
      heading(1, 'same', 'One'), heading(2, 'same', 'Two'),
    ]));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0].code).toBe('DUPLICATE_ID');
  });

  it('renames a plain heading while preserving its id and refreshing reference text', () => {
    const text = source([
      heading(1, 'intro', 'Old'),
      {
        type: 'paragraph',
        content: [{
          type: 'text', text: 'old label',
          marks: [{ type: 'link', attrs: { href: '#intro' } }],
        }],
      },
    ]);
    const result = apply(text, [{ op: 'renameHeading', target: target('intro'), title: '시험 결과' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.doc.content?.[0].attrs?.id).toBe('intro');
    expect(result.envelope.doc.content?.[0].content?.[0].text).toBe('시험 결과');
    expect(result.envelope.doc.content?.[1].content?.[0].text).toContain('시험 결과');
    expect(result.envelope.meta.modified).toBe('2026-07-24T00:00:00.000Z');
    expect(result.normalizationPolicy.captionStyle).toBe('korean');
  });

  it('protects marked headings unless formatting loss is explicit', () => {
    const formatted = heading(1, 'intro', 'Old');
    if (formatted.content?.[0]) formatted.content[0].marks = [{ type: 'bold' }];
    const text = source([formatted]);
    const rejected = apply(text, [
      { op: 'renameHeading', target: target('intro'), title: 'New' },
    ]);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0].code).toBe('FORMATTED_HEADING');
    const accepted = apply(text, [
      {
        op: 'renameHeading', target: target('intro'), title: 'New',
        discardFormatting: true,
      },
    ]);
    expect(accepted.ok).toBe(true);
  });

  it('resolves every snapshot target before the batch so insertion does not retarget it', () => {
    const text = source([heading(1, 'intro', 'Intro'), paragraph('A'), paragraph('B')]);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const block = inspected.blocks.find((entry) => entry.summary === 'paragraph: B');
    expect(block?.digest).toBeTruthy();
    const snapshot: NodeTarget = {
      kind: 'snapshot', path: block?.path ?? [], nodeType: 'paragraph',
      digest: block?.digest ?? computeRevision(''),
    };
    const result = apply(text, [
      {
        op: 'insertBlock', destination: { position: 'after', target: target('intro') },
        block: paragraph('Inserted'),
      },
      { op: 'replaceBlock', target: snapshot, block: paragraph('Replaced B') },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.doc.content?.map((node) => node.content?.[0]?.text))
      .toEqual(['Intro', 'Inserted', 'A', 'Replaced B']);
  });

  it('inserts child sections at their parent boundary and rejects H6 children', () => {
    const text = source([
      heading(1, 'one', 'One'), paragraph('one body'),
      heading(2, 'existing', 'Existing'), paragraph('existing body'),
      heading(1, 'two', 'Two'),
    ]);
    const result = apply(text, [{
      op: 'insertSection', target: target('one'), title: 'Added', id: 'added',
      blocks: [paragraph('added body')],
    }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = result.envelope.doc.content ?? [];
    expect(nodes.findIndex((node) => node.attrs?.id === 'added')).toBe(4);
    expect(nodes[4].attrs?.level).toBe(2);
    const h6Text = source([heading(6, 'deep', 'Deep')]);
    const rejected = apply(h6Text, [
      { op: 'insertSection', target: target('deep'), title: 'Too deep' },
    ]);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0].code).toBe('H6_CHILD_SECTION');
  });

  it('moves/deletes complete section ranges and rejects headings as blocks', () => {
    const text = source([
      heading(1, 'a', 'A'), paragraph('A body'),
      heading(2, 'a-child', 'A child'), paragraph('child body'),
      heading(1, 'b', 'B'), paragraph('B body'),
    ]);
    const moved = apply(text, [{
      op: 'moveSection', target: target('a-child'),
      destination: { position: 'after', target: target('b') },
    }]);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.envelope.doc.content?.map((node) => node.attrs?.id).filter(Boolean))
      .toEqual(['a', 'b', 'a-child']);
    const deleted = apply(text, [{ op: 'deleteSection', target: target('a') }]);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.envelope.doc.content?.map((node) => node.attrs?.id).filter(Boolean))
        .toEqual(['b']);
    }
    const blockDelete = apply(text, [{ op: 'deleteBlock', target: target('a') }]);
    expect(blockDelete.ok).toBe(false);
    if (!blockDelete.ok) expect(blockDelete.diagnostics[0].code).toBe('SECTION_OPERATION_REQUIRED');
  });

  it('preserves code whitespace and enforces replace/attribute contracts', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: ' x  \n' }] },
    ]);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const code = inspected.blocks.find((entry) => entry.type === 'codeBlock');
    const codeTarget: NodeTarget = {
      kind: 'snapshot', path: code?.path ?? [], nodeType: 'codeBlock',
      digest: code?.digest ?? computeRevision(''),
    };
    const result = apply(text, [{
      op: 'updateBlockAttrs', target: codeTarget, attrs: { language: 'javascript' },
    }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.doc.content?.[1].content?.[0].text).toBe(' x  \n');
    }
    const invalid = apply(text, [{
      op: 'updateBlockAttrs', target: codeTarget, attrs: { id: 'forbidden' },
    }]);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics[0].code).toBe('ATTRIBUTE_NOT_ALLOWED');
  });

  it('rejects stale/digest conflicts and rolls back a failing batch', () => {
    const text = source([heading(1, 'intro', 'Intro'), paragraph('unchanged')]);
    const stale = applyOperationRequest(text, {
      contract: 'sdoc.operations/1',
      expected: { revision: `sha256:${'0'.repeat(64)}` },
      operations: [],
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.diagnostics[0].code).toBe('STALE_REVISION');
    const badTarget: NodeTarget = {
      kind: 'snapshot', path: [1], nodeType: 'paragraph',
      digest: `sha256:${'0'.repeat(64)}`,
    };
    const conflict = apply(text, [{ op: 'deleteBlock', target: badTarget }]);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.diagnostics[0].code).toBe('TARGET_DIGEST_MISMATCH');
    const original = JSON.parse(text) as SdocEnvelope;
    expect(original.doc.content?.[0].content?.[0].text).toBe('Intro');
  });

  it('allows baseline warnings but rejects newly introduced links and assets', () => {
    const baselineText = source([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'old',
        marks: [{ type: 'link', attrs: { href: '#missing' } }],
      }],
    }]);
    const inspected = validateDocumentBytes(baselineText);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) expect(inspected.warnings[0].code).toBe('DANGLING_REFERENCE');
    const text = source([heading(1, 'intro', 'Intro'), paragraph('body')]);
    const result = apply(text, [{
      op: 'insertBlock',
      destination: { position: 'after', target: target('intro') },
      block: { type: 'image', attrs: { src: 'C:\\secret.png' } },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('NEW_NONPORTABLE_ASSET');
  });

  it('requires explicit legacy upgrade before applying', () => {
    const text = JSON.stringify({ type: 'doc', content: [paragraph('legacy')] });
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const result = applyOperationRequest(text, {
      contract: 'sdoc.operations/1',
      expected: { revision: inspected.revision },
      operations: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('LEGACY_UPGRADE_REQUIRED');
  });

  it('does not update modified or reserialize bytes for a semantic no-op', () => {
    const text = source([heading(1, 'intro', 'Intro')]);
    const result = apply(text, [
      { op: 'renameHeading', target: target('intro'), title: 'Intro' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.envelope.meta.modified).toBe('2025-01-01T00:00:00.000Z');
    expect(result.outputText).toBe(text);
    expect(result.outputRevision).toBe(result.revision);
  });

  it('rejects duplicate ids before normalization can silently repair them', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      { type: 'image', attrs: { id: 'figure', src: './images/one.png' } },
    ]);
    const result = apply(text, [{
      op: 'insertBlock',
      destination: { position: 'after', target: target('intro') },
      block: { type: 'image', attrs: { id: 'figure', src: './images/two.png' } },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('DUPLICATE_ID');
  });

  it('keeps a stable handle pointing at a replacement for later operations', () => {
    const text = source([heading(1, 'intro', 'Intro'), paragraph('old')]);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const block = inspected.blocks.find((entry) => entry.type === 'paragraph');
    const locator: NodeTarget = {
      kind: 'snapshot', path: block?.path ?? [], nodeType: 'paragraph',
      digest: block?.digest ?? computeRevision(''),
    };
    const result = apply(text, [
      { op: 'replaceBlock', target: locator, block: paragraph('new') },
      { op: 'updateBlockAttrs', target: locator, attrs: { textAlign: 'right' } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.doc.content?.[1]).toMatchObject({
        attrs: { textAlign: 'right' },
        content: [{ text: 'new' }],
      });
    }
  });

  it('compares baseline violations as a multiset and rejects an increased duplicate warning', () => {
    const dangling = {
      type: 'paragraph',
      content: [{
        type: 'text', text: 'missing',
        marks: [{ type: 'link', attrs: { href: '#missing' } }],
      }],
    } satisfies TiptapNode;
    const text = source([heading(1, 'intro', 'Intro'), dangling]);
    const result = apply(text, [{
      op: 'insertBlock',
      destination: { position: 'after', target: target('intro') },
      block: dangling,
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('NEW_DANGLING_REFERENCE');
  });

  it('requires the caller to establish requested document identity', () => {
    const text = source([heading(1, 'intro', 'Intro')]);
    const result = applyOperationRequest(text, {
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(text), documentId: 'doc-1' },
      operations: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('DOCUMENT_ID_UNVERIFIABLE');
  });

  it('uses the injected clock for deterministic legacy upgrades', () => {
    const text = JSON.stringify({ type: 'doc', content: [paragraph('legacy')] });
    const result = applyOperationRequest(text, {
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(text) },
      operations: [],
    }, {
      upgradeLegacy: true,
      clock: () => '2026-07-24T01:02:03.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.envelope.meta.created).toBe('2026-07-24T01:02:03.000Z');
    expect(result.envelope.meta.modified).toBe('2026-07-24T01:02:03.000Z');
  });

  it('moves a list by snapshot and deletes another block in one batch', () => {
    const list: TiptapNode = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph('item')] }],
    };
    const text = source([
      heading(1, 'intro', 'Intro'), paragraph('remove'), list, paragraph('tail'),
    ]);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const locator = (type: string, textValue: string): NodeTarget => {
      const block = inspected.blocks.find(
        (entry) => entry.type === type && entry.summary.includes(textValue),
      );
      return {
        kind: 'snapshot', path: block?.path ?? [], nodeType: type,
        digest: block?.digest ?? computeRevision(''),
      };
    };
    const result = apply(text, [
      {
        op: 'moveBlock', target: locator('bulletList', 'item'),
        destination: { position: 'after', target: locator('paragraph', 'tail') },
      },
      { op: 'deleteBlock', target: locator('paragraph', 'remove') },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.doc.content?.map((node) => node.type))
        .toEqual(['heading', 'paragraph', 'bulletList']);
      expect(result.envelope.doc.content?.[1].content?.[0].text).toBe('tail');
    }
  });

  it('uses canonical node digests independent of attribute key insertion order', () => {
    const one = source([{
      type: 'diagram',
      attrs: { language: 'mermaid', code: 'graph TD' },
    }]);
    const two = source([{
      type: 'diagram',
      attrs: { code: 'graph TD', language: 'mermaid' },
    }]);
    const inspectedOne = inspectDocumentBytes(one);
    const inspectedTwo = inspectDocumentBytes(two);
    expect(inspectedOne.ok).toBe(true);
    expect(inspectedTwo.ok).toBe(true);
    if (!inspectedOne.ok || !inspectedTwo.ok) return;
    expect(inspectedOne.blocks[0].digest).toBe(inspectedTwo.blocks[0].digest);
  });

  it('fails closed before recursive contract parsing for over-deep unknown trees', () => {
    let nested = paragraph('deep');
    for (let depth = 0; depth < 129; depth += 1) {
      nested = { type: 'blockquote', content: [nested] };
    }
    const result = validateDocumentBytes(source([nested]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe('document');
      expect(result.diagnostics[0].code).toBe('TREE_TOO_DEEP');
    }
  });

  it('rejects over-deep operation node trees before recursive narrowing', () => {
    const text = source([heading(1, 'intro', 'Intro')]);
    let nested = paragraph('deep');
    for (let depth = 0; depth < 129; depth += 1) {
      nested = { type: 'blockquote', content: [nested] };
    }
    const result = apply(text, [{
      op: 'insertBlock',
      destination: { position: 'after', target: target('intro') },
      block: nested,
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe('argument');
      expect(result.diagnostics[0].code).toBe('OPERATION_TREE_TOO_DEEP');
    }
  });

  it('strictly rejects malformed UTF-8 before JSON parsing', () => {
    const valid = new TextEncoder().encode(source([heading(1, 'intro', 'Intro')]));
    const quoteIndex = valid.indexOf(0x22);
    const invalid = new Uint8Array(valid.length + 1);
    invalid.set(valid.slice(0, quoteIndex), 0);
    invalid.set([0xc0, 0xa2], quoteIndex);
    invalid.set(valid.slice(quoteIndex + 1), quoteIndex + 2);
    const result = validateDocumentBytes(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('MALFORMED_JSON');
  });

  it('inspects protected locators for every mutable structural node', () => {
    const text = source([{
      type: 'taskList',
      content: [{
        type: 'taskItem',
        attrs: { checked: false },
        content: [paragraph('task')],
      }],
    }, {
      type: 'table',
      attrs: { id: 'table-1' },
      content: [{
        type: 'tableRow',
        content: [
          { type: 'tableHeader', content: [paragraph('head')] },
          { type: 'tableCell', content: [paragraph('cell')] },
        ],
      }],
    }]);
    const result = inspectDocumentBytes(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const type of ['taskItem', 'tableHeader', 'tableCell']) {
      expect(result.blocks.find((block) => block.type === type)?.digest)
        .toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('keeps the #40 payload comparison fixture reproducible', () => {
    const content: TiptapNode[] = [heading(
      1,
      comparison.generator.heading.id,
      comparison.generator.heading.title,
    )];
    for (let index = 1; index <= comparison.generator.paragraphCount; index += 1) {
      content.push(paragraph(
        comparison.generator.paragraphTemplate.replace('{n}', String(index)),
      ));
    }
    const value: SdocEnvelope = {
      sdoc: '1.0',
      meta: { title: 'Benchmark', modified: '2026-07-24T00:00:00.000Z' },
      doc: { type: 'doc', content },
    };
    const text = `${JSON.stringify(value, null, comparison.generator.serialization.indent)}\n`;
    const inspected = inspectDocumentBytes(text, {
      maxBlocks: comparison.measurements.inspectMaxBlocks,
    });
    const request = {
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(text) },
      operations: [comparison.operation],
    };
    expect(computeRevision(text)).toBe(comparison.revision);
    expect(new TextEncoder().encode(text)).toHaveLength(
      comparison.measurements.wholeDocumentInputBytes,
    );
    expect(new TextEncoder().encode(JSON.stringify(inspected))).toHaveLength(
      comparison.measurements.boundedInspectPayloadBytes,
    );
    expect(new TextEncoder().encode(JSON.stringify(request))).toHaveLength(
      comparison.measurements.operationPayloadBytes,
    );
  });
});
