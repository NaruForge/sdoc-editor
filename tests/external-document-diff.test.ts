import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TiptapNode } from '../shared/types';
import {
  ExternalChangeBanner,
  ExternalChangeComparison,
  buildExternalChangeComparison,
  buildExternalDocumentDiff,
} from '../shared/editor/externalChanges';

const text = (value: string): TiptapNode => ({ type: 'text', text: value });
const paragraph = (value: string): TiptapNode => ({
  type: 'paragraph',
  content: [text(value)],
});
const heading = (id: string, value: string): TiptapNode => ({
  type: 'heading',
  attrs: { id, level: 1 },
  content: [text(value)],
});
const doc = (...content: TiptapNode[]): TiptapNode => ({ type: 'doc', content });

describe('external document block diff', () => {
  it('uses persistent ids to report a changed and moved heading once', () => {
    const mine = doc(heading('intro', 'Introduction'), paragraph('Body'));
    const external = doc(paragraph('Body'), heading('intro', 'Overview'));

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 0, removed: 0, changed: 1, moved: 2 });
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.find((block) => block.key === 'id:intro')).toMatchObject({
      kinds: ['changed', 'moved'],
      mine: { identityStrategy: 'persistent-id', index: 0, path: [0], preview: 'Introduction' },
      external: { identityStrategy: 'persistent-id', index: 1, path: [1], preview: 'Overview' },
    });
  });

  it('does not fallback-match blocks with different persistent ids', () => {
    const mine = doc(heading('old-heading', 'Same title'));
    const external = doc(heading('new-heading', 'Same title'));

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 1, removed: 1, changed: 0, moved: 0 });
    expect(result.blocks.map((block) => block.kinds)).toEqual([['removed'], ['added']]);
  });

  it('aligns id-less blocks by exact content before type order', () => {
    const mine = doc(paragraph('Alpha'), paragraph('Beta'));
    const external = doc(paragraph('Inserted'), paragraph('Alpha'), paragraph('Beta'));

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 1, removed: 0, changed: 0, moved: 0 });
    expect(result.blocks.filter((block) => block.kinds.includes('changed'))).toHaveLength(0);
    expect(result.blocks.find((block) => block.kinds.includes('added'))?.external).toMatchObject({
      type: 'paragraph',
      preview: 'Inserted',
      identityStrategy: 'fallback',
    });
  });

  it('classifies removed, added, and changed non-text top-level blocks', () => {
    const mine = doc(
      { type: 'image', attrs: { id: 'hero', src: './old.png', caption: 'Old hero' } },
      { type: 'mathBlock', attrs: { id: 'equation', latex: 'x=1' } },
    );
    const external = doc(
      { type: 'image', attrs: { id: 'hero', src: './new.png', caption: 'New hero' } },
      { type: 'table', attrs: { id: 'data', caption: 'Results' } },
    );

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 1, removed: 1, changed: 1, moved: 0 });
    expect(result.blocks.map((block) => block.kinds)).toEqual([['changed'], ['removed'], ['added']]);
    expect(result.blocks[0].external?.preview).toBe('caption: New hero · src: ./new.png');
  });

  it('is deterministic for object attributes regardless of key insertion order', () => {
    const mine = doc({
      type: 'diagram',
      attrs: { id: 'system', language: 'mermaid', code: 'graph TD' },
    });
    const external = doc({
      type: 'diagram',
      attrs: { code: 'graph TD', id: 'system', language: 'mermaid' },
    });

    expect(buildExternalDocumentDiff(mine, external)).toMatchObject({
      hasChanges: false,
      blocks: [],
      summary: { added: 0, removed: 0, changed: 0, moved: 0 },
    });
  });
});

describe('external change comparison UI', () => {
  it('builds a frozen read-only side-by-side model', () => {
    const diff = buildExternalDocumentDiff(doc(heading('intro', 'Mine')), doc(heading('intro', 'On disk')));
    const model = buildExternalChangeComparison(diff, {
      title: 'Review external edit',
      mine: 'Current editor',
      external: 'Disk version',
    });

    expect(model).toMatchObject({
      title: 'Review external edit',
      rows: [
        {
          kinds: ['changed'],
          mine: { label: 'Current editor', block: { preview: 'Mine' } },
          external: { label: 'Disk version', block: { preview: 'On disk' } },
        },
      ],
    });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.rows)).toBe(true);
    expect(Object.isFrozen(model.rows[0])).toBe(true);
  });

  it('shows all actions when dirty and hides Keep mine when clean', () => {
    const callbacks = {
      onCompare: vi.fn(),
      onKeepMine: vi.fn(),
      onReload: vi.fn(),
    };
    const dirtyMarkup = renderToStaticMarkup(
      React.createElement(ExternalChangeBanner, {
        isDirty: true,
        ...callbacks,
      }),
    );
    const cleanMarkup = renderToStaticMarkup(
      React.createElement(ExternalChangeBanner, {
        isDirty: false,
        ...callbacks,
      }),
    );

    expect(dirtyMarkup).toContain('Compare');
    expect(dirtyMarkup).toContain('Keep mine');
    expect(dirtyMarkup).toContain('Reload');
    expect(cleanMarkup).not.toContain('Keep mine');
  });

  it('renders the comparison as a non-modal region with a close action', () => {
    const model = buildExternalChangeComparison(
      buildExternalDocumentDiff(doc(paragraph('Mine')), doc(paragraph('External'))),
    );
    const markup = renderToStaticMarkup(
      React.createElement(ExternalChangeComparison, {
        model,
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('<section');
    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('Mine');
    expect(markup).toContain('External');
    expect(markup).toContain('Changed');
    expect(markup).toContain('Close comparison');
  });
});
