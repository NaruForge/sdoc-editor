import { Extension, Node, getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView, PluginView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEditorSettings } from '../shared/settingsResolver';
import { createTiptapExtensions } from '../shared/editor/extensions/tiptapExtensions';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '../shared/editor/extensionRuntime';
import {
  STRUCTURE_INDEX_REBUILD_DELAY_MS,
  createDocumentStructureIndexPlugin,
  ensureStructureIndexFresh,
  getDocumentStructureIndexState,
  requestStructureIndexSettingsRefresh,
  subscribeToDocumentStructureIndex,
} from '../shared/editor/structureIndex';

const createState = () => {
  const schema = getSchema([StarterKit]);
  const settings = resolveEditorSettings();
  const plugin = createDocumentStructureIndexPlugin({ getSettings: () => settings });
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, id: 'heading-one' }, content: [{ type: 'text', text: 'One' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
    ],
  });
  return EditorState.create({ schema, doc, plugins: [plugin] });
};

describe('document structure index', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('marks heading changes dirty and ensureFresh synchronously rebuilds the projection', () => {
    let state = createState();
    state = state.apply(state.tr.insertText(' updated', 4));
    expect(getDocumentStructureIndexState(state).dirty).toBe(true);

    const host = {
      get state() { return state; },
      dispatch(transaction: typeof state.tr) { state = state.apply(transaction); },
    };
    const fresh = ensureStructureIndexFresh(host);

    expect(fresh.headings[0]?.title).toBe('One updated');
    expect(getDocumentStructureIndexState(state)).toMatchObject({
      dirty: false,
      rebuildCount: 2,
      semanticRevision: 2,
    });
  });

  it('coalesces heading, caption, internal-ref, and settings transactions into one 75 ms rebuild', () => {
    vi.useFakeTimers();
    const stableHeadingIds = Extension.create({
      name: 'stableHeadingIds',
      addGlobalAttributes() {
        return [{ types: ['heading'], attributes: { id: { default: null } } }];
      },
    });
    const image = Node.create({
      name: 'image',
      group: 'block',
      atom: true,
      addAttributes() {
        return { id: { default: null }, caption: { default: null } };
      },
      parseHTML() { return [{ tag: 'img' }]; },
      renderHTML({ HTMLAttributes }) { return ['img', HTMLAttributes]; },
    });
    const schema = getSchema([StarterKit, stableHeadingIds, image]);
    let settings = resolveEditorSettings();
    const plugin = createDocumentStructureIndexPlugin({ getSettings: () => settings });
    let state = EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, id: 'heading-one' }, content: [{ type: 'text', text: 'One' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Reference' }] },
          { type: 'image', attrs: { id: 'figure-one', caption: 'Before' } },
        ],
      }),
    });
    let pluginView: PluginView | undefined;
    const view = {
      get state() { return state; },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
        pluginView?.update?.(view as unknown as EditorView);
      },
    } as unknown as EditorView;
    pluginView = plugin.spec.view?.(view);
    expect(pluginView).toBeDefined();
    const semanticUpdates = vi.fn();
    const unsubscribe = subscribeToDocumentStructureIndex(view, semanticUpdates);

    view.dispatch(state.tr.insertText(' updated', 4));
    vi.advanceTimersByTime(20);
    const figurePos = getDocumentStructureIndexState(state).byId.get('figure-one')!.pos;
    const figure = state.doc.nodeAt(figurePos)!;
    view.dispatch(state.tr.setNodeMarkup(figurePos, undefined, { ...figure.attrs, caption: 'After' }));
    vi.advanceTimersByTime(20);
    let paragraphPos = -1;
    state.doc.descendants((node, pos) => {
      if (paragraphPos < 0 && node.type.name === 'paragraph') paragraphPos = pos;
    });
    view.dispatch(state.tr.addMark(
      paragraphPos + 1,
      paragraphPos + 4,
      schema.marks.link.create({ href: '#heading-one' }),
    ));
    vi.advanceTimersByTime(20);
    settings = { ...settings, captionStyle: 'classic' };
    requestStructureIndexSettingsRefresh(view);

    vi.advanceTimersByTime(74);
    expect(semanticUpdates).not.toHaveBeenCalled();
    expect(getDocumentStructureIndexState(state)).toMatchObject({ dirty: true, rebuildCount: 1 });
    vi.advanceTimersByTime(1);
    expect(semanticUpdates).toHaveBeenCalledOnce();
    expect(getDocumentStructureIndexState(state)).toMatchObject({ dirty: false, rebuildCount: 2 });

    unsubscribe();
    pluginView?.destroy?.();
  });

  it('invalidates the shared numbering projection when settings change', () => {
    let state = createState();
    const host = {
      get state() { return state; },
      dispatch(transaction: typeof state.tr) { state = state.apply(transaction); },
    };

    requestStructureIndexSettingsRefresh(host);

    expect(getDocumentStructureIndexState(state).dirty).toBe(true);
  });

  it('keeps subscriptions made before the ProseMirror plugin view mounts', () => {
    vi.useFakeTimers();
    let state = createState();
    const plugin = state.plugins[0];
    let pluginView: PluginView | undefined;
    const view = {
      get state() { return state; },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
        pluginView?.update?.(view as unknown as EditorView);
      },
    } as unknown as EditorView;
    const listener = vi.fn();

    const unsubscribe = subscribeToDocumentStructureIndex(view, listener);
    pluginView = plugin.spec.view?.(view);
    view.dispatch(state.tr.insertText(' updated', 4));
    vi.advanceTimersByTime(STRUCTURE_INDEX_REBUILD_DELAY_MS);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].headings[0]?.title).toBe('One updated');

    unsubscribe();
    pluginView?.destroy?.();
  });

  it('still rejects subscriptions when the structure-index state plugin is absent', () => {
    const schema = getSchema([StarterKit]);
    const state = EditorState.create({ schema });
    const view = { state } as unknown as EditorView;

    expect(() => subscribeToDocumentStructureIndex(view, vi.fn()))
      .toThrow('Document structure index plugin is not registered');
  });

  it('drops a pending subscription that is cancelled before the plugin view mounts', () => {
    vi.useFakeTimers();
    let state = createState();
    const plugin = state.plugins[0];
    let pluginView: PluginView | undefined;
    const view = {
      get state() { return state; },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
        pluginView?.update?.(view as unknown as EditorView);
      },
    } as unknown as EditorView;
    const listener = vi.fn();

    const unsubscribe = subscribeToDocumentStructureIndex(view, listener);
    unsubscribe();
    pluginView = plugin.spec.view?.(view);
    view.dispatch(state.tr.insertText(' updated', 4));
    vi.advanceTimersByTime(STRUCTURE_INDEX_REBUILD_DELAY_MS);

    expect(listener).not.toHaveBeenCalled();
    pluginView?.destroy?.();
  });

  it('wires runtime localization and keyboard semantics into generated editor widgets', () => {
    const runtime = {
      ...NOOP_EDITOR_EXTENSION_RUNTIME,
      translate: vi.fn((key: Parameters<typeof NOOP_EDITOR_EXTENSION_RUNTIME.translate>[0]) => `translated:${key}`),
    };
    const extensions = createTiptapExtensions(runtime);
    const codeBlock = extensions.find((extension) => extension.name === 'codeBlock');
    const sectionFold = extensions.find((extension) => extension.name === 'sectionFold');
    expect(codeBlock?.options.runtime).toBe(runtime);
    expect(sectionFold?.options.runtime.translate('toc.expand')).toBe('translated:toc.expand');

    const schema = getSchema(extensions);
    const plugins = sectionFold?.config.addProseMirrorPlugins?.call(sectionFold) ?? [];
    const state = EditorState.create({
      schema,
      plugins,
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [{
          type: 'heading',
          attrs: { level: 1, id: 'accessible-heading' },
          content: [{ type: 'text', text: 'Accessible heading' }],
        }],
      }),
    });
    const decorations = plugins[0]?.props.decorations?.(state);
    const widget = decorations?.find().find((decoration) => decoration.from === 1);
    const attributes = new Map<string, string>();
    const control = {
      className: '',
      textContent: '',
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      classList: { contains: (name: string) => name === 'fold-toggle' },
      parentElement: { tagName: 'H1' },
      focus: vi.fn(),
    };
    vi.stubGlobal('document', { createElement: () => control });
    const toDOM = (widget?.type as unknown as { toDOM?: () => unknown }).toDOM;
    expect(toDOM).toBeTypeOf('function');
    toDOM?.();

    expect(Object.fromEntries(attributes)).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-expanded': 'true',
      'aria-label': 'translated:toc.collapse',
    });

    const dispatch = vi.fn();
    const view = {
      state,
      posAtDOM: () => 1,
      dispatch,
    } as unknown as EditorView;
    const keydown = plugins[0]?.props.handleDOMEvents?.keydown;
    for (const key of ['Enter', ' ']) {
      const event = {
        key,
        target: control,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as KeyboardEvent;
      expect(keydown?.(view, event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
