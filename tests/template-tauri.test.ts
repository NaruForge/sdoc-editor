import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_TEMPLATES } from '../shared/template';
import {
  createTauriTemplateDocument,
  loadTauriTemplateCatalog,
  suggestTemplateFileName,
  type WorkspaceTemplateDiscovery,
} from '../tauri-app/src/templateService';

describe('Tauri template service', () => {
  it('builds safe editable file names from document titles', () => {
    expect(suggestTemplateFileName('  System: Design / Review?  ')).toBe('System- Design - Review.sdoc');
    expect(suggestTemplateFileName('...')).toBe('untitled.sdoc');
    expect(suggestTemplateFileName('report.sdoc')).toBe('report.sdoc');
  });

  it('loads workspace candidates while isolating unreadable JSON', async () => {
    const discovery: WorkspaceTemplateDiscovery = {
      candidates: [
        {
          id: 'workspace:sample:.sdoc/templates/team.sdoc',
          sourceLabel: 'sample',
          fileName: 'team.sdoc',
          path: 'C:/sample/.sdoc/templates/team.sdoc',
          rawSource: JSON.stringify(BUILTIN_TEMPLATES[0].envelope),
        },
        {
          id: 'workspace:sample:.sdoc/templates/broken.sdoc',
          sourceLabel: 'sample',
          fileName: 'broken.sdoc',
          path: 'C:/sample/.sdoc/templates/broken.sdoc',
          rawSource: '{',
        },
      ],
      diagnostics: [{ code: 'template-too-large', path: 'large.sdoc', message: 'too large' }],
    };

    const result = await loadTauriTemplateCatalog('C:/sample', async () => discovery);

    expect(result.catalog.templates.map((template) => template.descriptor.id)).toContain(
      'workspace:sample:.sdoc/templates/team.sdoc',
    );
    expect(result.catalog.diagnostics.some((item) => item.targetPath.endsWith('broken.sdoc'))).toBe(true);
    expect(result.nativeDiagnostics).toEqual(discovery.diagnostics);
  });

  it('flushes before creating a complete instantiated envelope', async () => {
    const events: string[] = [];
    const flush = vi.fn(async () => { events.push('flush'); });
    const create = vi.fn(async (envelope) => {
      events.push('create');
      return envelope;
    });

    const result = await createTauriTemplateDocument({
      template: BUILTIN_TEMPLATES[1],
      title: 'New Technical Report',
    }, { flush, create });

    expect(events).toEqual(['flush', 'create']);
    expect(result.meta.title).toBe('New Technical Report');
    expect(result.meta).not.toHaveProperty('template');
    expect(create).toHaveBeenCalledOnce();
  });

  it('does not create when the pending editor flush fails', async () => {
    const create = vi.fn();
    await expect(createTauriTemplateDocument({
      template: BUILTIN_TEMPLATES[0],
      title: 'Safe Document',
    }, {
      flush: async () => { throw new Error('save failed'); },
      create,
    })).rejects.toThrow('save failed');
    expect(create).not.toHaveBeenCalled();
  });
});
