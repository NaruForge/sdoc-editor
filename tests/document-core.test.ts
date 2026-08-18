import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assignAutoIds,
  createEmptySdoc,
  normalizeDocument,
  queryDocumentStructure,
  syncCrossReferences,
  unwrapSdoc,
  wrapSdoc,
} from '../shared/document/sdocUtils';
import type { TiptapNode } from '../shared/types';
import {
  assertPersistedDocument,
  parseDocumentContract,
  parseDocumentTextContract,
  validateDocumentSettings,
} from '../shared/document/documentContract';
import { analyzeLegacyTitleMigration } from '../shared/document/titleMigration';

interface ContractFixture {
  legacyMigration: {
    input: TiptapNode;
    expectedAttrs: Record<string, unknown>;
  };
  idAssignment: {
    doc: TiptapNode;
    expectedIds: string[];
  };
  normalization: {
    options: {
      equationNumbering: 'sequential' | 'hierarchical';
      captionStyle: 'ieee' | 'iso' | 'modern' | 'korean';
      crossRefIncludeCaption: boolean;
    };
    doc: TiptapNode;
    expectedIds: string[];
    expectedReferenceTexts: string[];
  };
  envelope: {
    input: unknown;
  };
}

const contract = JSON.parse(
  readFileSync(new URL('./fixtures/document-contract.json', import.meta.url), 'utf8'),
) as ContractFixture;

const semanticIds = (doc: TiptapNode): string[] =>
  (doc.content ?? [])
    .filter((node) => ['heading', 'image', 'table', 'mathBlock'].includes(node.type))
    .map((node) => String(node.attrs?.id ?? ''));

const referenceTexts = (doc: TiptapNode): string[] => {
  const result: string[] = [];
  const visit = (node: TiptapNode): void => {
    if (node.type === 'text' && node.marks?.some((mark) => mark.type === 'link')) {
      result.push(node.text ?? '');
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return result;
};

const text = (value: string, href?: string): TiptapNode => ({
  type: 'text',
  text: value,
  ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
});

describe('sdoc envelope', () => {
  it('uses precompiled validators without runtime code generation', () => {
    const source = readFileSync(
      new URL('../shared/document/documentContract.ts', import.meta.url),
      'utf8',
    );
    const generated = readFileSync(
      new URL('../shared/document/generated/documentValidators.js', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/import\s+(?!type\b)[^;]+from ['"]ajv['"]/);
    expect(source).toContain("from './generated/documentValidators.js'");
    expect(generated).not.toMatch(/\b(?:eval|Function)\s*\(/);
  });

  it('deduplicates React when shared editor modules are bundled', () => {
    const config = readFileSync(new URL('../webview-ui/vite.config.ts', import.meta.url), 'utf8');
    expect(config).toContain("dedupe: ['react', 'react-dom']");
  });

  it('fails closed for malformed and unsupported future documents', () => {
    const arbitraryRoot = parseDocumentContract({ unexpected: true });
    expect(arbitraryRoot).toMatchObject({ ok: false, kind: 'malformed' });
    expect(arbitraryRoot.ok || arbitraryRoot.diagnostics.length).not.toBe(0);
    expect(parseDocumentContract({
      sdoc: '2.0', meta: {}, doc: { type: 'doc', content: [] },
    })).toMatchObject({ ok: false, kind: 'unsupported-version' });
  });

  it('does not reuse mutable validator errors across malformed documents', () => {
    const invalidEnvelope = parseDocumentContract({
      sdoc: '1.0', meta: {}, doc: { type: 'doc', content: [] }, unexpected: true,
    });
    expect(invalidEnvelope.ok).toBe(false);

    const arbitraryRoot = parseDocumentContract({ unexpected: true });
    expect(arbitraryRoot.ok).toBe(false);
    if (!arbitraryRoot.ok) {
      expect(arbitraryRoot.diagnostics.length).toBeGreaterThan(0);
      expect(arbitraryRoot.diagnostics).not.toEqual(
        invalidEnvelope.ok ? [] : invalidEnvelope.diagnostics,
      );
    }
  });

  it('bounds diagnostics before they cross the host message boundary', () => {
    const malformed = parseDocumentContract({
      sdoc: '1.0',
      doc: {
        type: 'doc',
        content: Array.from({ length: 150 }, () => ({ type: 'paragraph', unexpected: true })),
      },
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.diagnostics.length).toBeGreaterThan(0);
      expect(malformed.diagnostics.length).toBeLessThanOrEqual(100);
      expect(malformed.diagnostics.every((item) => item.path.length <= 1_000)).toBe(true);
      expect(malformed.diagnostics.every((item) => item.message.length <= 2_000)).toBe(true);
    }

    const future = parseDocumentContract({ sdoc: 'x'.repeat(10_000) });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.diagnostics[0].message.length).toBeLessThanOrEqual(2_000);
  });

  it('fails closed without recursive overflow for deeply nested document trees', () => {
    let node: unknown = { type: 'paragraph' };
    for (let depth = 0; depth < 20_000; depth += 1) {
      node = { type: 'blockquote', content: [node] };
    }

    expect(parseDocumentContract({ sdoc: '1.0', meta: {}, doc: node })).toMatchObject({
      ok: false,
      kind: 'malformed',
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('exceeds') })],
    });
  });

  it('parses document text with explicit zero-byte, JSON, and size outcomes', () => {
    const empty = parseDocumentTextContract('');
    expect(empty).toMatchObject({ ok: true, uninitialized: true });

    const invalidJson = parseDocumentTextContract('{');
    expect(invalidJson).toMatchObject({ ok: false, kind: 'invalid-json' });
    if (!invalidJson.ok) expect(invalidJson.diagnostics.length).toBeGreaterThan(0);

    const oversized = parseDocumentTextContract('12345', { maximumBytes: 4 });
    expect(oversized).toMatchObject({ ok: false, kind: 'too-large' });
  });

  it('rejects malformed external document settings without casting', () => {
    expect(validateDocumentSettings({
      captionStyle: 'korean',
      pdfScale: 80,
      headingH1Color: '#111111',
      headingH2Color: '#222222',
      headingH3Color: '#333333',
      headingH4Color: '#444444',
      headingH5Color: '#555555',
      headingH6Color: '#666666',
      headingStartNumber: 0,
    })).toBe(true);
    expect(validateDocumentSettings({ captionStyle: 'unknown' })).toBe(false);
    expect(validateDocumentSettings({ headingNumbering: 'yes' })).toBe(false);
    expect(validateDocumentSettings({ headingStartNumber: -1 })).toBe(false);
    expect(validateDocumentSettings({ headingStartNumber: 0.5 })).toBe(false);
    expect(validateDocumentSettings({ headingH4Color: 'not-a-color' })).toBe(false);
    expect(parseDocumentContract({
      sdoc: '1.0',
      meta: { title: 123, settings: { captionStyle: 'unknown' }, review: { status: 'draft' } },
      doc: { type: 'doc', content: [] },
    })).toMatchObject({ ok: false, kind: 'malformed' });
  });

  it('preserves schema-valid metadata extensions through round-trip', () => {
    const parsed = parseDocumentContract({
      sdoc: '1.0',
      meta: { title: 'Extended', review: { status: 'approved' } },
      doc: { type: 'doc', content: [] },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const wrapped = wrapSdoc(parsed.envelope.doc, parsed.envelope.meta);
    expect(wrapped.meta.review).toEqual({ status: 'approved' });
  });

  it('reports document structure with a zero heading start number', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, id: 'zero' }, content: [text('Zero')] },
        { type: 'heading', attrs: { level: 2, id: 'zero-one' }, content: [text('Zero One')] },
      ],
    };

    expect(queryDocumentStructure(doc, { headingStartNumber: 0 }).headings)
      .toMatchObject([
        { id: 'zero', numbering: '0' },
        { id: 'zero-one', numbering: '0.1' },
      ]);
  });
  it('unwraps legacy documents and recursively migrates data attributes', () => {
    const legacy: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { 'data-caption': 'Architecture', 'data-align': 'center', 'data-width': '80%' },
        },
      ],
    };

    const { meta, doc } = unwrapSdoc(legacy);
    expect(meta).toEqual({});
    expect(doc.content?.[0].attrs).toEqual({
      caption: 'Architecture',
      align: 'center',
      width: '80%',
    });
    const strict = parseDocumentContract(legacy);
    expect(strict.ok && strict.envelope.doc.content?.[0].attrs).toEqual({
      caption: 'Architecture', align: 'center', width: '80%',
    });
  });

  it('keeps meta.title canonical when creating and wrapping an empty document', () => {
    const document = createEmptySdoc({
      title: 'Guide',
      author: 'Author',
      settings: { captionStyle: 'korean' },
    });
    const wrapped = wrapSdoc(document.doc, document.meta);
    expect(wrapped.sdoc).toBe('1.0');
    expect(wrapped.meta.title).toBe('Guide');
    expect(wrapped.meta.settings).toEqual({ captionStyle: 'korean' });
    expect(wrapped.doc.content).toEqual([{ type: 'paragraph' }]);
  });

  it('removes only the exact legacy built-in title heading from the parsed envelope', () => {
    const input = {
      sdoc: '1.0',
      meta: {
        title: 'Legacy report',
        settings: { captionStyle: 'korean' },
        review: { status: 'approved' },
        template: { name: 'Legacy', titleNodeId: 'document-title' },
      },
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, id: 'document-title', numbered: false },
            content: [{ type: 'text', text: 'Legacy report' }],
          },
          { type: 'heading', attrs: { level: 1, id: 'scope' }, content: [text('Scope')] },
          { type: 'paragraph', content: [text('See scope', '#scope')] },
        ],
      },
    };
    const snapshot = structuredClone(input);

    expect(analyzeLegacyTitleMigration(input)).toMatchObject({
      kind: 'auto-remove',
      candidate: { path: [0], id: 'document-title', text: 'Legacy report' },
    });
    const parsed = parseDocumentContract(input);

    expect(input).toEqual(snapshot);
    expect(parsed).toMatchObject({
      ok: true,
      legacy: false,
      titleMigration: { kind: 'auto-remove' },
    });
    if (!parsed.ok) return;
    expect(parsed.envelope.meta).toEqual(input.meta);
    expect(parsed.envelope.doc.content).toEqual(input.doc.content.slice(1));
  });

  it.each([
    {
      name: 'marked title text',
      content: [{
        type: 'heading',
        attrs: { level: 1, id: 'document-title', numbered: false },
        content: [{ type: 'text', text: 'Legacy report', marks: [{ type: 'bold' }] }],
      }],
    },
    {
      name: 'title text mismatch',
      content: [{
        type: 'heading',
        attrs: { level: 1, id: 'document-title', numbered: false },
        content: [{ type: 'text', text: 'Edited heading' }],
      }],
    },
    {
      name: 'numbered heading',
      content: [{
        type: 'heading',
        attrs: { level: 1, id: 'document-title' },
        content: [{ type: 'text', text: 'Legacy report' }],
      }],
    },
    {
      name: 'matching H2',
      content: [{
        type: 'heading',
        attrs: { level: 2, id: 'document-title', numbered: false },
        content: [{ type: 'text', text: 'Legacy report' }],
      }],
    },
    {
      name: 'aligned heading outside the exact historical shape',
      content: [{
        type: 'heading',
        attrs: {
          level: 1, id: 'document-title', numbered: false, textAlign: 'center',
        },
        content: [{ type: 'text', text: 'Legacy report' }],
      }],
    },
    {
      name: 'matching heading after another top-level block',
      content: [
        { type: 'paragraph' },
        {
          type: 'heading',
          attrs: { level: 1, id: 'document-title', numbered: false },
          content: [{ type: 'text', text: 'Legacy report' }],
        },
      ],
    },
    {
      name: 'matching heading nested in a blockquote',
      content: [{
        type: 'blockquote',
        content: [{
          type: 'heading',
          attrs: { level: 1, id: 'document-title', numbered: false },
          content: [{ type: 'text', text: 'Legacy report' }],
        }],
      }],
    },
    {
      name: 'multiple title-like headings',
      content: [
        {
          type: 'heading',
          attrs: { level: 1, id: 'document-title', numbered: false },
          content: [{ type: 'text', text: 'Legacy report' }],
        },
        {
          type: 'heading',
          attrs: { level: 1, id: 'other-title', numbered: false },
          content: [{ type: 'text', text: 'Legacy report' }],
        },
      ],
    },
  ])('leaves an ambiguous legacy title unchanged: $name', ({ content }) => {
    const input = {
      sdoc: '1.0' as const,
      meta: { title: 'Legacy report' },
      doc: { type: 'doc', content },
    };

    expect(analyzeLegacyTitleMigration(input)).toMatchObject({ kind: 'ambiguous' });
    const parsed = parseDocumentContract(input);

    expect(parsed).toMatchObject({
      ok: true,
      titleMigration: { kind: 'ambiguous' },
      envelope: { doc: input.doc },
    });
  });

  it('returns an empty document for malformed input', () => {
    expect(unwrapSdoc({ unexpected: true }).doc).toEqual({ type: 'doc', content: [] });
  });

  it('preserves metadata and settings from the shared contract fixture', () => {
    const { meta, doc } = unwrapSdoc(contract.envelope.input);
    expect(meta).toMatchObject({
      title: 'Contract',
      author: 'Tester',
      version: '2.0',
      settings: { captionStyle: 'korean', equationNumbering: 'hierarchical' },
    });
    expect(doc).toEqual({ type: 'doc', content: [] });
  });

  it('recursively migrates attributes from the shared contract fixture', () => {
    const { doc } = unwrapSdoc(contract.legacyMigration.input);
    expect(doc.content?.[0].content?.[0].attrs).toEqual(contract.legacyMigration.expectedAttrs);
  });
});

describe('document structure', () => {
  it('preserves user-entered trailing spaces in paragraphs and headings', () => {
    const normalized = normalizeDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '테스트 ' }] },
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: '제목 ' }],
        },
      ],
    });

    expect(normalized.content?.[0].content?.[0].text).toBe('테스트 ');
    expect(normalized.content?.[1].content?.[0].text).toBe('제목 ');
    expect(normalized.content?.[1].attrs?.id).toBe('제목');
  });

  it('preserves literal code block whitespace exactly', () => {
    const normalized = normalizeDocument({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'text' }, content: [{ type: 'text', text: '  a\t \n' }] }],
    });
    expect(normalized.content?.[0].content?.[0].text).toBe('  a\t \n');
  });

  it('validates persisted editor marks, rules, images, and equations against the schema', () => {
    const envelope = wrapSdoc(normalizeDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{
          type: 'text', text: 'colored', marks: [
            { type: 'textStyle', attrs: { color: '#123456' } },
            { type: 'highlight', attrs: { color: '#ffff00' } },
          ],
        }] },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { src: './images/nested/a.png', id: 'figure-a', width: '80%' } },
        { type: 'mathBlock', attrs: { latex: 'x=1', id: 'eq-a' } },
      ],
    }), {});
    expect(() => assertPersistedDocument(envelope)).not.toThrow();
  });
  it('assigns stable unique IDs for duplicate headings and numbered blocks', () => {
    const doc = assignAutoIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Overview')] },
        { type: 'heading', attrs: { level: 1 }, content: [text('Overview')] },
        { type: 'image', attrs: { caption: 'System' } },
        { type: 'table', attrs: { caption: 'Ports' } },
        { type: 'mathBlock', attrs: { latex: 'x=1' } },
      ],
    });

    expect(doc.content?.map((node) => node.attrs?.id)).toEqual([
      'overview',
      'overview-2',
      'figure-1',
      'table-1',
      'eq-1',
    ]);
  });

  it('generates schema-valid ids for Korean, numeric-leading, and long headings', () => {
    const normalized = assignAutoIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('개요')] },
        { type: 'heading', attrs: { level: 1 }, content: [text('1. Introduction')] },
        { type: 'heading', attrs: { level: 1 }, content: [text('가'.repeat(200))] },
      ],
    });

    expect(normalized.content?.map((node) => node.attrs?.id)).toEqual([
      '개요',
      '1-introduction',
      '가'.repeat(128),
    ]);
    expect(() => assertPersistedDocument(wrapSdoc(normalized, {}))).not.toThrow();
  });

  it('synchronizes labels and reports missing cross-reference targets', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, id: 'intro' }, content: [text('Introduction')] },
        { type: 'image', attrs: { id: 'system', caption: 'System view' } },
        { type: 'paragraph', content: [text('old label', '#system'), text('missing', '#unknown')] },
      ],
    };

    const synchronized = syncCrossReferences(doc, 'sequential', 'modern', true);
    expect(synchronized.content?.[2].content?.[0].text).toBe('Figure 1: System view');

    const query = queryDocumentStructure(synchronized);
    expect(query.headings[0]).toMatchObject({ id: 'intro', level: 1, numbering: '1' });
    expect(query.crossReferences).toEqual([
      { href: '#system', text: 'Figure 1: System view', targetExists: true },
      { href: '#unknown', text: 'missing', targetExists: false },
    ]);
  });

  it('does not treat a paragraph identity as a cross-reference target', () => {
    const result = queryDocumentStructure({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'paragraph-1' }, content: [text('Tracked')] },
        { type: 'paragraph', content: [text('link', '#paragraph-1')] },
      ],
    });

    expect(result.crossReferences).toEqual([
      { href: '#paragraph-1', text: 'link', targetExists: false },
    ]);
  });

  it('preserves reserved IDs and resolves duplicate existing IDs deterministically', () => {
    const doc = assignAutoIds(contract.idAssignment.doc);
    expect(semanticIds(doc)).toEqual(contract.idAssignment.expectedIds);
  });

  it('normalizes IDs and configured reference labels from the shared contract fixture', () => {
    const normalized = normalizeDocument(contract.normalization.doc, contract.normalization.options);

    expect(semanticIds(normalized)).toEqual(contract.normalization.expectedIds);
    expect(referenceTexts(normalized)).toEqual(contract.normalization.expectedReferenceTexts);
    expect(() => assertPersistedDocument(wrapSdoc(normalized, {}))).not.toThrow();
  });

  it('assigns persistent ids to nested referenceable nodes in document order', () => {
    const doc = assignAutoIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Top')] },
        { type: 'blockquote', content: [{ type: 'image', attrs: { caption: 'Nested' } }] },
        { type: 'table', attrs: { caption: 'Top table' } },
      ],
    });
    expect(doc.content?.[0].attrs?.id).toBe('top');
    expect(doc.content?.[1].content?.[0].attrs?.id).toBe('figure-1');
    expect(doc.content?.[2].attrs?.id).toBe('table-1');
    expect(queryDocumentStructure(doc).figures).toEqual([
      { id: 'figure-1', caption: 'Nested', number: 1 },
    ]);
  });

  it('keeps a heading identity and reference when the heading is renamed', () => {
    const normalized = normalizeDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, id: 'intro' }, content: [text('Overview')] },
        { type: 'paragraph', content: [text('old title', '#intro')] },
      ],
    });

    expect(normalized.content?.[0].attrs?.id).toBe('intro');
    expect(normalized.content?.[1].content?.[0].marks?.[0].attrs?.href).toBe('#intro');
    expect(normalized.content?.[1].content?.[0].text).toBe('1. Overview');
  });

  it('keeps figure and table identities attached to their objects after reorder', () => {
    const normalized = normalizeDocument({
      type: 'doc',
      content: [
        { type: 'table', attrs: { id: 'ports', caption: 'Ports' } },
        { type: 'image', attrs: { id: 'system', caption: 'System' } },
        { type: 'paragraph', content: [text('old figure', '#system'), text('old table', '#ports')] },
      ],
    });

    expect(normalized.content?.[0].attrs).toMatchObject({ id: 'ports', caption: 'Ports' });
    expect(normalized.content?.[1].attrs).toMatchObject({ id: 'system', caption: 'System' });
    expect(normalized.content?.[2].content?.map((node) => node.marks?.[0].attrs?.href)).toEqual([
      '#system', '#ports',
    ]);
    expect(normalized.content?.[2].content?.map((node) => node.text)).toEqual(['Figure 1', 'Table 1']);
  });
});
