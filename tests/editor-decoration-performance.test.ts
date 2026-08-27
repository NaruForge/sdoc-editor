import { Extension, getSchema } from '@tiptap/core';
import { history, redo, undo } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Decoration, DecorationSet } from '@tiptap/pm/view';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, expect, it, vi } from 'vitest';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '../shared/editor/extensionRuntime';
import {
  buildSectionFoldDecorations,
  createSectionFoldPlugin,
  type SectionFoldState,
} from '../shared/editor/extensions/tiptapExtensions';
import {
  createOptimizedLowlightPlugin,
  type LowlightLike,
  type OptimizedLowlightState,
} from '../shared/editor/extensions/optimizedLowlightPlugin';

const stableHeadingIds = Extension.create({
  name: 'stableHeadingIds',
  addGlobalAttributes() {
    return [{ types: ['heading'], attributes: { id: { default: null } } }];
  },
});

const decorationSignature = (decorations: DecorationSet): unknown[] => decorations.find().map((decoration) => {
  const attrs = (decoration.type as unknown as { attrs?: Record<string, string> }).attrs;
  return {
    from: decoration.from,
    to: decoration.to,
    key: decoration.spec.key,
    className: attrs?.class,
  };
});

const findTopLevelPosition = (
  doc: ProseMirrorNode,
  predicate: (node: ProseMirrorNode) => boolean,
): number => {
  let match = -1;
  doc.forEach((node, pos) => {
    if (match < 0 && predicate(node)) match = pos;
  });
  if (match < 0) throw new Error('Expected top-level node was not found');
  return match;
};

describe('section-fold decorations', () => {
  it('gives anonymous heading widgets distinct fallback identities', () => {
    const schema = getSchema([StarterKit, stableHeadingIds]);
    const plugin = createSectionFoldPlugin(NOOP_EDITOR_EXTENSION_RUNTIME);
    const state = EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.node('doc', null, [
        schema.node('heading', { level: 1 }, schema.text('First')),
        schema.node('heading', { level: 2 }, schema.text('Second')),
      ]),
    });

    const widgetKeys = plugin.getState(state)!.decorations.find()
      .map((decoration) => decoration.spec.key)
      .filter((key): key is string => typeof key === 'string');
    expect(widgetKeys).toHaveLength(2);
    expect(new Set(widgetKeys)).toHaveLength(2);
    expect(widgetKeys.every((key) => key.startsWith('fold-pos:'))).toBe(true);
  });

  it('drops a stale toggle target while still rebuilding a changed document', () => {
    const schema = getSchema([StarterKit, stableHeadingIds]);
    const plugin = createSectionFoldPlugin(NOOP_EDITOR_EXTENSION_RUNTIME);
    let state = EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.node('doc', null, [
        schema.node('heading', { level: 1, id: 'removed-heading' }, schema.text('Removed')),
        schema.node('paragraph', null, schema.text('Body')),
      ]),
    });
    state = state.apply(state.tr.setMeta(plugin, 0));
    const heading = state.doc.nodeAt(0)!;
    state = state.apply(state.tr.delete(0, heading.nodeSize).setMeta(plugin, 0));

    const current = plugin.getState(state)!;
    expect(current.collapsed.size).toBe(0);
    expect(decorationSignature(current.decorations)).toEqual(decorationSignature(
      buildSectionFoldDecorations(state.doc, current.collapsed, NOOP_EDITOR_EXTENSION_RUNTIME),
    ));
  });

  it('maps 100 ordinary paragraph transactions without rebuilding the document decorations', () => {
    const schema = getSchema([StarterKit, stableHeadingIds]);
    const plugin = createSectionFoldPlugin(NOOP_EDITOR_EXTENSION_RUNTIME);
    const blocks = Array.from({ length: 10_000 }, () => schema.node('paragraph'));
    blocks.push(
      schema.node('heading', { level: 1, id: 'stable-heading' }, schema.text('Heading')),
      schema.node('paragraph', null, schema.text('Collapsed body')),
    );
    let state = EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.node('doc', null, blocks),
    });
    const headingPos = findTopLevelPosition(state.doc, (node) => node.attrs.id === 'stable-heading');
    state = state.apply(state.tr.setMeta(plugin, headingPos));
    const afterToggle = plugin.getState(state)!;

    for (let index = 0; index < 100; index += 1) {
      const transaction = state.tr.insertText('x', 1);
      if (index === 50) transaction.setMeta('composition', 1);
      state = state.apply(transaction);
    }

    const current = plugin.getState(state)!;
    const reference = buildSectionFoldDecorations(
      state.doc,
      current.collapsed,
      NOOP_EDITOR_EXTENSION_RUNTIME,
    );
    expect(current.rebuildCount).toBe(afterToggle.rebuildCount);
    expect(decorationSignature(current.decorations)).toEqual(decorationSignature(reference));
    const collapsedWidget = current.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === 'fold-id:stable-heading',
    );
    expect(collapsedWidget).toHaveLength(1);
    const attributes = new Map<string, string>();
    const control = {
      className: '',
      textContent: '',
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    };
    vi.stubGlobal('document', { createElement: () => control });
    const toDOM = (collapsedWidget[0]?.type as unknown as { toDOM?: () => unknown }).toDOM;
    toDOM?.();
    expect(control.textContent).toBe('▸');
    expect(Object.fromEntries(attributes)).toMatchObject({
      'aria-expanded': 'false',
      'aria-label': NOOP_EDITOR_EXTENSION_RUNTIME.translate('toc.expand'),
    });
  });

  it('keeps pointer and keyboard activation on the fold control without editing the document', () => {
    const schema = getSchema([StarterKit, stableHeadingIds]);
    const plugin = createSectionFoldPlugin(NOOP_EDITOR_EXTENSION_RUNTIME);
    let state = EditorState.create({
      schema,
      plugins: [history(), plugin],
      doc: schema.node('doc', null, [
        schema.node('heading', { level: 1, id: 'focus-heading' }, schema.text('Heading')),
        schema.node('paragraph', null, schema.text('Body')),
      ]),
    });
    const originalDoc = state.doc;
    const attributes = new Map<string, string>();
    const setAttribute = vi.fn((name: string, value: string) => attributes.set(name, value));
    const control = {
      className: '',
      textContent: '',
      setAttribute,
      classList: { contains: (name: string) => name === 'fold-toggle' },
      parentElement: { tagName: 'H1' },
      focus: vi.fn(),
    };
    const createElement = vi.fn(() => control);
    vi.stubGlobal('document', { createElement });

    const initialWidget = plugin.getState(state)!.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === 'fold-id:focus-heading',
    )[0];
    const toDOM = (initialWidget?.type as unknown as { toDOM?: () => unknown }).toDOM;
    expect(toDOM?.()).toBe(control);
    expect(attributes.get('aria-expanded')).toBe('true');

    let pluginView: ReturnType<NonNullable<typeof plugin.spec.view>> | undefined;
    const view = {
      get state() { return state; },
      posAtDOM: () => 1,
      dispatch: vi.fn((transaction) => {
        const previousState = state;
        state = state.apply(transaction);
        pluginView?.update?.(view, previousState);
      }),
    } as unknown as import('@tiptap/pm/view').EditorView;
    pluginView = plugin.spec.view?.(view);
    const mousedown = plugin.props.handleDOMEvents?.mousedown;
    const pointerEvent = {
      target: control,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    expect(mousedown?.(view, pointerEvent)).toBe(true);
    expect(pointerEvent.preventDefault).toHaveBeenCalledOnce();
    expect(pointerEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(control.focus).toHaveBeenCalledOnce();
    expect(state.doc.eq(originalDoc)).toBe(true);
    expect(attributes.get('aria-expanded')).toBe('false');
    expect(attributes.get('aria-label')).toBe(NOOP_EDITOR_EXTENSION_RUNTIME.translate('toc.expand'));
    expect(plugin.getState(state)!.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === initialWidget?.spec.key,
    )).toHaveLength(1);
    const collapsedWidget = plugin.getState(state)!.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === initialWidget?.spec.key,
    )[0];
    expect((collapsedWidget?.type as unknown as { toDOM?: () => unknown }).toDOM?.()).toBe(control);
    expect(createElement).toHaveBeenCalledOnce();

    const keydown = plugin.props.handleDOMEvents?.keydown;
    const keyboardEvent = {
      key: 'Enter',
      target: control,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(keydown?.(view, keyboardEvent)).toBe(true);
    expect(keyboardEvent.preventDefault).toHaveBeenCalledOnce();
    expect(keyboardEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(state.doc.eq(originalDoc)).toBe(true);
    expect(attributes.get('aria-expanded')).toBe('true');
    expect(attributes.get('aria-label')).toBe(NOOP_EDITOR_EXTENSION_RUNTIME.translate('toc.collapse'));

    const spaceEvent = {
      key: ' ',
      target: control,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(keydown?.(view, spaceEvent)).toBe(true);
    expect(spaceEvent.preventDefault).toHaveBeenCalledOnce();
    expect(spaceEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(state.doc.eq(originalDoc)).toBe(true);
    expect(attributes.get('aria-expanded')).toBe('false');
    expect(control.focus).toHaveBeenCalledTimes(3);

    const tabEvent = {
      key: 'Tab',
      target: control,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(keydown?.(view, tabEvent)).toBe(false);
    expect(tabEvent.preventDefault).not.toHaveBeenCalled();
    expect(tabEvent.stopPropagation).not.toHaveBeenCalled();
    expect(state.doc.eq(originalDoc)).toBe(true);

    const controlSyncCalls = setAttribute.mock.calls.length;
    const bodyPos = findTopLevelPosition(state.doc, (node) => node.textContent === 'Body');
    view.dispatch(state.tr.insertText(' edited', bodyPos + 1));
    expect(setAttribute).toHaveBeenCalledTimes(controlSyncCalls);
    const mappedWidget = plugin.getState(state)!.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === initialWidget?.spec.key,
    )[0];
    expect((mappedWidget?.type as unknown as { toDOM?: () => unknown }).toDOM?.()).toBe(control);
    expect(createElement).toHaveBeenCalledOnce();

    expect(undo(state, (transaction) => view.dispatch(transaction))).toBe(true);
    const undoWidget = plugin.getState(state)!.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === initialWidget?.spec.key,
    )[0];
    expect((undoWidget?.type as unknown as { toDOM?: () => unknown }).toDOM?.()).toBe(control);
    expect(redo(state, (transaction) => view.dispatch(transaction))).toBe(true);
    const redoWidget = plugin.getState(state)!.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === initialWidget?.spec.key,
    )[0];
    expect((redoWidget?.type as unknown as { toDOM?: () => unknown }).toDOM?.()).toBe(control);
    expect(createElement).toHaveBeenCalledOnce();
    expect(control.focus).toHaveBeenCalledTimes(3);

    pluginView?.destroy?.();
    expect((redoWidget?.type as unknown as { toDOM?: () => unknown }).toDOM?.()).toBe(control);
    expect(createElement).toHaveBeenCalledTimes(2);
  });

  it('refreshes cached fold-control localization without rebuilding document decorations', () => {
    let locale = 'en';
    const runtime = {
      ...NOOP_EDITOR_EXTENSION_RUNTIME,
      translate: (key: string) => `${locale}:${key}`,
    };
    const schema = getSchema([StarterKit, stableHeadingIds]);
    const plugin = createSectionFoldPlugin(runtime);
    const state = EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.node('doc', null, [
        schema.node('heading', { level: 1, id: 'localized-heading' }, schema.text('Heading')),
      ]),
    });
    const attributes = new Map<string, string>();
    const control = {
      className: '',
      textContent: '',
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    };
    vi.stubGlobal('document', { createElement: () => control });
    const widget = plugin.getState(state)!.decorations.find(
      undefined,
      undefined,
      (spec) => spec.key === 'fold-id:localized-heading',
    )[0];
    (widget?.type as unknown as { toDOM?: () => unknown }).toDOM?.();
    expect(attributes.get('aria-label')).toBe('en:toc.collapse');

    const view = { state } as unknown as import('@tiptap/pm/view').EditorView;
    const pluginView = plugin.spec.view?.(view);
    const rebuildCount = plugin.getState(state)!.rebuildCount;
    locale = 'ko';
    pluginView?.update?.(view, state);

    expect(attributes.get('aria-label')).toBe('ko:toc.collapse');
    expect(plugin.getState(state)!.rebuildCount).toBe(rebuildCount);
    pluginView?.destroy?.();
  });

  it('keeps fold meaning equivalent to a full rebuild across selection, undo/redo, and heading edits', () => {
    const schema = getSchema([StarterKit, stableHeadingIds]);
    const plugin = createSectionFoldPlugin(NOOP_EDITOR_EXTENSION_RUNTIME);
    let state = EditorState.create({
      schema,
      plugins: [history(), plugin],
      doc: schema.node('doc', null, [
        schema.node('heading', { level: 1, id: 'heading-a' }, schema.text('A')),
        schema.node('paragraph', null, schema.text('A body')),
        schema.node('heading', { level: 2, id: 'heading-b' }, schema.text('B')),
        schema.node('paragraph', null, schema.text('B body')),
        schema.node('heading', { level: 1, id: 'heading-c' }, schema.text('C')),
        schema.node('paragraph', null, schema.text('C body')),
      ]),
    });
    state = state.apply(state.tr.setMeta(plugin, 0));

    const expectFullRebuildEquivalence = (): SectionFoldState => {
      const current = plugin.getState(state)!;
      expect(decorationSignature(current.decorations)).toEqual(decorationSignature(
        buildSectionFoldDecorations(state.doc, current.collapsed, NOOP_EDITOR_EXTENSION_RUNTIME),
      ));
      return current;
    };

    const beforeSelection = expectFullRebuildEquivalence();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    expect(plugin.getState(state)).toBe(beforeSelection);

    const bodyPos = findTopLevelPosition(state.doc, (node) => node.textContent === 'A body');
    state = state.apply(state.tr.insertText(' updated', bodyPos + 1));
    expectFullRebuildEquivalence();
    expect(undo(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    expectFullRebuildEquivalence();
    expect(redo(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    expectFullRebuildEquivalence();

    const insertedHeading = schema.node('heading', { level: 1, id: 'heading-inserted' }, schema.text('Inserted'));
    const headingCPos = findTopLevelPosition(state.doc, (node) => node.attrs.id === 'heading-c');
    state = state.apply(state.tr.insert(headingCPos, insertedHeading));
    expectFullRebuildEquivalence();
    const insertedPos = findTopLevelPosition(state.doc, (node) => node.attrs.id === 'heading-inserted');
    state = state.apply(state.tr.delete(insertedPos, insertedPos + insertedHeading.nodeSize));
    expectFullRebuildEquivalence();

    const headingA = state.doc.nodeAt(0)!;
    const move = state.tr.delete(0, headingA.nodeSize);
    move.insert(move.doc.content.size, headingA);
    state = state.apply(move);
    const moved = expectFullRebuildEquivalence();
    expect(moved.collapsed.has('id:heading-a')).toBe(true);
  });

  it('keeps an anonymous collapsed heading aligned when earlier text shifts its position', () => {
    const schema = getSchema([StarterKit, stableHeadingIds]);
    const plugin = createSectionFoldPlugin(NOOP_EDITOR_EXTENSION_RUNTIME);
    let state = EditorState.create({
      schema,
      plugins: [history(), plugin],
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, schema.text('Prefix')),
        schema.node('heading', { level: 1 }, schema.text('Anonymous')),
        schema.node('paragraph', null, schema.text('Body')),
      ]),
    });
    const headingPos = findTopLevelPosition(state.doc, (node) => node.type.name === 'heading');
    state = state.apply(state.tr.setMeta(plugin, headingPos));

    state = state.apply(state.tr.insertText(' shifted', 1));
    const shiftedHeadingPos = findTopLevelPosition(state.doc, (node) => node.type.name === 'heading');
    let current = plugin.getState(state)!;
    expect(current.collapsed.has(`pos:${shiftedHeadingPos}`)).toBe(true);
    expect(decorationSignature(current.decorations)).toEqual(decorationSignature(
      buildSectionFoldDecorations(state.doc, current.collapsed, NOOP_EDITOR_EXTENSION_RUNTIME),
    ));

    expect(undo(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    current = plugin.getState(state)!;
    expect(current.collapsed.has(`pos:${headingPos}`)).toBe(true);
    expect(decorationSignature(current.decorations)).toEqual(decorationSignature(
      buildSectionFoldDecorations(state.doc, current.collapsed, NOOP_EDITOR_EXTENSION_RUNTIME),
    ));
    expect(redo(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    current = plugin.getState(state)!;
    expect(current.collapsed.has(`pos:${shiftedHeadingPos}`)).toBe(true);
  });
});

describe('optimized lowlight decorations', () => {
  const createLowlightDouble = () => {
    const highlight = vi.fn((_language: string, value: string) => ({
      children: [{
        properties: { className: ['hljs-code'] },
        children: [{ value }],
      }],
    }));
    const highlightAuto = vi.fn((value: string) => ({ children: [{ value }] }));
    const lowlight: LowlightLike = {
      highlight,
      highlightAuto,
      listLanguages: () => ['javascript'],
      registered: (language) => language === 'javascript',
    };
    return { lowlight, highlight, highlightAuto };
  };

  it('preserves the upstream lowlight API guard', () => {
    expect(() => createOptimizedLowlightPlugin({
      name: 'codeBlock',
      lowlight: {} as LowlightLike,
    })).toThrow('provide an instance of lowlight');
  });

  it('uses the configured default language when a block has no language', () => {
    const schema = getSchema([StarterKit]);
    const { lowlight, highlight, highlightAuto } = createLowlightDouble();
    const plugin = createOptimizedLowlightPlugin({
      name: 'codeBlock',
      lowlight,
      defaultLanguage: 'javascript',
    });
    EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.node('doc', null, [
        schema.node('codeBlock', null, schema.text('const answer = 1')),
      ]),
    });

    expect(highlight).toHaveBeenCalledWith('javascript', 'const answer = 1');
    expect(highlightAuto).not.toHaveBeenCalled();
  });

  it('maps 100 non-code paragraph transactions without scanning the document', () => {
    const schema = getSchema([StarterKit]);
    const { lowlight, highlight } = createLowlightDouble();
    const plugin = createOptimizedLowlightPlugin({ name: 'codeBlock', lowlight });
    let state = EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, schema.text('Prefix')),
        schema.node('codeBlock', { language: 'javascript' }, schema.text('const answer = 1')),
      ]),
    });
    const initial = plugin.getState(state)!;
    const initialDecoration = initial.decorations.find()[0] as Decoration;

    for (let index = 0; index < 100; index += 1) {
      const transaction = state.tr.insertText('x', 1);
      if (index === 50) transaction.setMeta('composition', 1);
      state = state.apply(transaction);
    }

    const current = plugin.getState(state)!;
    expect(current.documentScanCount).toBe(initial.documentScanCount);
    expect(highlight).toHaveBeenCalledOnce();
    expect(current.decorations.find()[0]?.from).toBe(initialDecoration.from + 100);
  });

  it('rescans on code edits and preserves highlighting through undo/redo and block changes', () => {
    const schema = getSchema([StarterKit]);
    const { lowlight, highlight } = createLowlightDouble();
    const plugin = createOptimizedLowlightPlugin({ name: 'codeBlock', lowlight });
    let state = EditorState.create({
      schema,
      plugins: [history(), plugin],
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, schema.text('Prefix')),
        schema.node('codeBlock', { language: 'javascript' }, schema.text('const answer = 1')),
      ]),
    });
    const initialScans = plugin.getState(state)!.documentScanCount;
    const codePos = findTopLevelPosition(state.doc, (node) => node.type.name === 'codeBlock');
    state = state.apply(state.tr.insertText('let ', codePos + 1).setMeta('composition', 2));
    expect(plugin.getState(state)!.documentScanCount).toBe(initialScans + 1);
    expect(highlight).toHaveBeenLastCalledWith('javascript', 'let const answer = 1');

    expect(undo(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    expect(highlight).toHaveBeenLastCalledWith('javascript', 'const answer = 1');
    expect(redo(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    expect(highlight).toHaveBeenLastCalledWith('javascript', 'let const answer = 1');

    const secondCode = schema.node('codeBlock', { language: 'javascript' }, schema.text('return answer'));
    state = state.apply(state.tr.insert(state.doc.content.size, secondCode));
    expect(plugin.getState(state)!.decorations.find()).toHaveLength(2);
    const firstCodePos = findTopLevelPosition(state.doc, (node) => node.type.name === 'codeBlock');
    const firstCode = state.doc.nodeAt(firstCodePos)!;
    state = state.apply(state.tr.delete(firstCodePos, firstCodePos + firstCode.nodeSize));
    const current: OptimizedLowlightState = plugin.getState(state)!;
    expect(current.decorations.find()).toHaveLength(1);
    expect(highlight).toHaveBeenLastCalledWith('javascript', 'return answer');
  });
});
