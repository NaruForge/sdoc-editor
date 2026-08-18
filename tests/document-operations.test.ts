import { describe, expect, it } from 'vitest';
import type { SdocEnvelope, TiptapNode } from '../shared/types';
import {
  applyOperationRequest, computeRevision, inspectDocumentBytes, projectDocumentBytes,
  validateDocumentBytes,
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
const paragraphWithId = (id: string, value: string): TiptapNode => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text: value }],
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

  it('rejects unknown request, expected, target, destination, and operation fields', () => {
    const text = source([heading(1, 'intro', 'Intro'), paragraph('Body')]);
    const revision = computeRevision(text);
    const requests: unknown[] = [
      {
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [],
        extra: true,
      },
      {
        contract: 'sdoc.operations/1',
        expected: { revision, extra: true },
        operations: [],
      },
      {
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [{
          op: 'renameHeading',
          target: { kind: 'id', id: 'intro', extra: true },
          title: 'Updated',
        }],
      },
      {
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [{
          op: 'moveBlock',
          target: { kind: 'snapshot', path: [1], nodeType: 'paragraph', digest: `sha256:${'0'.repeat(64)}` },
          destination: { position: 'after', target: { kind: 'id', id: 'intro' }, extra: true },
        }],
      },
      {
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [{
          op: 'renameHeading',
          target: { kind: 'id', id: 'intro' },
          title: 'Updated',
          extra: true,
        }],
      },
    ];

    for (const request of requests) {
      const result = applyOperationRequest(text, request);
      expect(result).toMatchObject({ ok: false, category: 'argument' });
    }
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

  it('inserts sibling sections before or after the complete target section', () => {
    const text = source([
      heading(1, 'one', 'One'), paragraph('one body'),
      heading(2, 'one-child', 'One child'), paragraph('child body'),
      heading(1, 'two', 'Two'), paragraph('two body'),
    ]);
    const after = apply(text, [{
      op: 'insertSection', target: target('one'), title: 'After one', id: 'after-one',
      position: 'after', blocks: [paragraph('after body')],
    }]);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.envelope.doc.content?.map((node) => node.attrs?.id).filter(Boolean))
      .toEqual(['one', 'one-child', 'after-one', 'two']);
    expect(after.envelope.doc.content?.find((node) => node.attrs?.id === 'after-one')?.attrs?.level)
      .toBe(1);
    const inspected = inspectDocumentBytes(JSON.stringify(after.envelope));
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.outline.find((entry) => entry.id === 'after-one'))
      .toMatchObject({ level: 1, path: [4] });

    const before = apply(text, [{
      op: 'insertSection', target: target('two'), title: 'Before two', id: 'before-two',
      position: 'before',
    }]);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.envelope.doc.content?.map((node) => node.attrs?.id).filter(Boolean))
      .toEqual(['one', 'one-child', 'before-two', 'two']);
    expect(before.envelope.doc.content?.find((node) => node.attrs?.id === 'before-two')?.attrs?.level)
      .toBe(1);
  });

  it('changes an existing section level while preserving ids and relative descendants', () => {
    const text = source([
      heading(1, 'root', 'Root'),
      heading(2, 'section', 'Section'), paragraph('body'),
      heading(3, 'section-child', 'Child'), paragraph('child body'),
      heading(2, 'next', 'Next'),
    ]);
    const promoted = apply(text, [{
      op: 'setHeadingLevel', target: target('section'), level: 1,
    }]);
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    const inspected = inspectDocumentBytes(JSON.stringify(promoted.envelope));
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.outline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'section', level: 1 }),
      expect.objectContaining({ id: 'section-child', level: 2 }),
    ]));

    const invalidLevel = apply(text, [{
      op: 'setHeadingLevel', target: target('section'), level: 0,
    }]);
    expect(invalidLevel).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'INVALID_HEADING_LEVEL' }],
    });
    const fractionalLevel = apply(text, [{
      op: 'setHeadingLevel', target: target('section'), level: 1.5,
    }]);
    expect(fractionalLevel).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'INVALID_HEADING_LEVEL' }],
    });

    const deep = source([
      heading(5, 'deep', 'Deep'),
      heading(6, 'deep-child', 'Deep child'),
    ]);
    const overflow = apply(deep, [{
      op: 'setHeadingLevel', target: target('deep'), level: 6,
    }]);
    expect(overflow).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'SECTION_LEVEL_OUT_OF_RANGE' }],
    });
  });

  it('renames heading and table ids atomically and rewrites internal hrefs', () => {
    const table: TiptapNode = {
      type: 'table', attrs: { id: 'table-old' },
      content: [{
        type: 'tableRow',
        content: [{ type: 'tableCell', content: [paragraph('cell')] }],
      }],
    };
    const link = (text: string, href: string): TiptapNode => ({
      type: 'paragraph',
      content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
    });
    const text = source([
      heading(1, 'heading-old', 'Heading'), link('heading link', '#heading-old'),
      table, link('table link', '#table-old'),
    ]);
    const result = apply(text, [
      { op: 'renameBlockId', target: target('heading-old'), newId: 'heading-new' },
      { op: 'renameBlockId', target: target('table-old'), newId: 'table-new' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = result.envelope.doc.content ?? [];
    expect(nodes[0].attrs?.id).toBe('heading-new');
    expect(nodes[1].content?.[0]?.marks?.[0]?.attrs?.href).toBe('#heading-new');
    expect(nodes[2].attrs?.id).toBe('table-new');
    expect(nodes[3].content?.[0]?.marks?.[0]?.attrs?.href).toBe('#table-new');
    expect(result.diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'block-id-renamed', before: 'heading-old', after: 'heading-new' }),
      expect.objectContaining({ kind: 'block-id-renamed', before: 'table-old', after: 'table-new' }),
    ]));
  });

  it('enforces Unicode id length and reserved-prefix limits for renamed ids', () => {
    const text = source([
      heading(1, 'first', 'First'),
      heading(1, 'second', 'Second'),
    ]);
    expect(apply(text, [{
      op: 'renameBlockId', target: target('first'), newId: `a${'b'.repeat(127)}`,
    }]).ok).toBe(true);
    for (const newId of ['1-introduction', '개요', '😀'.repeat(128)]) {
      expect(apply(text, [{ op: 'renameBlockId', target: target('first'), newId }]).ok).toBe(true);
    }
    for (const [newId, code] of [
      ['a'.repeat(129), 'INVALID_NEW_ID'],
      ['😀'.repeat(129), 'INVALID_NEW_ID'],
      ['second', 'DUPLICATE_ID'],
      ['provisional:reserved', 'INVALID_NEW_ID'],
    ] as const) {
      const result = apply(text, [{ op: 'renameBlockId', target: target('first'), newId }]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0].code).toBe(code);
    }
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
      expect(result.diff).toContainEqual({
        kind: 'block-attrs-updated',
        before: 'language="ts"',
        after: 'language="javascript"',
      });
    }
    const invalid = apply(text, [{
      op: 'updateBlockAttrs', target: codeTarget, attrs: { id: 'forbidden' },
    }]);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics[0].code).toBe('ATTRIBUTE_NOT_ALLOWED');
  });

  it('summarizes sorted image attribute changes with bounded old/new values and unset markers', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      {
        type: 'image',
        attrs: {
          id: 'figure-1',
          src: './images/diagram.png',
          width: '100%',
        },
      },
    ]);
    const result = apply(text, [{
      op: 'updateBlockAttrs',
      target: target('figure-1'),
      attrs: { width: '75%', alt: 'Architecture overview' },
    }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diff).toContainEqual({
      kind: 'block-attrs-updated',
      before: 'alt=<unset>, width="100%"',
      after: 'alt="Architecture overview", width="75%"',
    });

    const bounded = apply(text, [{
      op: 'updateBlockAttrs',
      target: target('figure-1'),
      attrs: { alt: 'x'.repeat(200) },
    }]);
    expect(bounded.ok).toBe(true);
    if (bounded.ok) {
      const event = bounded.diff.find((entry) => entry.kind === 'block-attrs-updated');
      expect(event?.before).toBe('alt=<unset>');
      expect(event?.after).toMatch(/^alt="x+…$/);
      expect(event?.after?.length).toBeLessThanOrEqual(84);
    }
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

    const unsafeLink = apply(text, [{
      op: 'insertBlock',
      destination: { position: 'after', target: target('intro') },
      block: {
        type: 'paragraph',
        content: [{
          type: 'text', text: 'unsafe',
          marks: [{ type: 'link', attrs: { href: 'vbscript:msgbox(1)' } }],
        }],
      },
    }]);
    expect(unsafeLink.ok).toBe(false);
    if (!unsafeLink.ok) expect(unsafeLink.diagnostics[0].code).toBe('NEW_UNSAFE_LINK');
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

  it('preserves an existing id when replaceBlock replacement omits attrs.id', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      paragraphWithId('para-1', 'Old'),
    ]);
    const result = apply(text, [{
      op: 'replaceBlock',
      target: target('para-1'),
      block: paragraph('New'),
    }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.doc.content?.[1]).toMatchObject({
      type: 'paragraph',
      attrs: { id: 'para-1' },
      content: [{ type: 'text', text: 'New' }],
    });
  });

  it('rejects replaceBlock when the replacement changes an existing id', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      paragraphWithId('para-1', 'Old'),
    ]);
    const result = apply(text, [{
      op: 'replaceBlock',
      target: target('para-1'),
      block: paragraphWithId('para-2', 'New'),
    }]);

    expect(result).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'ID_CHANGE_FORBIDDEN' }],
    });
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

  it('updates the document title alone or synchronizes an explicit plain H1', () => {
    const value = envelope([
      heading(1, 'document-title', 'Old heading'),
      heading(2, 'section', 'Section'),
    ]);
    value.meta.title = 'Old metadata';
    const text = JSON.stringify(value);

    const metadataOnly = apply(text, [{
      op: 'setDocumentTitle',
      title: '  New metadata title  ',
    }]);
    expect(metadataOnly.ok).toBe(true);
    if (!metadataOnly.ok) return;
    expect(metadataOnly.envelope.meta.title).toBe('New metadata title');
    expect(metadataOnly.envelope.doc.content?.[0].content?.[0].text).toBe('Old heading');
    expect(metadataOnly.diff.map(({ kind }) => kind)).toContain('document-title-updated');

    const synchronized = apply(text, [{
      op: 'setDocumentTitle',
      title: '  Synchronized title  ',
      headingTarget: target('document-title'),
    }]);
    expect(synchronized.ok).toBe(true);
    if (!synchronized.ok) return;
    expect(synchronized.envelope.meta.title).toBe('Synchronized title');
    expect(synchronized.envelope.doc.content?.[0]).toMatchObject({
      attrs: { id: 'document-title', level: 1 },
      content: [{ type: 'text', text: 'Synchronized title' }],
    });
  });

  it('requires a plain H1 for title synchronization unless formatting discard is explicit', () => {
    const value = envelope([
      {
        type: 'heading',
        attrs: { level: 1, id: 'document-title' },
        content: [{ type: 'text', text: 'Rich title', marks: [{ type: 'bold' }] }],
      },
      heading(2, 'section', 'Section'),
    ]);
    value.meta.title = 'Original title';
    const text = JSON.stringify(value);

    const formatted = apply(text, [{
      op: 'setDocumentTitle',
      title: 'Replacement',
      headingTarget: target('document-title'),
    }]);
    expect(formatted).toMatchObject({
      ok: false,
      category: 'conflict',
      diagnostics: [{ code: 'FORMATTED_HEADING', operationIndex: 0 }],
    });

    const discarded = apply(text, [{
      op: 'setDocumentTitle',
      title: 'Replacement',
      headingTarget: target('document-title'),
      discardFormatting: true,
    }]);
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.envelope.doc.content?.[0].content).toEqual([
      { type: 'text', text: 'Replacement' },
    ]);

    const h2 = apply(text, [{
      op: 'setDocumentTitle',
      title: 'Replacement',
      headingTarget: target('section'),
    }]);
    expect(h2).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'TITLE_H1_TARGET_REQUIRED', operationIndex: 0 }],
    });
  });

  it('validates title and metadata patches and protects all other metadata', () => {
    const value = envelope([heading(1, 'title', 'Title')]);
    Object.assign(value.meta, {
      title: 'Protected title',
      author: 'Old author',
      version: '1.0',
      created: '2024-01-01T00:00:00.000Z',
      template: { name: 'Protected template' },
      review: { status: 'draft' },
    });
    const text = JSON.stringify(value);

    for (const operation of [
      { op: 'setDocumentTitle', title: ' \r\n ' },
      { op: 'setDocumentTitle', title: 'x'.repeat(201) },
      { op: 'updateDocumentMetadata', patch: {} },
      { op: 'updateDocumentMetadata', patch: { author: 'x'.repeat(201) } },
      { op: 'updateDocumentMetadata', patch: { created: null } },
    ]) {
      const result = applyOperationRequest(text, {
        contract: 'sdoc.operations/1',
        expected: { revision: computeRevision(text) },
        operations: [operation],
      });
      expect(result).toMatchObject({ ok: false, category: 'argument' });
    }

    const result = apply(text, [{
      op: 'updateDocumentMetadata',
      patch: { author: null, version: '2.0' },
    }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.meta).not.toHaveProperty('author');
    expect(result.envelope.meta.version).toBe('2.0');
    expect(result.envelope.meta).toMatchObject({
      title: 'Protected title',
      created: '2024-01-01T00:00:00.000Z',
      documentId: 'doc-1',
      template: { name: 'Protected template' },
      review: { status: 'draft' },
    });
    expect(result.diff.map(({ kind }) => kind)).toContain('document-metadata-updated');
  });

  it('uses JSON Schema code-point length semantics for document text metadata', () => {
    const text = source([heading(1, 'document-title', 'Title')]);
    const boundary = '😀'.repeat(200);
    const accepted = apply(text, [
      {
        op: 'setDocumentTitle',
        title: boundary,
        headingTarget: target('document-title'),
      },
      {
        op: 'updateDocumentMetadata',
        patch: { author: boundary, version: boundary },
      },
    ]);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.envelope.meta.title).toBe(boundary);
    expect(accepted.envelope.meta.author).toBe(boundary);
    expect(accepted.envelope.meta.version).toBe(boundary);

    for (const operation of [
      { op: 'setDocumentTitle', title: `${boundary}😀` },
      { op: 'setDocumentTitle', title: ` ${'x'.repeat(200)}` },
      { op: 'updateDocumentMetadata', patch: { author: `${boundary}😀` } },
      { op: 'updateDocumentMetadata', patch: { version: `${boundary}😀` } },
    ]) {
      const rejected = applyOperationRequest(text, {
        contract: 'sdoc.operations/1',
        expected: { revision: computeRevision(text) },
        operations: [operation],
      });
      expect(rejected).toMatchObject({ ok: false, category: 'argument' });
    }
  });

  it('merge-patches only portable document settings and removes an empty override object', () => {
    const text = source([heading(1, 'title', 'Title')]);
    const updated = apply(text, [{
      op: 'updateDocumentSettings',
      patch: { captionStyle: null, pdfScale: 85 },
    }]);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.envelope.meta.settings).toEqual({
      headingNumbering: true,
      pdfScale: 85,
    });
    expect(updated.diff.map(({ kind }) => kind)).toContain('document-settings-updated');

    const removed = apply(text, [{
      op: 'updateDocumentSettings',
      patch: { captionStyle: null, headingNumbering: null },
    }]);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.envelope.meta).not.toHaveProperty('settings');

    for (const patch of [
      {},
      { slideCssPath: './theme.css' },
      { htmlCssPath: null },
      { outputDir: './output' },
      { unknownSetting: true },
      { captionStyle: 'invalid' },
      { headingNumbering: 'yes' },
    ]) {
      const result = applyOperationRequest(text, {
        contract: 'sdoc.operations/1',
        expected: { revision: computeRevision(text) },
        operations: [{ op: 'updateDocumentSettings', patch }],
      });
      expect(result).toMatchObject({ ok: false, category: 'argument' });
    }
  });

  it('persists a zero heading start number and reports the applied normalization policy', () => {
    const text = source([heading(1, 'title', 'Title')]);
    const updated = apply(text, [{
      op: 'updateDocumentSettings',
      patch: { headingStartNumber: 0 },
    }]);

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.envelope.meta.settings?.headingStartNumber).toBe(0);
    expect(updated.normalizationPolicy.headingStartNumber).toBe(0);
    expect(updated.diff).toContainEqual(expect.objectContaining({
      kind: 'numbering-updated',
      before: 'title=1',
      after: 'title=0',
    }));

    for (const headingStartNumber of [-1, 0.5]) {
      const rejected = applyOperationRequest(text, {
        contract: 'sdoc.operations/1',
        expected: { revision: computeRevision(text) },
        operations: [{ op: 'updateDocumentSettings', patch: { headingStartNumber } }],
      });
      expect(rejected).toMatchObject({ ok: false, category: 'argument' });
    }
  });

  it('preserves exact bytes and modified time for document-level semantic no-ops', () => {
    const value = envelope([heading(1, 'document-title', 'Same title')]);
    Object.assign(value.meta, { title: 'Same title', author: 'Same author' });
    const text = JSON.stringify(value, null, 4);
    const result = apply(text, [
      {
        op: 'setDocumentTitle',
        title: 'Same title',
        headingTarget: target('document-title'),
      },
      { op: 'updateDocumentMetadata', patch: { author: 'Same author' } },
      { op: 'updateDocumentSettings', patch: { captionStyle: 'korean' } },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.outputText).toBe(text);
    expect(result.outputRevision).toBe(computeRevision(text));
    expect(result.envelope.meta.modified).toBe('2025-01-01T00:00:00.000Z');
    expect(result.diff).toEqual([]);
  });

  it('pre-resolves title heading targets and keeps stale and legacy guards unchanged', () => {
    const text = source([heading(1, 'root', 'Root')]);
    const createdWithinBatch = apply(text, [
      { op: 'insertSection', target: target('root'), title: 'Created', id: 'created' },
      {
        op: 'setDocumentTitle',
        title: 'New title',
        headingTarget: target('created'),
      },
    ]);
    expect(createdWithinBatch).toMatchObject({
      ok: false,
      category: 'conflict',
      diagnostics: [{ code: 'TARGET_NOT_FOUND' }],
    });

    const stale = applyOperationRequest(text, {
      contract: 'sdoc.operations/1',
      expected: { revision: `sha256:${'0'.repeat(64)}` },
      operations: [{ op: 'setDocumentTitle', title: 'New title' }],
    });
    expect(stale).toMatchObject({
      ok: false,
      category: 'conflict',
      diagnostics: [{ code: 'STALE_REVISION' }],
    });

    const legacy = JSON.stringify({ type: 'doc', content: [heading(1, 'root', 'Root')] });
    const legacyResult = applyOperationRequest(legacy, {
      contract: 'sdoc.operations/1',
      expected: { revision: computeRevision(legacy) },
      operations: [{ op: 'setDocumentTitle', title: 'New title' }],
    });
    expect(legacyResult).toMatchObject({
      ok: false,
      category: 'document',
      diagnostics: [{ code: 'LEGACY_UPGRADE_REQUIRED' }],
    });
  });

  it('inspects known metadata, canonical operation targets, truncation, and target paths', () => {
    const value = envelope([
      heading(1, 'persistent-heading', 'Heading'),
      paragraph('Body'),
      { type: 'image', attrs: { src: 'data:image/png;base64,AA==' } },
    ]);
    Object.assign(value.meta, {
      title: 'Document title',
      author: 'Author',
      version: '3.1',
      created: '2024-01-01T00:00:00.000Z',
      privateMetadata: 'must not be inspected',
    });
    const text = JSON.stringify(value);
    const inspected = inspectDocumentBytes(text, { maxBlocks: 2, targetPath: [1] });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;

    expect(inspected.metadata).toEqual({
      title: 'Document title',
      author: 'Author',
      version: '3.1',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      settings: { captionStyle: 'korean', headingNumbering: true },
    });
    expect(inspected.blockCount).toBe(3);
    expect(inspected.blocksTruncated).toBe(true);
    expect(inspected.blocks[0].operationTarget).toEqual({
      kind: 'id',
      id: 'persistent-heading',
      expectedType: 'heading',
    });
    expect(inspected.blocks[1].operationTarget).toMatchObject({
      kind: 'snapshot',
      path: [1],
      nodeType: 'paragraph',
    });
    expect(inspected.target).toMatchObject({
      path: [1],
      operationTarget: {
        kind: 'snapshot',
        path: [1],
        nodeType: 'paragraph',
      },
    });

    const all = inspectDocumentBytes(text);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.blocks[2]).toMatchObject({
      type: 'image',
      operationTarget: {
        kind: 'id',
        id: expect.stringMatching(/^provisional:/),
        expectedType: 'image',
      },
    });

    expect(inspectDocumentBytes(text, { targetPath: [99] })).toMatchObject({
      ok: false,
      category: 'conflict',
      diagnostics: [{ code: 'TARGET_NOT_FOUND' }],
    });
    expect(inspectDocumentBytes(text, { targetPath: [1, 0] })).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'TARGET_NOT_BLOCK' }],
    });
    expect(inspectDocumentBytes(text, {
      target: target('persistent-heading'),
      targetPath: [0],
    })).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{ code: 'INVALID_INSPECT_OPTIONS' }],
    });
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

describe('sdoc.read/1 projections', () => {
  const catalogRequest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    contract: 'sdoc.read/1',
    projection: 'catalog',
    ...overrides,
  });
  const documentRequest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    contract: 'sdoc.read/1',
    projection: 'document',
    ...overrides,
  });
  const collectContent = (text: string, request: Record<string, unknown>): TiptapNode[] => {
    const content: TiptapNode[] = [];
    let cursor: string | undefined;
    do {
      const result = projectDocumentBytes(text, { ...request, ...(cursor ? { cursor } : {}) });
      expect(result.ok).toBe(true);
      if (!result.ok || (result.projection !== 'document' && result.projection !== 'section')) break;
      content.push(...result.data.content);
      cursor = result.page.nextCursor;
    } while (cursor);
    return content;
  };

  it('leaves the legacy inspect result shape and targeted output unchanged', () => {
    const text = source([heading(1, 'intro', 'Intro'), paragraph('Body')]);
    const before = inspectDocumentBytes(text, { targetPath: [1], maxBlocks: 1 });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(Object.keys(before).sort()).toEqual([
      'blockCount', 'blocks', 'blocksTruncated', 'documentId', 'legacy', 'metadata',
      'needsIdNormalization', 'ok', 'outline', 'referenceables', 'references', 'revision',
      'target', 'warnings',
    ]);
    expect(before.target).toMatchObject({
      path: [1],
      node: paragraph('Body'),
      operationTarget: { kind: 'snapshot', path: [1], nodeType: 'paragraph' },
    });
    expect(before).not.toHaveProperty('contract');
    expect(before).not.toHaveProperty('projection');
  });

  it('validates the exact projection request unions and numeric bounds', () => {
    const text = source([heading(1, 'intro', 'Intro'), paragraph('Body')]);
    const invalid: unknown[] = [
      catalogRequest({ extra: true }),
      catalogRequest({ limit: 0 }),
      catalogRequest({ limit: 10_001 }),
      catalogRequest({ maxBytes: 0 }),
      catalogRequest({ maxBytes: 32 * 1024 * 1024 + 1 }),
      catalogRequest({ maxSummaryLength: 19 }),
      catalogRequest({ maxSummaryLength: 501 }),
      { contract: 'sdoc.read/1', projection: 'target', targetPath: [1], cursor: 'nope' },
      { contract: 'sdoc.read/1', projection: 'target', maxBytes: 256, maxNodes: 2 },
      {
        contract: 'sdoc.read/1', projection: 'target', target: target('intro'),
        targetPath: [0],
      },
      { contract: 'sdoc.read/1', projection: 'section', targetPath: [0], maxNodes: 0 },
      { contract: 'sdoc.read/1', projection: 'document', maxNodes: 100_001 },
      {
        contract: 'sdoc.read/1', projection: 'target',
        targetPath: Array.from({ length: 129 }, () => 0),
      },
      {
        contract: 'sdoc.read/1', projection: 'target',
        targetPath: [Number.MAX_SAFE_INTEGER + 1],
      },
      {
        contract: 'sdoc.read/1', projection: 'target',
        target: {
          kind: 'snapshot',
          path: Array.from({ length: 129 }, () => 0),
          nodeType: 'paragraph',
          digest: `sha256:${'0'.repeat(64)}`,
        },
      },
      { contract: 'sdoc.read/1', projection: 'unknown' },
    ];
    for (const request of invalid) {
      expect(projectDocumentBytes(text, request)).toMatchObject({
        ok: false,
        category: 'argument',
        diagnostics: [{ code: 'INVALID_READ_REQUEST' }],
      });
    }
  });

  it('returns only the selected catalog and measures exact UTF-8 projection bytes', () => {
    const text = source([
      heading(1, 'intro', '한글 소개'),
      paragraph('가나다라마바사아자차카타파하'),
      paragraph('두 번째 본문'),
    ]);
    const result = projectDocumentBytes(text, catalogRequest({
      kind: 'blocks',
      limit: 10,
      maxBytes: 240,
      maxSummaryLength: 20,
    }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.projection !== 'catalog') return;
    expect(result.contract).toBe('sdoc.read/1');
    expect(result.revision).toBe(computeRevision(text));
    expect(result.documentId).toBe('doc-1');
    expect(result.data.kind).toBe('blocks');
    expect(result.data.items.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('outline');
    expect(result).not.toHaveProperty('references');
    expect(result).not.toHaveProperty('referenceables');
    expect(result.budget.bytes).toEqual({
      used: new TextEncoder().encode(JSON.stringify(result.data)).byteLength,
      max: 240,
    });
    expect(result.budget).not.toHaveProperty('nodes');
    expect(result.page.returned).toBe(result.data.items.length);
    expect(result.page.complete).toBe(false);
    expect(result.page.truncatedBy).toBe('maxBytes');
    expect(result.page.nextCursor).toEqual(expect.any(String));
  });

  it('traverses a 10,000-block catalog deterministically without gaps or duplicates', () => {
    const blocks = Array.from({ length: 10_000 }, (_, index) => paragraph(`block-${index}`));
    const text = source(blocks);
    const traverse = (): string[] => {
      const summaries: string[] = [];
      let cursor: string | undefined;
      do {
        const result = projectDocumentBytes(text, catalogRequest({
          kind: 'blocks', limit: 257, ...(cursor ? { cursor } : {}),
        }));
        expect(result.ok).toBe(true);
        if (!result.ok || result.projection !== 'catalog') break;
        summaries.push(...result.data.items.map((item) => item.summary));
        cursor = result.page.nextCursor;
      } while (cursor);
      return summaries;
    };
    const first = traverse();
    const second = traverse();
    expect(first).toHaveLength(10_000);
    expect(new Set(first).size).toBe(10_000);
    expect(first).toEqual(blocks.map((_, index) => `paragraph: block-${index}`));
    expect(second).toEqual(first);
  }, 30_000);

  it.each([0, 1, 1_000, 1_001])(
    'traverses the complete %i-block catalog size boundary',
    (blockCount) => {
      const blocks = Array.from(
        { length: blockCount },
        (_, index) => paragraph(`boundary-${index}`),
      );
      const text = source(blocks);
      const paths: number[] = [];
      let cursor: string | undefined;
      do {
        const result = projectDocumentBytes(text, catalogRequest({
          kind: 'blocks', limit: 257, ...(cursor ? { cursor } : {}),
        }));
        expect(result.ok).toBe(true);
        if (!result.ok || result.projection !== 'catalog') break;
        paths.push(...result.data.items.map((item) => item.path[0]));
        cursor = result.page.nextCursor;
      } while (cursor);
      expect(paths).toEqual(Array.from({ length: blockCount }, (_, index) => index));
      expect(new Set(paths).size).toBe(blockCount);
    },
  );

  it('rejects corrupt, oversized, stale, and projection-scoped cursors', () => {
    const text = source([paragraph('A'), paragraph('B'), paragraph('C')]);
    const first = projectDocumentBytes(text, catalogRequest({ limit: 1 }));
    expect(first.ok).toBe(true);
    if (!first.ok || first.projection !== 'catalog' || !first.page.nextCursor) return;
    const cursor = first.page.nextCursor;
    const final = cursor.at(-1) === 'a' ? 'b' : 'a';

    expect(projectDocumentBytes(text, catalogRequest({
      limit: 1,
      cursor: `${cursor.slice(0, -1)}${final}`,
    }))).toMatchObject({
      ok: false, category: 'argument', diagnostics: [{ code: 'INVALID_READ_CURSOR' }],
    });
    expect(projectDocumentBytes(text, catalogRequest({ cursor: 'x'.repeat(4_097) })))
      .toMatchObject({
        ok: false, category: 'argument', diagnostics: [{ code: 'INVALID_READ_CURSOR' }],
      });
    expect(projectDocumentBytes(text, catalogRequest({ kind: 'outline', cursor })))
      .toMatchObject({
        ok: false, category: 'argument',
        diagnostics: [{ code: 'READ_CURSOR_SCOPE_MISMATCH' }],
      });
    expect(projectDocumentBytes(text, documentRequest({ cursor }))).toMatchObject({
      ok: false, category: 'argument',
      diagnostics: [{ code: 'READ_CURSOR_SCOPE_MISMATCH' }],
    });

    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    expect(projectDocumentBytes(bom, catalogRequest({ cursor }))).toMatchObject({
      ok: false, category: 'conflict', diagnostics: [{ code: 'STALE_READ_CURSOR' }],
    });
    const representedDifferently = JSON.stringify(JSON.parse(text), null, 2);
    expect(projectDocumentBytes(representedDifferently, catalogRequest({ cursor })))
      .toMatchObject({
        ok: false, category: 'conflict', diagnostics: [{ code: 'STALE_READ_CURSOR' }],
      });
    expect(projectDocumentBytes(text, catalogRequest({
      expectedRevision: `sha256:${'0'.repeat(64)}`,
    }))).toMatchObject({
      ok: false, category: 'conflict', diagnostics: [{ code: 'STALE_REVISION' }],
    });
  });

  it('returns one complete target without unrelated catalogs and reports target budgets', () => {
    const text = source([heading(1, 'intro', 'Intro'), paragraph('대상 본문')]);
    const result = projectDocumentBytes(text, {
      contract: 'sdoc.read/1',
      projection: 'target',
      targetPath: [1],
      maxBytes: 1_024,
      maxNodes: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.projection !== 'target') return;
    expect(result.data).toMatchObject({
      path: [1],
      node: paragraph('대상 본문'),
      operationTarget: { kind: 'snapshot', path: [1], nodeType: 'paragraph' },
    });
    expect(result.page).toEqual({ returned: 1, complete: true });
    expect(result.budget.bytes.used).toBe(
      new TextEncoder().encode(JSON.stringify(result.data)).byteLength,
    );
    expect(result.budget.nodes).toEqual({ used: 2, max: 2 });
    expect(result).not.toHaveProperty('blocks');
    expect(result).not.toHaveProperty('outline');

    const tooLarge = projectDocumentBytes(text, {
      contract: 'sdoc.read/1', projection: 'target', targetPath: [1],
      maxBytes: 64, maxNodes: 1,
    });
    expect(tooLarge).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{
        code: 'PROJECTION_ITEM_TOO_LARGE',
        requiredBytes: expect.any(Number),
        requiredNodes: 2,
      }],
    });
  });

  it('uses the existing same-parent heading range for section projections', () => {
    const nested = {
      type: 'blockquote',
      content: [
        heading(2, 'nested-a', 'Nested A'),
        paragraph('Nested body'),
        heading(2, 'nested-b', 'Nested B'),
      ],
    } satisfies TiptapNode;
    const content = [
      heading(1, 'a', 'A'), paragraph('A body'), heading(2, 'a-child', 'A child'),
      paragraph('Child body'), heading(1, 'b', 'B'), nested, paragraph('Tail'),
    ];
    const text = source(content);
    const top = collectContent(text, {
      contract: 'sdoc.read/1', projection: 'section', target: target('a'),
      maxBytes: 32 * 1024, maxNodes: 5,
    });
    expect(top).toEqual(content.slice(0, 4));

    const nestedSection = collectContent(text, {
      contract: 'sdoc.read/1', projection: 'section', target: target('nested-a'),
      maxBytes: 32 * 1024, maxNodes: 4,
    });
    expect(nestedSection).toEqual(nested.content?.slice(0, 2));
  });

  it('concatenates document pages exactly and never splits top-level subtrees', () => {
    const nested: TiptapNode = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph('one')] },
        { type: 'listItem', content: [paragraph('two')] },
      ],
    };
    const content = [paragraph('before'), nested, paragraph('after')];
    const text = source(content);
    const first = projectDocumentBytes(text, documentRequest({
      maxBytes: 32 * 1024,
      maxNodes: 2,
    }));
    expect(first.ok).toBe(true);
    if (!first.ok || first.projection !== 'document') return;
    expect(first.data.content).toEqual([content[0]]);
    expect(first.page).toMatchObject({
      returned: 1, complete: false, truncatedBy: 'maxNodes',
      nextCursor: expect.any(String),
    });

    const blocked = projectDocumentBytes(text, documentRequest({
      cursor: first.page.nextCursor,
      maxBytes: 32 * 1024,
      maxNodes: 2,
    }));
    expect(blocked).toMatchObject({
      ok: false,
      category: 'argument',
      diagnostics: [{
        code: 'PROJECTION_ITEM_TOO_LARGE',
        requiredNodes: 7,
      }],
    });

    const all = collectContent(text, documentRequest({
      maxBytes: 32 * 1024,
      maxNodes: 7,
    }));
    expect(all).toEqual(content);
  });

  it('fails without a progress cursor when the first subtree exceeds a page budget', () => {
    const oversized: TiptapNode = {
      type: 'blockquote',
      content: Array.from({ length: 5 }, (_, index) => paragraph(`nested-${index}`)),
    };
    const text = source([oversized, paragraph('later')]);
    const request = documentRequest({ maxBytes: 32 * 1024, maxNodes: 5 });
    const first = projectDocumentBytes(text, request);
    const second = projectDocumentBytes(text, request);
    for (const result of [first, second]) {
      expect(result).toMatchObject({
        ok: false,
        category: 'argument',
        diagnostics: [{
          code: 'PROJECTION_ITEM_TOO_LARGE',
          requiredNodes: 11,
        }],
      });
      expect(result).not.toHaveProperty('page.nextCursor');
    }
  });
});

describe('optional stable block ids', () => {
  it('accepts optional ids without auto-inserting ids on plain paragraphs', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      paragraph('Body'),
      paragraphWithId('para-1', 'Tracked'),
    ]);
    const validated = validateDocumentBytes(text);
    expect(validated.ok).toBe(true);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const tracked = inspected.blocks.find((block) => block.id === 'para-1');
    expect(tracked?.operationTarget).toMatchObject({ kind: 'id', id: 'para-1', expectedType: 'paragraph' });
    // plain paragraph remains snapshot-targeted and has no id
    const plainBlock = inspected.blocks.find((block) => block.type === 'paragraph' && !block.id);
    expect(plainBlock?.operationTarget.kind).toBe('snapshot');
    expect(inspected.referenceables.every((item) => item.type !== 'paragraph')).toBe(true);
    expect((JSON.parse(text) as SdocEnvelope).doc.content?.[1]).toEqual(paragraph('Body'));
  });

  it('validates optional ids on code blocks, callouts, diagrams, and lists', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      {
        type: 'codeBlock',
        attrs: { id: 'code-1', language: 'ts' },
        content: [{ type: 'text', text: 'const answer = 42;' }],
      },
      {
        type: 'callout',
        attrs: { id: 'callout-1', variant: 'note' },
        content: [paragraph('A note')],
      },
      {
        type: 'diagram',
        attrs: { id: 'diagram-1', language: 'mermaid', code: 'graph TD; A-->B' },
      },
      {
        type: 'bulletList',
        attrs: { id: 'list-1' },
        content: [{ type: 'listItem', attrs: { id: 'item-1' }, content: [paragraph('An item')] }],
      },
      {
        type: 'orderedList',
        attrs: { id: 'ordered-list-1', start: 1 },
        content: [{ type: 'listItem', content: [paragraph('First item')] }],
      },
    ]);
    const validated = validateDocumentBytes(text);
    expect(validated.ok).toBe(true);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'codeBlock', id: 'code-1',
        operationTarget: { kind: 'id', id: 'code-1', expectedType: 'codeBlock' },
      }),
      expect.objectContaining({
        type: 'callout', id: 'callout-1',
        operationTarget: { kind: 'id', id: 'callout-1', expectedType: 'callout' },
      }),
      expect.objectContaining({
        type: 'diagram', id: 'diagram-1',
        operationTarget: { kind: 'id', id: 'diagram-1', expectedType: 'diagram' },
      }),
      expect.objectContaining({
        type: 'bulletList', id: 'list-1',
        operationTarget: { kind: 'id', id: 'list-1', expectedType: 'bulletList' },
      }),
      expect.objectContaining({
        type: 'orderedList', id: 'ordered-list-1',
        operationTarget: { kind: 'id', id: 'ordered-list-1', expectedType: 'orderedList' },
      }),
      expect.objectContaining({
        type: 'listItem', id: 'item-1',
        operationTarget: { kind: 'id', id: 'item-1', expectedType: 'listItem' },
      }),
    ]));
  });

  it('applies the authored-id contract to inserted sections', () => {
    const text = source([heading(1, 'root', 'Root')]);
    expect(apply(text, [{
      op: 'insertSection', target: target('root'), title: '개요', id: '1-개요',
    }]).ok).toBe(true);
    for (const id of ['😀'.repeat(129), 'provisional:reserved']) {
      const result = apply(text, [{
        op: 'insertSection', target: target('root'), title: 'Invalid', id,
      }]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0].code).toBe('INVALID_NEW_ID');
    }
  });

  it('keeps paragraph ids out of the referenceables catalog', () => {
    const table: TiptapNode = {
      type: 'table',
      attrs: { id: 'table-1' },
      content: [{
        type: 'tableRow',
        content: [{ type: 'tableCell', content: [paragraph('Cell')] }],
      }],
    };
    const text = source([
      heading(1, 'intro', 'Intro'),
      { type: 'image', attrs: { id: 'figure-1', src: './figure.png' } },
      table,
      { type: 'mathBlock', attrs: { id: 'equation-1', latex: 'x = 1' } },
      paragraphWithId('para-1', 'Body'),
    ]);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.referenceables.map((item) => item.type)).toEqual([
      'heading', 'image', 'table', 'mathBlock',
    ]);
    expect(inspected.referenceables).not.toContainEqual(
      expect.objectContaining({ id: 'para-1' }),
    );
  });

  it('preserves legacy referenceable ids while bounding new optional stable ids', () => {
    for (const legacyId of ['1-introduction', '개요', 'legacy id 😀', 'x'.repeat(129), 'provisional:legacy']) {
      expect(validateDocumentBytes(source([heading(1, legacyId, 'Legacy')])).ok).toBe(true);
    }

    expect(validateDocumentBytes(source([paragraph('Untracked')])).ok).toBe(true);
    for (const stableId of ['1-introduction', '개요', '😀', 'x'.repeat(128)]) {
      expect(validateDocumentBytes(source([paragraphWithId(stableId, 'Tracked')])).ok).toBe(true);
    }

    for (const stableId of [null, '', 'x'.repeat(129), 'provisional:x']) {
      const invalid = validateDocumentBytes(source([{
        type: 'paragraph',
        attrs: { id: stableId },
        content: [{ type: 'text', text: 'Bad' }],
      }]));
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.diagnostics[0].code).toBe('INVALID_ID');
    }

    const duplicate = validateDocumentBytes(source([
      heading(1, 'same', 'Intro'),
      paragraphWithId('same', 'Body'),
    ]));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0].code).toBe('DUPLICATE_ID');
  });

  it('keeps paragraph ids addressable without satisfying internal references', () => {
    const text = source([
      paragraphWithId('paragraph-1', 'Tracked'),
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'See tracked paragraph',
          marks: [{ type: 'link', attrs: { href: '#paragraph-1' } }],
        }],
      },
    ]);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;

    expect(inspected.blocks[0].operationTarget).toMatchObject({
      kind: 'id', id: 'paragraph-1', expectedType: 'paragraph',
    });
    expect(inspected.references).toContainEqual(expect.objectContaining({
      href: '#paragraph-1', targetExists: false,
    }));
    expect(inspected.warnings).toContainEqual(expect.objectContaining({
      code: 'DANGLING_REFERENCE',
    }));
  });

  it('reserves historical horizontal-rule ids for collisions without exposing them as targets', () => {
    const unique = inspectDocumentBytes(source([
      { type: 'horizontalRule', attrs: { id: 'rule-id' } },
      {
        type: 'paragraph',
        content: [{
          type: 'text', text: 'rule', marks: [{ type: 'link', attrs: { href: '#rule-id' } }],
        }],
      },
    ]));
    expect(unique.ok).toBe(true);
    if (unique.ok) {
      const rule = unique.blocks.find((block) => block.type === 'horizontalRule');
      expect(rule?.operationTarget.kind).toBe('snapshot');
      expect(rule).not.toHaveProperty('id');
      expect(unique.references).toContainEqual(expect.objectContaining({
        href: '#rule-id', targetExists: false,
      }));
    }

    const duplicate = validateDocumentBytes(source([
      { type: 'horizontalRule', attrs: { id: 'rule-id' } },
      paragraphWithId('rule-id', 'Duplicate'),
    ]));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0].code).toBe('DUPLICATE_ID');
  });

  it('preserves paragraph ids across replaceBlock and moveBlock', () => {
    const text = source([
      heading(1, 'intro', 'Intro'),
      paragraphWithId('para-1', 'One'),
      paragraph('Two'),
    ]);
    const inspected = inspectDocumentBytes(text);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const paraTarget = inspected.blocks.find((block) => block.id === 'para-1')?.operationTarget;
    const twoTarget = inspected.blocks.find((block) => block.type === 'paragraph' && !block.id)?.operationTarget;
    expect(paraTarget?.kind).toBe('id');
    expect(twoTarget?.kind).toBe('snapshot');
    if (!paraTarget || !twoTarget) return;

    const replaced = apply(text, [{
      op: 'replaceBlock',
      target: paraTarget,
      block: paragraph('Updated'),
    }]);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.envelope.doc.content?.[1]).toMatchObject({
      type: 'paragraph',
      attrs: { id: 'para-1' },
    });

    const moved = apply(text, [{
      op: 'moveBlock',
      target: paraTarget,
      destination: { position: 'after', target: twoTarget },
    }]);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const nodes = moved.envelope.doc.content ?? [];
    expect(nodes[2]).toMatchObject({ type: 'paragraph', attrs: { id: 'para-1' } });
  });
});
