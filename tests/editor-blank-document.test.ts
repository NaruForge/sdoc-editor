import { getSchema } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { history, redo, undo } from '@tiptap/pm/history';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import {
  isBlankEditorDocument,
  subscribeToBlankEditorDocument,
} from '../shared/editor/blankDocument';

const schema = getSchema([StarterKit]);

describe('blank editor document projection', () => {
  it('preserves the start-card definition for empty and non-empty document shapes', () => {
    const doc = (...content: Parameters<typeof schema.node>[2][]) => schema.node('doc', null, content);
    const paragraph = (text?: string) => schema.node(
      'paragraph',
      null,
      text === undefined ? undefined : schema.text(text),
    );

    expect(isBlankEditorDocument(schema.topNodeType.create())).toBe(true);
    expect(isBlankEditorDocument(doc(paragraph(), paragraph(' \t')))).toBe(true);
    expect(isBlankEditorDocument(doc(paragraph('content')))).toBe(false);
    expect(isBlankEditorDocument(doc(schema.node('heading', { level: 1 })))).toBe(false);
  });

  it('tracks paste, clear, undo, redo, and replacement without calling getJSON', () => {
    let state = EditorState.create({
      schema,
      plugins: [history()],
      doc: schema.node('doc', null, [schema.node('paragraph')]),
    });
    const transactionListeners = new Set<(event: { transaction: Transaction }) => void>();
    const getJSON = vi.fn();
    const editor = {
      get state() { return state; },
      getJSON,
      on(event: string, listener: (event: { transaction: Transaction }) => void) {
        if (event === 'transaction') transactionListeners.add(listener);
      },
      off(event: string, listener: (event: { transaction: Transaction }) => void) {
        if (event === 'transaction') transactionListeners.delete(listener);
      },
    } as unknown as Editor;
    const dispatch = (transaction: Transaction) => {
      state = state.apply(transaction);
      for (const listener of transactionListeners) listener({ transaction });
    };
    const transitions: boolean[] = [];
    const unsubscribe = subscribeToBlankEditorDocument(editor, (blank) => transitions.push(blank));

    dispatch(state.tr.insertText('pasted', 1));
    expect(undo(state, dispatch)).toBe(true);
    expect(redo(state, dispatch)).toBe(true);
    dispatch(state.tr.delete(1, 7));
    dispatch(state.tr.replaceWith(
      0,
      state.doc.content.size,
      schema.node('heading', { level: 1 }, schema.text('Replacement')),
    ));
    dispatch(state.tr.replaceWith(
      0,
      state.doc.content.size,
      schema.node('paragraph', null, schema.text('   ')),
    ));

    expect(transitions).toEqual([true, false, true, false, true, false, true]);
    expect(getJSON).not.toHaveBeenCalled();

    unsubscribe();
    expect(transactionListeners).toHaveLength(0);
  });

  it('does not serialize or republish blank state during 100 ordinary transactions', () => {
    let state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('body'))]),
    });
    let transactionListener: ((event: { transaction: Transaction }) => void) | undefined;
    const getJSON = vi.fn();
    const editor = {
      get state() { return state; },
      getJSON,
      on(_event: string, listener: typeof transactionListener) { transactionListener = listener; },
      off() { transactionListener = undefined; },
    } as unknown as Editor;
    const blankUpdates = vi.fn();
    subscribeToBlankEditorDocument(editor, blankUpdates);

    for (let index = 0; index < 100; index += 1) {
      const transaction = state.tr.insertText('x', 1);
      state = state.apply(transaction);
      transactionListener?.({ transaction });
    }

    expect(blankUpdates).toHaveBeenCalledOnce();
    expect(blankUpdates).toHaveBeenLastCalledWith(false);
    expect(getJSON).not.toHaveBeenCalled();
  });

  it('does not rescan unchanged blocks during an ordinary text transaction', () => {
    let state = EditorState.create({
      schema,
      doc: schema.node('doc', null, Array.from(
        { length: 10_000 },
        (_, index) => schema.node('paragraph', null, schema.text(`block ${index}`)),
      )),
    });
    let transactionListener: ((event: { transaction: Transaction }) => void) | undefined;
    const editor = {
      get state() { return state; },
      on(_event: string, listener: typeof transactionListener) { transactionListener = listener; },
      off() { transactionListener = undefined; },
    } as unknown as Editor;
    const nodePrototype = Object.getPrototypeOf(state.doc) as { forEach: (...args: unknown[]) => void };
    const forEach = vi.spyOn(nodePrototype, 'forEach');
    subscribeToBlankEditorDocument(editor, vi.fn());
    forEach.mockClear();

    const transaction = state.tr.insertText('x', 1);
    state = state.apply(transaction);
    transactionListener?.({ transaction });

    expect(forEach).not.toHaveBeenCalled();
    forEach.mockRestore();
  });
});
