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
  {
    id: 'user:11111111-1111-4111-8111-111111111111',
    name: '내 설계서',
    category: 'design',
    source: 'user' as const,
    sourceLabel: '로컬 · C:\\Users\\test\\.sdoc\\templates',
    revisionToken: 'fingerprint',
    preview: {
      templateId: 'user:11111111-1111-4111-8111-111111111111',
      outline: [{ id: 'h1', level: 1, text: '개요', numbered: true, isTitle: false }],
      counts: {
        headings: 1, paragraphs: 2, tables: 1, figures: 0,
        equations: 0, diagrams: 0, codeBlocks: 0,
      },
      settingsKeys: ['captionStyle'],
      truncated: false,
    },
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
      isManaging: false,
      personalRootPath: 'C:\\Users\\test\\.sdoc\\templates',
      personalRootScope: 'local',
      onApply: vi.fn(),
      onRefresh: vi.fn(),
      onSaveCurrent: vi.fn(),
      onEdit: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
      onOpenPersonalFolder: vi.fn(),
    }));

    expect(markup).toContain('기술 보고서');
    expect(markup).toContain('팀 설계서');
    expect(markup).toContain('내장');
    expect(markup).toContain('작업공간');
    expect(markup).toContain('템플릿 적용');
    expect(markup).toContain('현재 문서를 내 템플릿으로 저장');
    expect(markup).toContain('전체');
    expect(markup).toContain('내 템플릿');
    expect(markup).toContain('미리보기');
    expect(markup).toContain('design');
    expect(markup).toContain('수정');
    expect(markup).toContain('복제');
    expect(markup).toContain('삭제');
    expect(markup).not.toContain('빈 문서로 시작');
  });
});
