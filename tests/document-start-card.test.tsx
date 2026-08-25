import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DocumentStartCard } from '../shared/editor/components/DocumentStartCard';
import { EditorI18nProvider } from '../shared/editor/i18n';

describe('empty-document start card', () => {
  it('offers create-from-template, start empty, and open existing actions in both locales', () => {
    const onCreateFromTemplate = vi.fn();
    const english = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <DocumentStartCard
          onStartEmpty={vi.fn()}
          onCreateFromTemplate={onCreateFromTemplate}
          onOpenExisting={vi.fn()}
        />
      </EditorI18nProvider>,
    );
    const korean = renderToStaticMarkup(
      <EditorI18nProvider locale="ko">
        <DocumentStartCard
          onStartEmpty={vi.fn()}
          onCreateFromTemplate={onCreateFromTemplate}
          onOpenExisting={vi.fn()}
        />
      </EditorI18nProvider>,
    );

    expect(english).toContain('Create from template');
    expect(english).toContain('Start empty');
    expect(english).toContain('Open existing document');
    expect(english).toContain('do not yet bundle images');
    expect(korean).toContain('템플릿으로 만들기');
    expect(korean).toContain('빈 문서로 시작');
    expect(korean).toContain('기존 문서 열기');
    expect(onCreateFromTemplate).not.toHaveBeenCalled();
  });
});
