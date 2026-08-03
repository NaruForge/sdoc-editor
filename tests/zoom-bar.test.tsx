import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ZoomBar } from '../shared/editor/components/ZoomBar';
import { EditorI18nProvider } from '../shared/editor/i18n';

const renderZoomBar = (zoom: number): string => renderToStaticMarkup(
  <EditorI18nProvider locale="en">
    <ZoomBar zoom={zoom} onZoomChange={vi.fn()} />
  </EditorI18nProvider>,
);

describe('ZoomBar', () => {
  it('keeps the default zoom visually neutral and exposes its percent value', () => {
    const markup = renderZoomBar(100);

    expect(markup).toContain('class="editor-zoom-bar"');
    expect(markup).not.toContain('is-non-default');
    expect(markup).toContain('aria-valuetext="100%"');
  });

  it('marks non-default zoom and exposes the current percent value', () => {
    const markup = renderZoomBar(125);

    expect(markup).toContain('class="editor-zoom-bar is-non-default"');
    expect(markup).toContain('aria-valuetext="125%"');
    expect(markup).toContain('>125%</button>');
  });
});
