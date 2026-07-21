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
