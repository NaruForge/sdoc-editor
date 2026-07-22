import React from '../webview-ui/node_modules/react';
import { renderToStaticMarkup } from '../webview-ui/node_modules/react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EmptyDocumentState } from '../webview-ui/src/components/EmptyDocumentState';

describe('empty SDOC initialization UI', () => {
  it('offers explicit non-modal blank and experimental-template actions', () => {
    const markup = renderToStaticMarkup(
      React.createElement(EmptyDocumentState, {
        onStartBlank: vi.fn(),
        onChooseTemplate: vi.fn(),
      }),
    );

    expect(markup).toContain('<main aria-labelledby="empty-document-title"');
    expect(markup).toContain('빈 문서로 시작');
    expect(markup).toContain('실험적 템플릿 선택…');
    expect(markup).not.toContain('role="dialog"');
  });
});
