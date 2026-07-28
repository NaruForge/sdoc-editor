import { describe, expect, it } from 'vitest';
import {
  projectTemplateCatalogDiagnostic,
  projectTemplateCatalogDiagnostics,
  sanitizeTemplateDiagnosticTarget,
} from '../shared/template/catalogView';
import type { TemplateDiagnostic } from '../shared/template/types';

describe('template catalog diagnostic view', () => {
  it('projects a filesystem diagnostic without raw paths or raw messages', () => {
    const diagnostic: TemplateDiagnostic = {
      code: 'read-failed',
      targetPath: 'C:\\Users\\alice\\private\\.sdoc\\templates\\broken.sdoc',
      message: 'EACCES at C:\\Users\\alice\\private\\.sdoc\\templates\\broken.sdoc',
      path: '/content/0',
    };

    const view = projectTemplateCatalogDiagnostic(diagnostic, 'user');

    expect(view).toMatchObject({
      code: 'read-failed',
      source: 'user',
      severity: 'error',
      targetLabel: 'broken.sdoc',
      jsonPath: '/content/0',
      detail: 'The template could not be read.',
      recovery: 'retry',
    });
    expect(JSON.stringify(view)).not.toContain('alice');
    expect(JSON.stringify(view)).not.toContain('EACCES');
  });

  it('uses symbolic labels for empty targets and rejects filesystem-like JSON paths', () => {
    expect(sanitizeTemplateDiagnosticTarget(' / ', 'workspace')).toBe('Workspace templates');

    const view = projectTemplateCatalogDiagnostic({
      code: 'malformed-document',
      targetPath: '',
      message: 'bad',
      path: 'C:\\private\\file.sdoc',
    }, 'catalog');

    expect(view.targetLabel).toBe('Template catalog');
    expect(view.jsonPath).toBeUndefined();
    expect(view.recovery).toBe('fix-source');
  });

  it('maps duplicate and bounded-catalog diagnostics to explicit recovery and severity', () => {
    expect(projectTemplateCatalogDiagnostic({
      code: 'duplicate-template-id',
      targetPath: '/repo/.sdoc/templates/copy.sdoc',
      message: 'duplicate',
    }, 'workspace')).toMatchObject({
      severity: 'warning',
      targetLabel: 'copy.sdoc',
      recovery: 'resolve-duplicate',
    });

    expect(projectTemplateCatalogDiagnostic({
      code: 'candidate-limit-exceeded',
      targetPath: '/repo/.sdoc/templates',
      message: 'limit',
    }, 'catalog')).toMatchObject({
      severity: 'warning',
      targetLabel: 'templates',
      recovery: 'none',
    });
  });

  it('creates stable, distinct IDs for repeated diagnostics', () => {
    const diagnostics: TemplateDiagnostic[] = [
      { code: 'read-failed', targetPath: '/a/broken.sdoc', message: 'first' },
      { code: 'read-failed', targetPath: '/a/broken.sdoc', message: 'second' },
    ];

    const first = projectTemplateCatalogDiagnostics(diagnostics, 'workspace');
    const second = projectTemplateCatalogDiagnostics(diagnostics, 'workspace');

    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(new Set(first.map((item) => item.id))).toHaveProperty('size', 2);
  });
});
