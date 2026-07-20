import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PanelEmptyState } from '../shared/editor/components/PanelEmptyState';
import { createTiptapExtensions } from '../shared/editor/extensions/tiptapExtensions';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionRuntime,
} from '../shared/editor/extensionRuntime';

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
