import { describe, expect, it } from 'vitest';
import { buildNumberingIndex } from '../shared/document/numbering';
import type { TiptapNode } from '../shared/types';

const fixture: TiptapNode = {
  type: 'doc',
  content: [
    { type: 'image', attrs: { id: 'pre-figure', src: './images/pre.png' } },
    { type: 'mathBlock', attrs: { id: 'pre-equation', latex: 'x=0' } },
    { type: 'heading', attrs: { id: 'one', level: 1 }, content: [{ type: 'text', text: 'One' }] },
    { type: 'image', attrs: { id: 'figure-one', src: './images/one.png', caption: 'First' } },
    { type: 'table', attrs: { id: 'table-one', caption: 'First table' }, content: [] },
    { type: 'callout', attrs: { variant: 'note' }, content: [
      { type: 'mathBlock', attrs: { id: 'nested-equation', latex: 'x=1' } },
    ] },
    { type: 'heading', attrs: { id: 'appendix', level: 1, numbered: false }, content: [{ type: 'text', text: 'Appendix' }] },
    { type: 'image', attrs: { id: 'appendix-figure', src: './images/appendix.png' } },
    { type: 'heading', attrs: { id: 'two', level: 1 }, content: [{ type: 'text', text: 'Two' }] },
    { type: 'table', attrs: { id: 'table-two', caption: 'Second table' }, content: [] },
  ],
};

describe('shared document numbering', () => {
  it('numbers endnotes by body appearance independently of stable ids', () => {
    const first: TiptapNode = { type: 'endnote', attrs: { id: 'endnote-9', body: 'First' } };
    const second: TiptapNode = { type: 'endnote', attrs: { id: 'endnote-2', body: 'Second' } };
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'A' }, first,
        { type: 'text', text: 'B' }, second,
      ] }],
    };

    const index = buildNumberingIndex(doc, {
      headingNumbering: true,
      captionNumbering: 'sequential',
      equationNumbering: 'sequential',
      captionStyle: 'modern',
      crossRefIncludeCaption: false,
    });

    expect(index.byId.get('endnote-9')).toMatchObject({ kind: 'endnote', number: '1', title: 'First' });
    expect(index.byId.get('endnote-2')).toMatchObject({ kind: 'endnote', number: '2', title: 'Second' });
    expect(index.byNode.get(first)?.number).toBe('1');
  });

  it('preserves skipped heading levels as zero-valued hierarchy segments', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [{ type: 'text', text: 'Level 1' }] },
        { type: 'heading', attrs: { id: 'h2', level: 2 }, content: [{ type: 'text', text: 'Level 2' }] },
        { type: 'heading', attrs: { id: 'h4', level: 4 }, content: [{ type: 'text', text: 'Level 4' }] },
      ],
    };

    const index = buildNumberingIndex(doc, {
      headingNumbering: true,
      captionNumbering: 'sequential',
      equationNumbering: 'sequential',
      captionStyle: 'modern',
      crossRefIncludeCaption: false,
    });

    expect(index.byId.get('h1')?.number).toBe('1');
    expect(index.byId.get('h2')?.number).toBe('1.1');
    expect(index.byId.get('h4')?.number).toBe('1.1.0.1');
  });

  it('starts numbered H1 sections at zero when configured', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'leading-h2', level: 2 }, content: [{ type: 'text', text: 'Leading H2' }] },
        { type: 'image', attrs: { id: 'preamble', src: './images/pre.png' } },
        { type: 'heading', attrs: { id: 'appendix', level: 1, numbered: false }, content: [{ type: 'text', text: 'Appendix' }] },
        { type: 'image', attrs: { id: 'appendix-figure', src: './images/appendix.png' } },
        { type: 'heading', attrs: { id: 'zero', level: 1 }, content: [{ type: 'text', text: 'Zero' }] },
        { type: 'heading', attrs: { id: 'zero-one', level: 2 }, content: [{ type: 'text', text: 'Zero One' }] },
        { type: 'image', attrs: { id: 'zero-figure', src: './images/zero.png' } },
      ],
    };

    const index = buildNumberingIndex(doc, {
      headingNumbering: true,
      headingStartNumber: 0,
      captionNumbering: 'hierarchical',
      equationNumbering: 'hierarchical',
      captionStyle: 'modern',
      crossRefIncludeCaption: false,
    });

    expect(index.byId.get('leading-h2')?.number).toBe('0.1');
    expect(index.byId.get('preamble')?.number).toBe('1');
    expect(index.byId.get('appendix-figure')?.number).toBe('1');
    expect(index.byId.get('zero')?.number).toBe('0');
    expect(index.byId.get('zero-one')?.number).toBe('0.1');
    expect(index.byId.get('zero-figure')?.number).toBe('0.1');
  });

  it('uses global sequential counters and includes captionless and nested objects', () => {
    const index = buildNumberingIndex(fixture, {
      headingNumbering: true,
      captionNumbering: 'sequential',
      equationNumbering: 'sequential',
      captionStyle: 'modern',
      crossRefIncludeCaption: true,
    });

    expect(index.byId.get('pre-figure')?.number).toBe('1');
    expect(index.byId.get('figure-one')?.number).toBe('2');
    expect(index.byId.get('appendix-figure')?.number).toBe('3');
    expect(index.byId.get('nested-equation')?.number).toBe('2');
    expect(index.byId.get('figure-one')?.referenceLabel).toBe('Figure 2: First');
    expect(index.byId.get('appendix')?.numbered).toBe(false);
  });

  it('reapplies a zero heading start number at reset boundaries', () => {
    const doc: TiptapNode = { type: 'doc', content: [
      { type: 'heading', attrs: { id: 'chapter-one', level: 1 } },
      { type: 'heading', attrs: { id: 'chapter-two', level: 1 } },
    ] };
    const index = buildNumberingIndex(doc, {
      headingNumbering: true,
      headingStartNumber: 0,
      captionNumbering: 'sequential',
      equationNumbering: 'sequential',
      captionStyle: 'modern',
      crossRefIncludeCaption: false,
      counterResetPaths: ['1'],
    });

    expect(index.byId.get('chapter-one')?.number).toBe('0');
    expect(index.byId.get('chapter-two')?.number).toBe('0');
  });

  it('uses section-local hierarchical counters with IEEE Roman tables', () => {
    const index = buildNumberingIndex(fixture, {
      headingNumbering: true,
      captionNumbering: 'hierarchical',
      equationNumbering: 'hierarchical',
      captionStyle: 'ieee',
      crossRefIncludeCaption: false,
    });

    expect(index.byId.get('pre-figure')?.number).toBe('1');
    expect(index.byId.get('pre-equation')?.number).toBe('1');
    expect(index.byId.get('figure-one')?.number).toBe('1.1');
    expect(index.byId.get('table-one')?.number).toBe('1.I');
    expect(index.byId.get('nested-equation')?.displayLabel).toBe('(1.1)');
    expect(index.byId.get('appendix-figure')?.number).toBe('1');
    expect(index.byId.get('table-two')?.number).toBe('2.I');
  });

  it('is deterministic and does not mutate the input document', () => {
    const before = JSON.stringify(fixture);
    const policy = {
      headingNumbering: false,
      captionNumbering: 'sequential' as const,
      equationNumbering: 'sequential' as const,
      captionStyle: 'korean' as const,
      crossRefIncludeCaption: false,
    };
    expect([...buildNumberingIndex(fixture, policy).byId.keys()])
      .toEqual([...buildNumberingIndex(fixture, policy).byId.keys()]);
    expect(JSON.stringify(fixture)).toBe(before);
    expect(buildNumberingIndex(fixture, policy).byId.get('one')?.numbered).toBe(false);
    expect(buildNumberingIndex(fixture, {
      ...policy,
      captionNumbering: 'hierarchical',
    }).byId.get('figure-one')?.number).toBe('1.1');
  });
});
