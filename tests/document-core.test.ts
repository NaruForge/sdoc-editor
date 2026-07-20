import { describe, expect, it } from 'vitest';
import {
  assignAutoIds,
  createEmptySdoc,
  queryDocumentStructure,
  syncCrossReferences,
  unwrapSdoc,
  wrapSdoc,
} from '../shared/mcp/sdocUtils';
import type { TiptapNode } from '../shared/types';

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
});
