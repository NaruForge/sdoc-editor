import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  filterTemplateCatalog,
  getTemplateCategories,
  selectedTemplateAfterFiltering,
  TemplatePanel,
} from '../shared/editor/components/TemplatePanel';
import { EditorI18nProvider } from '../shared/editor/i18n';
import type { TemplateCatalogDiagnosticView } from '../shared/template/catalogView';
import type { ManagedTemplateDescriptor } from '../shared/types/messages';

const templates: ManagedTemplateDescriptor[] = [
  {
    id: 'builtin:technical-report',
    name: 'Technical report',
    description: 'Record technical analysis results.',
    category: 'report',
    source: 'builtin',
    sourceLabel: 'Structured Doc Editor',
  },
  {
    id: 'workspace:team',
    name: 'Team design',
    description: 'A shared product specification.',
    category: 'design',
    source: 'workspace',
    sourceLabel: 'Workspace · C:\\secret\\project\\.sdoc\\templates\\team.sdoc',
  },
  {
    id: 'user:11111111-1111-4111-8111-111111111111',
    name: 'My brief',
    category: 'design',
    source: 'user',
    sourceLabel: 'Local · C:\\Users\\test\\.sdoc\\templates',
    revisionToken: 'fingerprint',
    preview: {
      templateId: 'user:11111111-1111-4111-8111-111111111111',
      outline: [{ id: 'h1', level: 1, text: 'Overview', numbered: true, isTitle: false }],
      counts: {
        headings: 1,
        paragraphs: 2,
        tables: 1,
        figures: 0,
        equations: 0,
        diagrams: 0,
        codeBlocks: 0,
      },
      settingsKeys: ['captionStyle'],
      truncated: false,
    },
  },
];

const renderPanel = (
  diagnostics: readonly TemplateCatalogDiagnosticView[] = [],
  locale: 'en' | 'ko' = 'en',
): string => renderToStaticMarkup(
  <EditorI18nProvider locale={locale}>
    <TemplatePanel
      templates={templates}
      diagnostics={diagnostics}
      isApplying={false}
      isManaging={false}
      personalRootScope="local"
      onApply={vi.fn()}
      onRefresh={vi.fn()}
      onSaveCurrent={vi.fn()}
      onEdit={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onOpenPersonalFolder={vi.fn()}
    />
  </EditorI18nProvider>,
);

describe('template side panel UI', () => {
  it('orders discovery before results, apply, and collapsed personal management', () => {
    const markup = renderPanel();

    expect(markup.indexOf('Search templates')).toBeLessThan(markup.indexOf('Template results'));
    expect(markup.indexOf('Template results')).toBeLessThan(markup.indexOf('Apply template'));
    expect(markup.indexOf('Apply template')).toBeLessThan(
      markup.indexOf('Save current document as my template'),
    );
    expect(markup).toContain('<details class="template-personal-management">');
    expect(markup).toContain('Local · ~/.sdoc/templates');
  });

  it('intersects search, source, and category without indexing a source path', () => {
    expect(filterTemplateCatalog(templates, {
      query: 'product',
      source: 'workspace',
      category: 'design',
    }).map((template) => template.id)).toEqual(['workspace:team']);

    expect(filterTemplateCatalog(templates, {
      query: 'secret',
      source: 'all',
      category: 'all',
    })).toEqual([]);

    expect(filterTemplateCatalog(templates, {
      query: 'brief',
      source: 'workspace',
      category: 'design',
    })).toEqual([]);
  });

  it('derives categories from the active source and clears a filtered-out selection', () => {
    expect(getTemplateCategories(templates, 'all')).toEqual(['design', 'report']);
    expect(getTemplateCategories(templates, 'builtin')).toEqual(['report']);
    expect(selectedTemplateAfterFiltering('workspace:team', [templates[0]])).toBeUndefined();
    expect(selectedTemplateAfterFiltering('workspace:team', [templates[1]])).toBe('workspace:team');
  });

  it('uses native selectable buttons for click, Enter, and Space without auto-apply', () => {
    const onApply = vi.fn();
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <TemplatePanel
          templates={templates}
          isApplying={false}
          isManaging={false}
          personalRootScope="remote"
          onApply={onApply}
          onRefresh={vi.fn()}
          onSaveCurrent={vi.fn()}
          onEdit={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          onOpenPersonalFolder={vi.fn()}
        />
      </EditorI18nProvider>,
    );

    expect(markup.match(/class="template-select-row"/g)).toHaveLength(templates.length);
    expect(markup).toContain(
      '<button type="button" class="template-select-row" aria-pressed="false">',
    );
    expect(markup).toContain(
      '<button type="button" class="template-apply-primary" disabled="">Apply template</button>',
    );
    expect(markup).toContain('Remote · ~/.sdoc/templates');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('renders structured diagnostics with recovery and correct singular copy', () => {
    const markup = renderPanel([{
      id: 'diagnostic-1',
      code: 'read-failed',
      source: 'workspace',
      severity: 'error',
      targetLabel: 'broken.sdoc',
      detail: 'The template could not be read.',
      recovery: 'retry',
    }]);

    expect(markup).toContain('1 template could not be loaded.');
    expect(markup).toContain('Show diagnostic details');
    expect(markup).toContain('broken.sdoc');
    expect(markup).toContain('read-failed');
    expect(markup).toContain('Refresh the catalog to try again.');
    expect(markup).toContain('Retry');
  });

  it('never exposes absolute paths from descriptor source labels or personal storage', () => {
    const markup = renderPanel();

    expect(markup).not.toContain('C:\\');
    expect(markup).not.toContain('/Users/');
    expect(markup).not.toContain('secret');
    expect(markup).toContain('~/.sdoc/templates');
  });
});
