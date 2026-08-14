import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ZoomBar } from '../shared/editor/components/ZoomBar';
import { EditorI18nProvider } from '../shared/editor/i18n';
import type { ReadingWidthId } from '../shared/editor/readingWidth';

const renderZoomBar = (
  zoom: number,
  readingWidth: ReadingWidthId = 'wide',
): string => renderToStaticMarkup(
  <EditorI18nProvider locale="en">
    <ZoomBar
      zoom={zoom}
      onZoomChange={vi.fn()}
      readingWidth={readingWidth}
      onReadingWidthChange={vi.fn()}
    />
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

  it('exposes a compact host-local reading-width control next to zoom', () => {
    const markup = renderZoomBar(100, 'wide');

    expect(markup).toContain('aria-label="Reading width"');
    expect(markup).toContain('title="Reading width for this host only. Does not change the document."');
    expect(markup).toContain('class="zoom-reading-width"');
    expect(markup).toContain('<option value="narrow">Narrow</option>');
    expect(markup).toContain('<option value="comfortable">Comfy</option>');
    expect(markup).toContain('<option value="wide" selected="">Wide</option>');
    expect(markup).toContain('<option value="full">Full</option>');
  });

  it('marks a non-default reading width even when zoom is 100%', () => {
    const markup = renderZoomBar(100, 'full');

    expect(markup).toContain('class="editor-zoom-bar is-non-default"');
    expect(markup).toContain('<option value="full" selected="">Full</option>');
  });
});
