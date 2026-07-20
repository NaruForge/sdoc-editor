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
  });

  it('preserves metadata settings through wrapping', () => {
    const document = createEmptySdoc({
      title: 'Guide',
      author: 'Author',
      settings: { captionStyle: 'korean' },
    });
    const wrapped = wrapSdoc(document.doc, document.meta);
    expect(wrapped.sdoc).toBe('1.0');
    expect(wrapped.meta.title).toBe('Guide');
    expect(wrapped.meta.settings).toEqual({ captionStyle: 'korean' });
    expect(wrapped.doc.content?.[0].type).toBe('heading');
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

  it('preserves reserved IDs and resolves duplicate existing IDs deterministically', () => {
    const doc = assignAutoIds(contract.idAssignment.doc);
    expect(semanticIds(doc)).toEqual(contract.idAssignment.expectedIds);
  });

  it('normalizes IDs and configured reference labels from the shared contract fixture', () => {
    const normalized = normalizeDocument(contract.normalization.doc, contract.normalization.options);

    expect(semanticIds(normalized)).toEqual(contract.normalization.expectedIds);
    expect(referenceTexts(normalized)).toEqual(contract.normalization.expectedReferenceTexts);
  });
});
