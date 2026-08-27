import React from 'react';
import { getSchema, type Editor } from '@tiptap/core';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { StarterKit } from '@tiptap/starter-kit';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  activateEndnoteReturn,
  buildEndnoteViewItems,
  EndnoteListItem,
  normalizeEndnoteDraft,
} from '../shared/editor/components/EndnoteList';
import { EditorI18nProvider } from '../shared/editor/i18n';
import { Endnote, insertEndnoteAndFocus } from '../shared/editor/extensions/Endnote';
import {
  createDocumentStructureIndexPlugin,
  getDocumentStructureIndexState,
} from '../shared/editor/structureIndex';
import { resolveEditorSettings } from '../shared/settingsResolver';

const note = {
  id: 'endnote-1',
  body: 'Material grade: ASTM A36 structural steel.',
  number: 1,
};

const renderItem = (overrides: Partial<React.ComponentProps<typeof EndnoteListItem>> = {}) =>
  renderToStaticMarkup(
    <EditorI18nProvider locale="en">
      <ol>
        <EndnoteListItem
          note={note}
          editable
          editing={false}
          draft={note.body}
          onBeginEdit={vi.fn()}
          onDraftChange={vi.fn()}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
          onReturnToMarker={vi.fn()}
          {...overrides}
        />
      </ol>
    </EditorI18nProvider>,
  );

describe('endnote list presentation', () => {
  it('projects list rows from the canonical structure index', () => {
    expect(buildEndnoteViewItems([{
      kind: 'endnote',
      id: 'endnote-7',
      pos: 42,
      number: '3',
      displayLabel: '3',
      baseLabel: '3',
      referenceLabel: '3',
      title: 'Indexed body',
      numbered: true,
    }])).toEqual([{ id: 'endnote-7', body: 'Indexed body', number: 3 }]);
  });

  it('makes an inserted endnote available before scheduling focus', () => {
    const schema = getSchema([StarterKit, Endnote]);
    const structurePlugin = createDocumentStructureIndexPlugin({
      getSettings: () => resolveEditorSettings(),
    });
    let state = EditorState.create({
      schema,
      plugins: [structurePlugin],
      doc: schema.node('doc', null, [schema.node('paragraph')]),
    });
    const view = {
      get state() { return state; },
      dispatch(transaction: Transaction) { state = state.apply(transaction); },
    } as unknown as EditorView;
    let insertedAttributes: { id?: string; body?: string } | undefined;
    const chain = {
      focus: () => chain,
      insertEndnote: (attributes: { id?: string; body?: string }) => {
        insertedAttributes = attributes;
        return chain;
      },
      run: () => {
        view.dispatch(state.tr.insert(1, schema.node('endnote', insertedAttributes)));
        return true;
      },
    };
    const editor = {
      get state() { return state; },
      view,
      chain: () => chain,
    } as unknown as Editor;
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

    expect(insertEndnoteAndFocus(editor)).toBe(true);

    const index = getDocumentStructureIndexState(state);
    expect(index.dirty).toBe(false);
    expect(index.endnotes).toMatchObject([{
      id: 'endnote-1',
      title: '',
      number: '1',
    }]);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('renders a populated endnote as ordinary text with an explicit edit action', () => {
    const markup = renderItem();

    expect(markup).toContain('Material grade: ASTM A36 structural steel.');
    expect(markup).toContain('aria-label="Edit footnote 1"');
    expect(markup).toContain('class="endnote-list__number"');
    expect(markup).toContain('aria-label="Return to footnote 1 marker"');
    expect(markup).not.toContain('endnote-list__backlink');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<textarea');
  });

  it('shows a single-line input and explicit Save/Cancel actions only while editing', () => {
    const markup = renderItem({ editing: true });

    expect(markup).toContain('type="text"');
    expect(markup).toContain('aria-label="Footnote 1 text"');
    expect(markup).toContain('aria-label="Save footnote 1"');
    expect(markup).toContain('aria-label="Cancel editing footnote 1"');
    expect(markup).toContain('class="endnote-list__number"');
    expect(markup).not.toContain('endnote-list__backlink');
    expect(markup).not.toContain('<textarea');
  });

  it('omits editing controls in a read-only document while retaining the backlink', () => {
    const markup = renderItem({ editable: false });

    expect(markup).not.toContain('Edit footnote 1');
    expect(markup).toContain('Return to footnote 1 marker');
    expect(markup).toContain('class="endnote-list__number"');
    expect(markup).not.toContain('endnote-list__backlink');
    expect(markup).toContain('Material grade: ASTM A36 structural steel.');
  });

  it('normalizes pasted line breaks without changing other draft text', () => {
    expect(normalizeEndnoteDraft('first\r\nsecond\nthird')).toBe('first second third');
  });

  it('commits an active draft before returning from the number link', () => {
    const order: string[] = [];

    activateEndnoteReturn(
      true,
      () => order.push('commit'),
      () => order.push('return'),
    );

    expect(order).toEqual(['commit', 'return']);
  });
});
