import { getSchema } from '@tiptap/core';
import { history, redo, undo } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { DecorationSet } from '@tiptap/pm/view';
import { StarterKit } from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { describe, expect, it, vi } from 'vitest';
import { createOptimizedLowlightPlugin } from '../shared/editor/extensions/optimizedLowlightPlugin';

const schema = getSchema([StarterKit]);
const paragraph = (text = 'paragraph text') => schema.node('paragraph', null, schema.text(text));
const code = (text = 'const answer = 42;', language: string | null = 'javascript') =>
  schema.node('codeBlock', { language }, text ? schema.text(text) : undefined);
const highlighter = () => {
  const highlight = vi.fn((language: string, value: string) => ({ children: value.split(/(\s+)/u).map((text) => ({
    properties: { className: [`hljs-${language}-${/^\s/u.test(text) ? 'space' : 'token'}`] },
    children: [{ value: text }],
  })) }));
  return { highlight, highlightAuto: (value: string) => highlight('auto', value), listLanguages: () => ['javascript', 'python'] };
};
const signature = (decorations: DecorationSet) => decorations.find().map((decoration) => ({
  from: decoration.from, to: decoration.to,
  className: (decoration.type as unknown as { attrs: { class: string } }).attrs.class,
})).sort((a, b) => a.from - b.from || a.to - b.to || a.className.localeCompare(b.className));
const setup = (nodes: PMNode[]) => {
  const lowlight = highlighter();
  const plugin = createOptimizedLowlightPlugin({ name: 'codeBlock', lowlight });
  let state = EditorState.create({ schema, doc: schema.node('doc', null, nodes), plugins: [history(), plugin] });
  const check = () => {
    // A new plugin init always performs the full build, independently of incremental state.
    const oracle = createOptimizedLowlightPlugin({ name: 'codeBlock', lowlight: highlighter() });
    const full = EditorState.create({ schema, doc: state.doc, plugins: [oracle] });
    expect(signature(plugin.getState(state)!.decorations)).toEqual(signature(oracle.getState(full)!.decorations));
  };
  return {
    get state() { return state; },
    lowlight,
    apply(tr: Transaction, calls?: number) {
      lowlight.highlight.mockClear();
      state = state.apply(tr);
      check();
      if (calls !== undefined) expect(lowlight.highlight).toHaveBeenCalledTimes(calls);
    },
    pos(type = 'codeBlock', index = 0) {
      const positions: number[] = [];
      state.doc.descendants((node, pos) => { if (node.type.name === type) positions.push(pos); });
      if (positions[index] === undefined) throw new Error('missing test node');
      return positions[index];
    },
  };
};

describe('incremental lowlight', () => {
  it('matches a fresh full build using real Lowlight tokens and auto detection', () => {
    const lowlight = createLowlight(common);
    const plugin = createOptimizedLowlightPlugin({ name: 'codeBlock', lowlight });
    let state = EditorState.create({ schema, plugins: [plugin], doc: schema.node('doc', null, [
      paragraph(), code('const message = "한글 😀"; // comment'), code('print("hello")', null),
    ]) });
    const check = (tr: Transaction) => {
      state = state.apply(tr);
      const oracle = createOptimizedLowlightPlugin({ name: 'codeBlock', lowlight });
      const full = EditorState.create({ schema, doc: state.doc, plugins: [oracle] });
      expect(signature(plugin.getState(state)!.decorations)).toEqual(signature(oracle.getState(full)!.decorations));
    };
    check(state.tr.addMark(1, 5, schema.marks.bold.create()));
    check(state.tr.insertText('x', paragraph().nodeSize + 3).setMeta('composition', 1));
    check(state.tr.setNodeAttribute(paragraph().nodeSize, 'language', 'python'));
    check(state.tr.insert(0, paragraph('new prefix')));
    check(state.tr.insert(state.doc.content.size, code('SELECT * FROM table;', 'unknown-custom')));
  });

  it('highlights only one edited block among 250, and none for paragraph input or marks', () => {
    const h = setup([paragraph(), ...Array.from({ length: 250 }, (_, i) => code(`const value${i} = ${i};`))]);
    h.apply(h.state.tr.insertText('x', h.pos() + 3), 1);
    h.apply(h.state.tr.addMark(1, 5, schema.marks.bold.create()), 0);
    h.apply(h.state.tr.insertText('marked', 2), 0);
    h.apply(h.state.tr.removeMark(1, 5, schema.marks.bold), 0);
    h.apply(h.state.tr.insertText('plain', 10), 0);
  });

  it('invalidates language changes, same-text replacements, and empty blocks', () => {
    const h = setup([code(), code(''), code('unknown', 'custom-language'), paragraph()]);
    h.apply(h.state.tr.setNodeAttribute(h.pos(), 'language', 'python'), 1);
    h.apply(h.state.tr.setNodeAttribute(h.pos(), 'language', 'python'), 0);
    h.apply(h.state.tr.setNodeMarkup(h.pos(), undefined, { language: 'python' }), 0);
    h.apply(h.state.tr.setNodeMarkup(h.pos(), undefined, { language: null }), 1);
    const pos = h.pos();
    const text = h.state.doc.nodeAt(pos)!.textContent;
    h.apply(h.state.tr.insertText(text, pos + 1, pos + 1 + text.length), 1);
    h.apply(h.state.tr.insertText('first', h.pos('codeBlock', 1) + 1), 1);
    h.apply(h.state.tr.setBlockType(h.pos(), h.pos() + 1, schema.nodes.paragraph), 0);
    h.apply(h.state.tr.setBlockType(h.pos('paragraph'), h.pos('paragraph') + 1, schema.nodes.codeBlock), 1);
  });

  it('maps nested blocks through insertions, wrapping/lifting, deletion and paste', () => {
    const h = setup([paragraph(), schema.node('blockquote', null, [code(), paragraph()]), code('last')]);
    h.apply(h.state.tr.insert(0, paragraph('prefix')), 0);
    const nested = h.pos();
    const range = h.state.doc.resolve(nested).blockRange(h.state.doc.resolve(nested + h.state.doc.nodeAt(nested)!.nodeSize))!;
    h.apply(h.state.tr.wrap(range, [{ type: schema.nodes.blockquote }]), 0);
    const liftPos = h.pos();
    const liftRange = h.state.doc.resolve(liftPos).blockRange(h.state.doc.resolve(liftPos + h.state.doc.nodeAt(liftPos)!.nodeSize))!;
    h.apply(h.state.tr.lift(liftRange, 1), 0);
    h.apply(h.state.tr.insert(0, [code('pasted one'), code('pasted two')]).setMeta('uiEvent', 'paste'), 2);
    h.apply(h.state.tr.delete(h.pos(), h.pos() + h.state.doc.nodeAt(h.pos())!.nodeSize), 0);
  });

  it('handles split/join, multi-step edits, undo/redo, and composition', () => {
    const h = setup([paragraph(), code(), code('unrelated')]);
    h.apply(h.state.tr.split(h.pos() + 6), 2);
    h.apply(h.state.tr.join(h.pos('codeBlock', 1)), 1);
    const tr = h.state.tr.insertText('prefix ', 1);
    tr.insertText('한', tr.mapping.map(h.pos() + 2)).setMeta('composition', 3);
    h.apply(tr, 1);
    expect(undo(h.state, (transaction) => h.apply(transaction))).toBe(true);
    expect(redo(h.state, (transaction) => h.apply(transaction))).toBe(true);
  });

  it('keeps mapped decorations equivalent across a deterministic mixed edit sequence', () => {
    const h = setup([paragraph(), ...Array.from({ length: 12 }, (_, i) => code(`const item${i} = ${i};`))]);
    for (let i = 0; i < 80; i += 1) {
      const pos = h.pos('codeBlock', i % 12);
      if (i % 4 === 0) h.apply(h.state.tr.insertText('p', 1), 0);
      else if (i % 4 === 1) h.apply(h.state.tr.insertText('x', pos + 2), 1);
      else if (i % 4 === 2) h.apply(h.state.tr.setNodeAttribute(pos, 'language', i % 8 === 2 ? 'python' : 'javascript'));
      else h.apply(h.state.tr.addMark(1, 3, schema.marks.italic.create()), 0);
    }
  });

  it('falls back to the full oracle for custom step implementations', () => {
    class CustomReplaceStep extends ReplaceStep {}
    const h = setup([paragraph(), code(), code('second')]);
    const standard = h.state.tr.insertText('x', 1).steps[0] as ReplaceStep;
    h.apply(h.state.tr.step(new CustomReplaceStep(standard.from, standard.to, standard.slice)), 2);
  });
});
