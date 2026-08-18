import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { PanelEmptyState } from '../shared/editor/components/PanelEmptyState';
import {
  DocumentSettingsPanel,
  mergeDocumentSetting,
} from '../shared/editor/components/DocumentSettingsPanel';
import { Toolbar } from '../shared/editor/components/Toolbar';
import { HEADING_COLOR_PRESETS } from '../shared/editor/constants/colors';
import { HEADING_LEVELS, nextHeadingMenuIndex } from '../shared/editor/constants/headings';
import { EditorProvider } from '../shared/editor/context/EditorContext';
import { createTiptapExtensions } from '../shared/editor/extensions/tiptapExtensions';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionRuntime,
} from '../shared/editor/extensionRuntime';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { inspectDocumentBytes } from '../shared/document/operations';
import { wrapSdoc } from '../shared/document/sdocUtils';
import { dehydrateDocumentAssets } from '../shared/document/runtimeAssets';

function createRuntime(): EditorExtensionRuntime {
  return {
    ...NOOP_EDITOR_EXTENSION_RUNTIME,
    flush: vi.fn(),
    openImageContextMenu: vi.fn(),
    openMathDialog: vi.fn(),
    openDiagramDialog: vi.fn(),
    openDocument: vi.fn(),
    openDrawio: vi.fn(),
  };
}

function blockIdentityPlugins() {
  const extensions = createTiptapExtensions(createRuntime());
  const extension = extensions.find((candidate) => candidate.name === 'blockIdentity');
  return {
    extensions,
    plugins: extension?.config.addProseMirrorPlugins?.call(extension) ?? [],
  };
}

describe('shared editor core', () => {
  it('renders exactly four circular heading color controls with a rainbow custom picker', () => {
    const markup = renderToStaticMarkup(
      <EditorProvider>
        <DocumentSettingsPanel onUpdateSettings={vi.fn()} />
      </EditorProvider>,
    );

    expect(HEADING_COLOR_PRESETS).toEqual([
      { label: '파란 계열', value: '#2563EB' },
      { label: 'LG 헤리티지 레드', value: '#A50034' },
      { label: '검정색', value: '#000000' },
    ]);
    expect(markup.match(/class="settings-heading-color-swatch[^"]*"/g))
      .toHaveLength(HEADING_LEVELS.length * 4);
    expect(markup.match(/class="settings-heading-color-swatch settings-heading-color-custom-button/g))
      .toHaveLength(HEADING_LEVELS.length);
    expect(markup.match(/type="color"/g)).toHaveLength(HEADING_LEVELS.length);
    expect(markup).not.toContain('settings-color-value');

    for (const level of HEADING_LEVELS) {
      expect(markup).toContain(`H${level} color`);
      expect(markup).toContain(`aria-label="H${level} Blue palette"`);
      expect(markup).toContain(`aria-label="H${level} LG heritage red"`);
      expect(markup).toContain(`aria-label="H${level} Black"`);
      expect(markup).toContain(`aria-label="Custom H${level} color"`);
      expect(markup).toContain(`aria-label="Custom H${level} color"`);
    }

    const cssPath = fileURLToPath(new URL('../shared/editor/styles/editor.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.settings-heading-color-swatch\s*\{[^}]*border-radius:\s*50%/s);
    expect(css).toMatch(/\.settings-heading-color-custom-button\s*\{[^}]*conic-gradient/s);
  });

  it('preserves earlier document overrides across rapid setting changes', () => {
    const h4 = mergeDocumentSetting(null, 'headingH4Color', '#ef4444');
    const h4AndH5 = mergeDocumentSetting(h4, 'headingH5Color', '#22c55e');

    expect(h4AndH5).toMatchObject({
      headingH4Color: '#ef4444',
      headingH5Color: '#22c55e',
    });
  });

  it('uses one Heading toolbar trigger for all six heading levels', () => {
    const editor = {
      isActive: vi.fn(() => false),
      getAttributes: vi.fn(() => ({})),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as TiptapEditor;
    const markup = renderToStaticMarkup(
      <EditorProvider>
        <Toolbar editor={editor} />
      </EditorProvider>,
    );

    expect(HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);
    expect(markup).toContain('aria-label="Heading"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain('title="제목 1 (H1)"');
  });

  it('wraps keyboard navigation across every Heading menu item', () => {
    const itemCount = HEADING_LEVELS.length + 1;
    expect(nextHeadingMenuIndex(-1, 'ArrowDown', itemCount)).toBe(0);
    expect(nextHeadingMenuIndex(0, 'ArrowUp', itemCount)).toBe(itemCount - 1);
    expect(nextHeadingMenuIndex(itemCount - 1, 'ArrowDown', itemCount)).toBe(0);
    expect(nextHeadingMenuIndex(3, 'Home', itemCount)).toBe(0);
    expect(nextHeadingMenuIndex(3, 'End', itemCount)).toBe(itemCount - 1);
  });

  it('maps every heading level to its own runtime color variable', () => {
    const cssPath = fileURLToPath(new URL('../shared/editor/styles/editor.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');

    for (const level of HEADING_LEVELS) {
      const selector = new RegExp(`h${level}::before\\s*\\{([^}]+)\\}`);
      expect(css.match(selector)?.[1]).toContain(`var(--heading-h${level}-color`);
    }
  });

  it('builds one host-neutral extension set with the injected runtime', () => {
    const runtime = createRuntime();
    const extensions = createTiptapExtensions(runtime);
    const names = extensions.map((extension) => extension.name);

    expect(names).toEqual(expect.arrayContaining([
      'image',
      'table',
      'mathInline',
      'mathBlock',
      'diagram',
      'crossReference',
      'internalLinkClick',
    ]));
    const imageRuntime = extensions.find((extension) => extension.name === 'image')?.options.runtime as EditorExtensionRuntime;
    const tableRuntime = extensions.find((extension) => extension.name === 'table')?.options.runtime as EditorExtensionRuntime;
    imageRuntime.openDrawio('diagram.drawio.svg');
    tableRuntime.flush();
    expect(runtime.openDrawio).toHaveBeenCalledWith('diagram.drawio.svg');
    expect(runtime.flush).toHaveBeenCalledOnce();
  });

  it('registers persisted ids for every referenceable Tiptap node', () => {
    const schema = getSchema(createTiptapExtensions(createRuntime()));

    expect(schema.nodes.heading.spec.attrs).toHaveProperty('id');
    expect(schema.nodes.image.spec.attrs).toHaveProperty('id');
    expect(schema.nodes.table.spec.attrs).toHaveProperty('id');
    expect(schema.nodes.mathBlock.spec.attrs).toHaveProperty('id');

    const roundTripped = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, id: 'heading-custom' }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'image', attrs: { src: './images/a.png', id: 'figure-custom' } },
        { type: 'table', attrs: { id: 'table-custom' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
        { type: 'mathBlock', attrs: { latex: 'x=1', id: 'eq-custom' } },
      ],
    }).toJSON();
    expect(roundTripped.content?.map((node) => node.attrs?.id)).toEqual([
      'heading-custom', 'figure-custom', 'table-custom', 'eq-custom',
    ]);
    expect(() => assertPersistedDocument(wrapSdoc(dehydrateDocumentAssets(roundTripped), {}))).not.toThrow();
  });

  it('round-trips optional identities without materializing absent ids', () => {
    const schema = getSchema(createTiptapExtensions(createRuntime()));
    for (const type of [
      'paragraph', 'bulletList', 'orderedList', 'listItem', 'taskList',
      'codeBlock', 'blockquote', 'callout', 'diagram', 'horizontalRule',
    ]) {
      expect(schema.nodes[type].spec.attrs).toHaveProperty('id');
    }

    const persisted = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Plain' }] },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Item' }] }],
          }],
        },
        { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'code' }] },
        { type: 'blockquote', content: [{ type: 'paragraph', attrs: { textAlign: null } }] },
        { type: 'horizontalRule' },
      ],
    };
    const editorJson = schema.nodeFromJSON(persisted).toJSON();
    const dehydrated = dehydrateDocumentAssets(editorJson);
    const before = inspectDocumentBytes(JSON.stringify(wrapSdoc(persisted, {})));
    const after = inspectDocumentBytes(JSON.stringify(wrapSdoc(dehydrated, {})));

    expect(dehydrated).toEqual(persisted);
    expect(JSON.stringify(dehydrated)).not.toContain('"id":null');
    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.blocks.map(({ path, digest }) => ({ path, digest })))
        .toEqual(before.blocks.map(({ path, digest }) => ({ path, digest })));
    }
  });

  it('imports non-referenceable identities only from data-id', () => {
    const schema = getSchema(createTiptapExtensions(createRuntime()));
    const paragraphRule = schema.nodes.paragraph.spec.parseDOM?.find((rule) => rule.tag === 'p');
    const parse = paragraphRule && 'getAttrs' in paragraphRule ? paragraphRule.getAttrs : undefined;
    expect(parse).toEqual(expect.any(Function));
    if (typeof parse !== 'function') return;
    const element = (attributes: Record<string, string>) => ({
      getAttribute: (name: string) => attributes[name] ?? null,
      style: { textAlign: '' },
    }) as HTMLElement;

    expect(parse(element({ id: '123' }))).not.toMatchObject({ id: '123' });
    expect(parse(element({ 'data-id': 'provisional:external' })))
      .not.toMatchObject({ id: 'provisional:external' });
    expect(parse(element({ id: 'not valid', 'data-id': 'tracked-1' })))
      .toMatchObject({ id: 'tracked-1' });
    const unicodeAttrs = parse(element({ 'data-id': '개요' }));
    expect(unicodeAttrs).toMatchObject({ id: '개요' });
    const persisted = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: unicodeAttrs,
        content: [{ type: 'text', text: 'Tracked' }],
      }],
    }).toJSON();
    expect(() => assertPersistedDocument(wrapSdoc(persisted, {}))).not.toThrow();
  });

  it('imports horizontal-rule ids only when they match the historical schema', () => {
    const schema = getSchema(createTiptapExtensions(createRuntime()));
    const horizontalRule = schema.nodes.horizontalRule.spec.parseDOM?.find((rule) => rule.tag === 'hr');
    const parse = horizontalRule && 'getAttrs' in horizontalRule ? horizontalRule.getAttrs : undefined;
    expect(parse).toEqual(expect.any(Function));
    if (typeof parse !== 'function') return;
    const element = (attributes: Record<string, string>) => ({
      getAttribute: (name: string) => attributes[name] ?? null,
    }) as HTMLElement;

    const historicalAttrs = parse(element({ 'data-id': 'rule-1' }));
    expect(historicalAttrs).toMatchObject({ id: 'rule-1' });
    expect(parse(element({ 'data-id': '개요' }))).not.toMatchObject({ id: '개요' });
    expect(parse(element({ 'data-id': '1-rule' }))).not.toMatchObject({ id: '1-rule' });
    expect(parse(element({ 'data-id': 'not valid' }))).not.toMatchObject({ id: 'not valid' });

    const persisted = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'horizontalRule', attrs: historicalAttrs }],
    }).toJSON();
    expect(persisted.content?.[0].attrs?.id).toBe('rule-1');
    expect(() => assertPersistedDocument(wrapSdoc(persisted, {}))).not.toThrow();
  });

  it('strips pasted identity collisions, including historical horizontal-rule ids', () => {
    const { extensions, plugins } = blockIdentityPlugins();
    const schema = getSchema(extensions);
    const state = EditorState.create({
      schema,
      plugins,
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [{ type: 'horizontalRule', attrs: { id: 'shared-id' } }],
      }),
    });
    const pasted = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'shared-id' }, content: [{ type: 'text', text: 'Duplicate' }] },
        { type: 'paragraph', attrs: { id: 'fresh-id' }, content: [{ type: 'text', text: 'Fresh' }] },
        { type: 'paragraph', attrs: { id: 'fresh-id' }, content: [{ type: 'text', text: 'Sibling duplicate' }] },
      ],
    });
    const transform = plugins[0].props.transformPasted;
    expect(transform).toEqual(expect.any(Function));
    if (!transform) return;
    const transformed = transform(
      new Slice(Fragment.fromArray([...pasted.content.content]), 0, 0),
      { state } as never,
    );
    const ids = transformed.content.content.map((node) => node.attrs.id);

    expect(ids).toEqual([undefined, 'fresh-id', undefined]);
  });

  it('retains a shared pasted id on the parent before its descendant', () => {
    const { extensions, plugins } = blockIdentityPlugins();
    const schema = getSchema(extensions);
    const state = EditorState.create({
      schema,
      plugins,
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Existing' }] }],
      }),
    });
    const pasted = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'blockquote',
        attrs: { id: 'nested-id' },
        content: [{
          type: 'paragraph',
          attrs: { id: 'nested-id' },
          content: [{ type: 'text', text: 'Nested duplicate' }],
        }],
      }],
    });
    const transform = plugins[0].props.transformPasted;
    expect(transform).toEqual(expect.any(Function));
    if (!transform) return;
    const transformed = transform(
      new Slice(Fragment.fromArray([...pasted.content.content]), 0, 0),
      { state } as never,
    );
    const parent = transformed.content.firstChild;

    expect(parent?.attrs.id).toBe('nested-id');
    expect(parent?.firstChild?.attrs.id).toBeUndefined();
  });

  it('keeps a stable id on only the first half after splitting a block', () => {
    const { extensions, plugins } = blockIdentityPlugins();
    const schema = getSchema(extensions);
    const state = EditorState.create({
      schema,
      plugins,
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [{
          type: 'paragraph',
          attrs: { id: 'paragraph-1' },
          content: [{ type: 'text', text: 'AB' }],
        }],
      }),
    });
    const applied = state.applyTransaction(state.tr.split(2)).state;

    expect(applied.doc.content.content.map((node) => node.attrs.id))
      .toEqual(['paragraph-1', undefined]);
  });

  it('does not run collision normalization for ordinary paragraph typing', () => {
    const { extensions, plugins } = blockIdentityPlugins();
    const schema = getSchema(extensions);
    const state = EditorState.create({
      schema,
      plugins,
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { id: 'duplicate' }, content: [{ type: 'text', text: 'A' }] },
          { type: 'paragraph', attrs: { id: 'duplicate' }, content: [{ type: 'text', text: 'B' }] },
        ],
      }),
    });
    const applied = state.applyTransaction(state.tr.insertText('x', 2)).state;

    expect(applied.doc.content.content.map((node) => node.attrs.id))
      .toEqual(['duplicate', 'duplicate']);
  });

  it('defaults newly created tables to Auto width while preserving explicit widths', () => {
    const schema = getSchema(createTiptapExtensions(createRuntime()));
    const table = (width?: string) => schema.nodeFromJSON({
      type: 'table',
      ...(width ? { attrs: { width } } : {}),
      content: [{
        type: 'tableRow',
        content: [{
          type: 'tableCell',
          content: [{ type: 'paragraph' }],
        }],
      }],
    }).toJSON();

    expect(table().attrs?.width).toBe('auto');
    for (const width of ['100%', '75%', '50%', 'auto']) {
      expect(table(width).attrs?.width).toBe(width);
    }
  });

  it('assigns ids to newly inserted referenceable nodes before host persistence', () => {
    const extensions = createTiptapExtensions(createRuntime());
    const schema = getSchema(extensions);
    const idExtension = extensions.find((extension) => extension.name === 'persistentNodeIds');
    const plugins = idExtension?.config.addProseMirrorPlugins?.call(idExtension) ?? [];
    const initialDoc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] });
    const nextDoc = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Stable title' }],
      }],
    });
    const state = EditorState.create({ schema, doc: initialDoc, plugins });
    const applied = state.applyTransaction(
      state.tr.replaceWith(0, state.doc.content.size, nextDoc.content),
    ).state;

    const heading = applied.doc.toJSON().content?.find((node) => node.type === 'heading');
    expect(heading?.attrs?.id).toBe('stable-title');
  });

  it('keeps inserted cross-reference links inside the persisted document contract', () => {
    const schema = getSchema(createTiptapExtensions(createRuntime()));
    const roundTripped = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: '1. Target heading',
          marks: [{ type: 'link', attrs: { href: '#target-heading' } }],
        }],
      }],
    }).toJSON();

    expect(roundTripped.content?.[0].content?.[0].marks?.[0].attrs).toMatchObject({
      href: '#target-heading',
      title: null,
    });
    expect(() => assertPersistedDocument(wrapSdoc(roundTripped, {}))).not.toThrow();
  });

  it('provides skipped-level semantic heading numbers as initial node decorations', () => {
    const runtime = createRuntime();
    const extensions = createTiptapExtensions(runtime);
    const schema = getSchema(extensions);
    const semanticExtension = extensions.find((extension) => extension.name === 'semanticNumbering');
    const plugins = semanticExtension?.config.addProseMirrorPlugins?.call(semanticExtension) ?? [];
    const state = EditorState.create({
      schema,
      plugins,
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, id: 'first-heading' },
            content: [{ type: 'text', text: 'First heading' }],
          },
          {
            type: 'heading',
            attrs: { level: 2, id: 'second-heading' },
            content: [{ type: 'text', text: 'Second heading' }],
          },
          {
            type: 'heading',
            attrs: { level: 4, id: 'fourth-heading' },
            content: [{ type: 'text', text: 'Fourth heading' }],
          },
        ],
      }),
    });
    const decorations = plugins[0].props.decorations?.(state) as DecorationSet | undefined;
    const numberLabels = decorations?.find().map((decoration) =>
      (decoration.type as { attrs?: Record<string, string> }).attrs?.['data-number-label'],
    );

    expect(numberLabels).toEqual(['1', '1.1', '1.1.0.1']);
  });

  it('renders the shared panel empty state without a host environment', () => {
    const markup = renderToStaticMarkup(
      <PanelEmptyState title="No figures" message="Insert an image" hint="Use the toolbar" icon={<span>+</span>} />,
    );

    expect(markup).toContain('panel-empty-title');
    expect(markup).toContain('No figures');
    expect(markup).toContain('Use the toolbar');
  });

  it('keeps the image alignment toolbar above the Draw.io double-click target', () => {
    const cssPath = fileURLToPath(new URL('../shared/editor/styles/editor.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');
    const toolbarRule = css.match(/\.image-align-toolbar\s*\{([^}]+)\}/)?.[1] ?? '';

    expect(toolbarRule).toContain('position: absolute');
    expect(toolbarRule).toContain('transform: translate(-50%, calc(-100% - 8px))');
    expect(toolbarRule).not.toContain('top: 50%');
  });
});
