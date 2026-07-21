import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { PanelEmptyState } from '../shared/editor/components/PanelEmptyState';
import { createTiptapExtensions } from '../shared/editor/extensions/tiptapExtensions';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionRuntime,
} from '../shared/editor/extensionRuntime';
import { assertPersistedDocument } from '../shared/document/documentContract';
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

describe('shared editor core', () => {
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
