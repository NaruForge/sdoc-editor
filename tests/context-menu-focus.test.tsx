import React, { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContextMenu } from '../shared/editor/components/EditorContextMenu';
import { ImageContextMenu } from '../shared/editor/components/ImageContextMenu';
import { TableContextMenu } from '../shared/editor/components/TableContextMenu';
import {
  menuKeyIntent,
  nextMenuIndex,
} from '../shared/editor/components/ui/Menu';
import { EditorI18nProvider } from '../shared/editor/i18n';

const position = { x: 10, y: 20 };
const returnFocusRef = createRef<HTMLButtonElement>();

describe('context menu focus contract', () => {
  it('calculates wrapped roving focus for arrows, Home, and End', () => {
    expect(nextMenuIndex(-1, 'ArrowDown', 4)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowUp', 4)).toBe(3);
    expect(nextMenuIndex(3, 'ArrowDown', 4)).toBe(0);
    expect(nextMenuIndex(2, 'Home', 4)).toBe(0);
    expect(nextMenuIndex(1, 'End', 4)).toBe(3);
    expect(nextMenuIndex(0, 'ArrowDown', 0)).toBe(-1);
  });

  it('distinguishes Escape, Tab, and Shift+Tab dismissal from roving keys', () => {
    expect(menuKeyIntent('Escape')).toBe('escape');
    expect(menuKeyIntent('Tab')).toBe('tab-forward');
    expect(menuKeyIntent('Tab', true)).toBe('tab-backward');
    expect(menuKeyIntent('ArrowDown')).toBe('navigate');
    expect(menuKeyIntent('Enter')).toBe('none');
  });

  it('renders the image menu as one labelled menu with roving menuitems', () => {
    const markup = renderToStaticMarkup(
      <ImageContextMenu
        position={position}
        onClose={vi.fn()}
        onOpenProperties={vi.fn()}
        onReplaceImage={vi.fn()}
        onCopyPath={vi.fn()}
        onDelete={vi.fn()}
        isDrawio={false}
        returnFocusRef={returnFocusRef}
      />,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('aria-label="Image actions"');
    expect(markup.match(/role="menuitem"/g)).toHaveLength(4);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(4);
    expect(markup).toContain('role="separator"');
  });

  it('renders every table action as a menuitem and separators as separators', () => {
    const markup = renderToStaticMarkup(
      <TableContextMenu
        editor={{} as TiptapEditor}
        position={position}
        onClose={vi.fn()}
        onOpenProperties={vi.fn()}
        returnFocusRef={returnFocusRef}
      />,
    );

    expect(markup).toContain('aria-label="Table actions"');
    expect(markup.match(/role="menuitem"/g)).toHaveLength(10);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(10);
    expect(markup.match(/role="separator"/g)).toHaveLength(3);
  });

  it('exposes editor submenu triggers through menu ARIA without adding Tab stops', () => {
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <EditorContextMenu
          position={position}
          editor={{} as TiptapEditor}
          onInsertImage={vi.fn()}
          onInsertDrawio={vi.fn()}
          onInsertEquation={vi.fn()}
          onInsertTable={vi.fn()}
          onClose={vi.fn()}
          returnFocusRef={returnFocusRef}
        />
      </EditorI18nProvider>,
    );

    expect(markup).toContain('role="menu"');
    expect(markup.match(/role="menuitem"/g)).toHaveLength(7);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(7);
    expect(markup.match(/aria-haspopup="menu"/g)).toHaveLength(2);
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(2);
  });
});
