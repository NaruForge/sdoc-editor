import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DiagramRendererConsentPanel } from '../shared/editor/components/DiagramRendererConsentPanel';
import { DiagramRendererSettingsPanel } from '../shared/editor/components/DiagramRendererSettingsPanel';
import { EditorI18nProvider } from '../shared/editor/i18n';

const settings = {
  consent: 'undecided' as const,
  endpoint: 'https://kroki.example.test',
  allowPrivateNetwork: false,
};

describe('diagram renderer consent UI', () => {
  it('exposes an inline labelled region with the endpoint and three distinct choices', () => {
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <DiagramRendererConsentPanel
          settings={settings}
          language="plantuml"
          onDecision={vi.fn(async () => undefined)}
          onCancel={vi.fn()}
        />
      </EditorI18nProvider>,
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('https://kroki.example.test');
    expect(markup).toContain('plantuml source');
    expect(markup).toContain('Not now');
    expect(markup).toContain('Use source only');
    expect(markup).toContain('Use online preview');
    expect(markup).not.toContain('role="dialog"');
  });

  it('renders localized Korean consent copy', () => {
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="ko">
        <DiagramRendererConsentPanel
          settings={settings}
          language="graphviz"
          onDecision={vi.fn(async () => undefined)}
        />
      </EditorI18nProvider>,
    );

    expect(markup).toContain('온라인 다이어그램 미리보기를 사용할까요?');
    expect(markup).toContain('소스만 사용');
    expect(markup).toContain('온라인 미리보기 사용');
  });

  it('uses the dedicated consent callback and disables connection testing until granted', () => {
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <DiagramRendererSettingsPanel
          settings={settings}
          onChange={vi.fn()}
          onResolveConsent={vi.fn(async () => undefined)}
          onTest={vi.fn(async () => undefined)}
        />
      </EditorI18nProvider>,
    );

    expect(markup).toContain('diagram-consent-card');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Test connection<\/button>/);
  });
});
