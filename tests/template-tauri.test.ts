import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_TEMPLATES, createPersonalTemplateSnapshot } from '../shared/template';
import {
  applyTemplateToActiveTauriDocument,
  createTauriTemplateDocument,
  loadTauriTemplateCatalog,
  saveActiveDocumentAsPersonalTemplate,
  suggestTemplateFileName,
  type PersonalTemplateDiscovery,
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

    const result = await loadTauriTemplateCatalog(
      'C:/sample',
      async () => discovery,
      async () => ({
        libraryPath: 'C:/Users/test/.sdoc/templates',
        storageScope: 'local-user-home',
        candidates: [],
        diagnostics: [],
      }),
    );

    expect(result.catalog.templates.map((template) => template.descriptor.id)).toContain(
      'workspace:sample:.sdoc/templates/team.sdoc',
    );
    expect(result.catalog.diagnostics.some((item) => item.targetPath.endsWith('broken.sdoc'))).toBe(true);
    expect(result.nativeDiagnostics).toEqual(discovery.diagnostics);
  });

  it('always loads personal candidates and maps storage UUIDs to managed IDs and revisions', async () => {
    const storageId = '11111111-1111-4111-8111-111111111111';
    const personal: PersonalTemplateDiscovery = {
      libraryPath: 'C:/Users/test/.sdoc/templates',
      storageScope: 'local-user-home',
      candidates: [{
        storageId,
        fileName: `${storageId}.sdoc`,
        rawSource: JSON.stringify({
          sdoc: '1.0',
          meta: { title: 'Personal', template: { id: `user:${storageId}`, name: 'Personal' } },
          doc: { type: 'doc', content: [] },
        }),
        fingerprint: 'sha256:abc',
        sizeBytes: 100,
      }],
      diagnostics: [],
    };
    const discoverWorkspace = vi.fn();

    const result = await loadTauriTemplateCatalog(
      null,
      discoverWorkspace,
      async () => personal,
    );

    expect(discoverWorkspace).not.toHaveBeenCalled();
    expect(result.catalog.templates.map(({ descriptor }) => descriptor.id)).toContain(`user:${storageId}`);
    expect(result.personalFingerprints.get(`user:${storageId}`)).toBe('sha256:abc');
    expect(result.personalRootPath).toBe(personal.libraryPath);
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

  it('flushes and reads an authoritative snapshot before saving a personal template', async () => {
    const events: string[] = [];
    const envelope = BUILTIN_TEMPLATES[1].envelope;
    let persistedEnvelope: unknown;
    const created = await saveActiveDocumentAsPersonalTemplate({
      name: 'Saved report',
      description: 'Local snapshot',
    }, {
      createId: () => '11111111-1111-4111-8111-111111111111',
      flushAndWait: async () => { events.push('flush'); },
      getIdentity: () => ({ documentId: 'doc-a', revision: 4 }),
      readSnapshot: async () => {
        events.push('snapshot');
        return { documentId: 'doc-a', revision: 4, envelope };
      },
      create: async (templateId, value) => {
        events.push('create');
        expect(templateId).toBe('user:11111111-1111-4111-8111-111111111111');
        expect(value.meta).not.toHaveProperty('author');
        persistedEnvelope = structuredClone(value);
      },
    });

    expect(events).toEqual(['flush', 'snapshot', 'create']);
    expect(created.descriptor.name).toBe('Saved report');
    expect(created.descriptor.titleNodeId).toBe('document-title');
    expect(persistedEnvelope).toEqual(createPersonalTemplateSnapshot(envelope, {
      id: 'user:11111111-1111-4111-8111-111111111111',
      name: 'Saved report',
      description: 'Local snapshot',
      titleNodeId: 'document-title',
      sourceLabel: 'VS Code personal library',
    }).envelope);
  });

  it('applies a template with one save after flush, snapshot, and confirmation', async () => {
    const events: string[] = [];
    const current = structuredClone(BUILTIN_TEMPLATES[0].envelope);
    current.meta.title = 'Current title';
    current.meta.author = 'Keep me';
    const save = vi.fn(async () => {
      events.push('save');
      return { documentId: 'doc-a', revision: 8 };
    });

    const result = await applyTemplateToActiveTauriDocument(BUILTIN_TEMPLATES[1], {
      flushAndWait: async () => { events.push('flush'); },
      getIdentity: () => ({ documentId: 'doc-a', revision: 7 }),
      readSnapshot: async () => {
        events.push('snapshot');
        return { documentId: 'doc-a', revision: 7, envelope: current };
      },
      confirm: async () => {
        events.push('confirm');
        return true;
      },
      save,
    });

    expect(events).toEqual(['flush', 'snapshot', 'confirm', 'save']);
    expect(save).toHaveBeenCalledOnce();
    expect(result.applied).toBe(true);
    expect(result.envelope?.meta).toMatchObject({ title: 'Current title', author: 'Keep me' });
    expect(result.envelope?.doc.content?.[0].content?.[0].text).toBe('Current title');
    expect(result.envelope?.doc.content?.slice(1)).toEqual(
      BUILTIN_TEMPLATES[1].envelope.doc.content?.slice(1),
    );
  });
});
