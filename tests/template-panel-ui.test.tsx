import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityBar } from '../shared/editor/components/ActivityBar';
import { TemplatePanel } from '../shared/editor/components/TemplatePanel';

const templates = [
  {
    id: 'builtin:technical-report',
    name: '기술 보고서',
    description: '기술 분석 결과를 기록합니다.',
    category: 'report',
    source: 'builtin' as const,
    sourceLabel: 'Structured Doc Editor',
  },
  {
    id: 'workspace:team',
    name: '팀 설계서',
    source: 'workspace' as const,
    sourceLabel: 'Workspace · .sdoc/templates/team.sdoc',
  },
];

describe('template side panel UI', () => {
  it('exposes the template tab only when the host enables it', () => {
    const enabled = renderToStaticMarkup(React.createElement(ActivityBar, {
      activeTab: 'template',
      onTabClick: vi.fn(),
      showTemplates: true,
    }));
    const disabled = renderToStaticMarkup(React.createElement(ActivityBar, {
      activeTab: null,
      onTabClick: vi.fn(),
    }));

    expect(enabled).toContain('템플릿');
    expect(enabled).toContain('aria-pressed="true"');
    expect(disabled).not.toContain('템플릿');
  });

  it('renders built-in and workspace templates as explicit apply actions', () => {
    const markup = renderToStaticMarkup(React.createElement(TemplatePanel, {
      templates,
      isApplying: false,
      onApply: vi.fn(),
      onRefresh: vi.fn(),
    }));

    expect(markup).toContain('실험적 기능');
    expect(markup).toContain('기술 보고서');
    expect(markup).toContain('팀 설계서');
    expect(markup).toContain('내장');
    expect(markup).toContain('워크스페이스');
    expect(markup).toContain('템플릿 적용');
    expect(markup).not.toContain('빈 문서로 시작');
  });
});
