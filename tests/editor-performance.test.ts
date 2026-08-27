import { describe, expect, it, vi } from 'vitest';
import { Extension, getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView, PluginView } from '@tiptap/pm/view';
import {
  buildOutlinePresentationIndex,
  createDocumentStructureIndexPlugin,
  findActivePosition,
  getDocumentStructureIndexState,
  resolveStructurePosition,
  subscribeToDocumentStructureIndex,
} from '../shared/editor/structureIndex';
import { applyEditorSettingsCss } from '../shared/editor/applyEditorSettingsCss';
import { resolveEditorSettings } from '../shared/settingsResolver';
import { isUpdatedDrawioAsset } from '../shared/editor/drawioUpdates';
import { Endnote } from '../shared/editor/extensions/Endnote';
import { buildEndnoteViewItems } from '../shared/editor/components/EndnoteList';

describe('large document structure lookup', () => {
  it('maps 100 ordinary paragraph transactions without rebuilding or publishing semantics', () => {
    const stableHeadingIds = Extension.create({
      name: 'stableHeadingIds',
      addGlobalAttributes() {
        return [{ types: ['heading'], attributes: { id: { default: null } } }];
      },
    });
    const schema = getSchema([StarterKit, stableHeadingIds, Endnote]);
    const settings = resolveEditorSettings();
    const plugin = createDocumentStructureIndexPlugin({ getSettings: () => settings });
    const blocks = Array.from({ length: 10_000 }, () => schema.node('paragraph'));
    blocks[1] = schema.node('paragraph', null, [
      schema.node('endnote', { id: 'stable-endnote', body: 'Stable note' }),
    ]);
    blocks.push(schema.node('heading', {
      level: 1,
      id: 'stable-heading',
      numbered: null,
    }, schema.text('Stable heading')));
    let state = EditorState.create({
      schema,
      plugins: [plugin],
      doc: schema.node('doc', null, blocks),
    });
    const initial = getDocumentStructureIndexState(state);
    const initialPosition = resolveStructurePosition(state, 'stable-heading');
    const initialEndnotePosition = resolveStructurePosition(state, 'stable-endnote');
    let pluginView: PluginView | undefined;
    const view = {
      get state() { return state; },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
        pluginView?.update?.(view as unknown as EditorView);
      },
    } as unknown as EditorView;
    pluginView = plugin.spec.view?.(view);
    const endnoteProjection = vi.fn(buildEndnoteViewItems);
    endnoteProjection(initial.endnotes);
    const semanticUpdates = vi.fn((index: typeof initial) => {
      endnoteProjection(index.endnotes);
    });
    const unsubscribe = subscribeToDocumentStructureIndex(view, semanticUpdates);

    for (let index = 0; index < 100; index += 1) {
      view.dispatch(state.tr.insertText('x', 1));
    }

    const current = getDocumentStructureIndexState(state);
    expect(current.rebuildCount).toBe(initial.rebuildCount);
    expect(current.semanticRevision).toBe(initial.semanticRevision);
    expect(semanticUpdates).not.toHaveBeenCalled();
    expect(endnoteProjection).toHaveBeenCalledOnce();
    expect(resolveStructurePosition(state, 'stable-heading')).toBe(initialPosition! + 100);
    expect(resolveStructurePosition(state, 'stable-endnote')).toBe(initialEndnotePosition! + 100);

    unsubscribe();
    pluginView?.destroy?.();
  });

  it('finds active structural entries without rescanning document nodes', () => {
    const positions = Array.from({ length: 5_000 }, (_, index) => index * 10);
    for (let cursor = 0; cursor < 1_000; cursor += 10) {
      expect(findActivePosition(positions, cursor + 7)).toBe(cursor);
    }
    expect(findActivePosition(positions, -1)).toBe(-1);
    expect(findActivePosition(positions, 100_000)).toBe(49_990);
  });

  it('indexes a large collapsed outline in a single linear pass', () => {
    const entries = Array.from({ length: 50_000 }, (_, index) => ({
      level: index % 5 + 1,
      pos: index * 10,
    }));
    const index = buildOutlinePresentationIndex(entries, new Set([0, 50_000]));

    expect(index.hasChildren).toHaveLength(entries.length);
    expect(index.visible).toHaveLength(entries.length);
    expect(index.hasChildren[0]).toBe(true);
    expect(index.visible[0]).toBe(true);
    expect(index.visible[1]).toBe(false);
    expect(index.visible[5]).toBe(true);
    expect(index.visible[5_001]).toBe(false);
  });
});

describe('Draw.io update identity', () => {
  it('does not match another nested asset with the same basename', () => {
    expect(isUpdatedDrawioAsset('./drawio/a/system.drawio.svg', './drawio/a/system.drawio.svg')).toBe(true);
    expect(isUpdatedDrawioAsset('./drawio/b/system.drawio.svg', './drawio/a/system.drawio.svg')).toBe(false);
    expect(isUpdatedDrawioAsset(undefined, './drawio/a/system.drawio.svg')).toBe(false);
  });
});

describe('shared host editor styling', () => {
  it('applies the same resolved font weights through the shared controller', () => {
    const values = new Map<string, string>();
    const editorTarget = {
      style: { setProperty: (name: string, value: string) => { values.set(name, value); } },
      dataset: {},
    };
    const rootValues = new Map<string, string>();
    const rootTarget = { style: { setProperty: (name: string, value: string) => { rootValues.set(name, value); } } };
    const settings = {
      ...resolveEditorSettings(),
      headingH1Color: '#111111', headingH2Color: '#222222', headingH3Color: '#333333',
      headingH4Color: '#444444', headingH5Color: '#555555', headingH6Color: '#666666',
      fontWeightBody: 450, fontWeightBold: 750, fontWeightH1: 800, fontWeightH2: 650, fontWeightH3: 550,
    };
    applyEditorSettingsCss(editorTarget, rootTarget, settings);
    expect(Object.fromEntries(values)).toMatchObject({
      '--heading-h1-color': '#111111', '--heading-h2-color': '#222222', '--heading-h3-color': '#333333',
      '--heading-h4-color': '#444444', '--heading-h5-color': '#555555', '--heading-h6-color': '#666666',
      '--font-weight-body': '450', '--font-weight-bold': '750', '--font-weight-h1': '800',
      '--font-weight-h2': '650', '--font-weight-h3': '550',
    });
    expect(rootValues.get('--font-weight-h1')).toBe('800');
  });
});
