import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  filterTemplateCatalog,
  getTemplateCategories,
  selectedTemplateAfterFiltering,
  TemplatePanel,
} from '../shared/editor/components/TemplatePanel';
import { validateTemplateMetadata } from '../shared/editor/components/TemplateDialogs';
import { createTemplateSessionState } from '../shared/editor/templateSession';
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
      htmlPreview: '<!DOCTYPE html><html><body><p>Overview</p></body></html>',
      replacement: {
        replacesBody: true,
        settingsKeys: ['captionStyle'],
        assets: 'none',
      },
    },
  },
];

const renderPanel = (
  diagnostics: readonly TemplateCatalogDiagnosticView[] = [],
  locale: 'en' | 'ko' = 'en',
): string => renderToStaticMarkup(
  <EditorI18nProvider locale={locale}>
    <TemplatePanel
      session={{ ...createTemplateSessionState(), templates, diagnostics, catalog: { phase: 'ready', requestId: 'catalog' } }}
      dispatch={vi.fn()}
      onCreateNew={vi.fn()}
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
    expect(markup.indexOf('Template results')).toBeLessThan(markup.indexOf('Create new document'));
    expect(markup.indexOf('Create new document')).toBeLessThan(markup.indexOf('Replace current document'));
    expect(markup.indexOf('Replace current document')).toBeLessThan(
      markup.indexOf('Save current document as my template'),
    );
    expect(markup).toContain('<details class="template-personal-management">');
    expect(markup).toContain('Shared storage on this PC · ~/.sdoc/templates');
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
          session={{ ...createTemplateSessionState(), templates, personalRootScope: 'remote', catalog: { phase: 'ready', requestId: 'catalog' } }}
          dispatch={vi.fn()}
          onCreateNew={vi.fn()}
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
    expect(markup).toContain('class="template-apply-primary" disabled="">Create new document');
    expect(markup).toContain('Replace current document');
    expect(markup).toContain('Remote Extension Host storage · ~/.sdoc/templates');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('validates and trims metadata before sending it to a host', () => {
    expect(validateTemplateMetadata({
      name: '  Report  ', description: '  Notes  ', category: '  Work  ',
    }, { name: 'name', description: 'description', category: 'category' }).value).toEqual({
      name: 'Report', description: 'Notes', category: 'Work',
    });
    expect(validateTemplateMetadata({ name: ' ' }, {
      name: 'name', description: 'description', category: 'category',
    }).errors.name).toBe('name');
    expect(validateTemplateMetadata({ name: 'Report', description: 'x'.repeat(2_001) }, {
      name: 'name', description: 'description', category: 'category',
    }).errors.description).toBe('description');
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

  it('keeps browsing and apply available while exposing per-action disabled reasons', () => {
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <TemplatePanel
          session={{
            ...createTemplateSessionState(),
            templates,
            selectedId: 'user:11111111-1111-4111-8111-111111111111',
            catalog: { phase: 'ready', requestId: 'catalog' },
          }}
          dispatch={vi.fn()}
          capabilities={{
            apply: { available: true },
            save: { available: false, reason: 'Saving is managed by this host.' },
            update: { available: false, reason: 'Editing is unavailable.' },
            duplicate: { available: false, reason: 'Duplication is unavailable.' },
            delete: { available: false, reason: 'Deletion is unavailable.' },
            openFolder: { available: false, reason: 'Folder access is unavailable.' },
          }}
          onApply={vi.fn()}
        />
      </EditorI18nProvider>,
    );

    expect(markup).toContain('Template results');
    expect(markup).toContain('Create new document');
    expect(markup).toContain('Replace current document');
    expect(markup).toContain('aria-disabled="true" aria-describedby=');
    expect(markup).toContain('Saving is managed by this host.');
    expect(markup).toContain('Folder access is unavailable.');
    expect(markup).toContain('Editing is unavailable.');
    expect(markup).toContain('Duplication is unavailable.');
    expect(markup).toContain('Deletion is unavailable.');
  });
});
