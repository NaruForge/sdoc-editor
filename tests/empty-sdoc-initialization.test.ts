import { describe, expect, it, vi } from 'vitest';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { getBuiltInTemplates } from '../shared/template';
import { isEditorToHostMessage, isHostToEditorMessage } from '../shared/types/messageGuards';
import {
  canApplyTemplateToCurrentDocument,
  commitCurrentDocumentTemplateApplication,
  isBlankSdocDocument,
  isUninitializedSdocText,
  prepareCurrentDocumentTemplateApplication,
} from '../src/services/VsCodeTemplateService';

const identity = {
  sessionId: 'session-1',
  documentId: 'file:///workspace/empty.sdoc',
  revision: 1,
};

describe('Explorer-created empty SDOC initialization', () => {
  it('recognizes only zero-byte and whitespace-only files as uninitialized', () => {
    expect(isUninitializedSdocText('')).toBe(true);
    expect(isUninitializedSdocText(' \r\n\t')).toBe(true);
    expect(isUninitializedSdocText('{}')).toBe(false);
    expect(isUninitializedSdocText('{"sdoc":"2.0"}')).toBe(false);
    expect(isUninitializedSdocText('{')).toBe(false);
  });

  it('requires exact document identity, session, revision, and source snapshot', () => {
    expect(canApplyTemplateToCurrentDocument('same', 'same', identity, identity)).toBe(true);
    expect(canApplyTemplateToCurrentDocument('same', 'same', identity, { ...identity, revision: 2 })).toBe(false);
    expect(canApplyTemplateToCurrentDocument('same', 'same', identity, { ...identity, documentId: 'other' })).toBe(false);
    expect(canApplyTemplateToCurrentDocument('before', 'after', identity, identity)).toBe(false);
  });

  it('does not apply a prepared document after an external revision change', async () => {
    const apply = vi.fn(async () => undefined);
    await expect(commitCurrentDocumentTemplateApplication({
      expectedText: '',
      currentText: '',
      expected: identity,
      current: { ...identity, revision: identity.revision + 1 },
      preparedText: '{"sdoc":"1.0"}',
      apply,
    })).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('propagates edit failures without replacing the source document', async () => {
    let currentText = '';
    await expect(commitCurrentDocumentTemplateApplication({
      expectedText: currentText,
      currentText,
      expected: identity,
      current: identity,
      preparedText: '{"sdoc":"1.0"}',
      apply: async () => { throw new Error('VS Code rejected the document edit.'); },
    })).rejects.toThrow('rejected');
    expect(currentText).toBe('');
    expect(isUninitializedSdocText(currentText)).toBe(true);
  });

  it('prepares a schema-valid replacement while preserving the current title', () => {
    const blankText = JSON.stringify({
      sdoc: '1.0',
      meta: { title: 'Current title' },
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, id: 'document-title', numbered: false }, content: [{ type: 'text', text: 'Current title' }] },
          { type: 'paragraph' },
        ],
      },
    });
    const template = getBuiltInTemplates().find((candidate) => candidate.descriptor.id === 'builtin:technical-report');
    expect(template).toBeDefined();
    if (!template) return;

    const prepared = prepareCurrentDocumentTemplateApplication({
      currentText: blankText,
      template,
      defaultTitle: 'Fallback',
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });
    const persisted: unknown = JSON.parse(prepared.text);
    expect(() => assertPersistedDocument(persisted)).not.toThrow();
    expect(persisted).toMatchObject({ meta: { title: 'Current title' } });
    expect(prepared.hasReplaceableContent).toBe(false);
    expect(isBlankSdocDocument(JSON.parse(blankText))).toBe(true);
  });

  it('treats body content and document settings as destructive replacement', () => {
    const template = getBuiltInTemplates().find((candidate) => candidate.descriptor.id === 'builtin:technical-report');
    expect(template).toBeDefined();
    if (!template) return;
    const contentText = JSON.stringify({
      sdoc: '1.0',
      meta: { title: 'Existing', settings: { headingNumbering: false } },
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep me' }] }] },
    });

    const prepared = prepareCurrentDocumentTemplateApplication({
      currentText: contentText,
      template,
      defaultTitle: 'Fallback',
    });
    expect(prepared.hasReplaceableContent).toBe(true);
    expect(isBlankSdocDocument(JSON.parse(contentText))).toBe(false);
  });

  it('preserves document identity metadata while replacing template settings', () => {
    const template = getBuiltInTemplates()[1];
    expect(template).toBeDefined();
    if (!template) return;
    template.envelope.meta.settings = { headingNumbering: false };
    const currentText = JSON.stringify({
      sdoc: '1.0',
      meta: {
        title: 'Existing title',
        author: 'Existing author',
        version: '7.2',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-02T00:00:00.000Z',
        settings: { headingDecoration: false },
        reviewStatus: 'approved',
      },
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old body' }] }] },
    });

    const prepared = prepareCurrentDocumentTemplateApplication({
      currentText,
      template,
      defaultTitle: 'Fallback',
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });
    const result = JSON.parse(prepared.text);
    expect(result.meta).toMatchObject({
      title: 'Existing title',
      author: 'Existing author',
      version: '7.2',
      created: '2025-01-01T00:00:00.000Z',
      modified: '2026-07-22T00:00:00.000Z',
      reviewStatus: 'approved',
      settings: { headingNumbering: false },
    });
    expect(result.meta.settings).not.toHaveProperty('headingDecoration');
  });

  it('applies a template directly to whitespace without a preliminary blank write', () => {
    const template = getBuiltInTemplates()[1];
    expect(template).toBeDefined();
    if (!template) return;

    const prepared = prepareCurrentDocumentTemplateApplication({
      currentText: ' \r\n\t',
      template,
      defaultTitle: 'Explorer file',
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });
    const persisted: unknown = JSON.parse(prepared.text);
    expect(() => assertPersistedDocument(persisted)).not.toThrow();
    expect(persisted).toMatchObject({ meta: { title: 'Explorer file' } });
    expect(prepared.hasReplaceableContent).toBe(false);
  });

  it('rejects malformed and future-version documents as replacement targets', () => {
    const template = getBuiltInTemplates()[1];
    expect(template).toBeDefined();
    if (!template) return;
    expect(() => prepareCurrentDocumentTemplateApplication({
      currentText: '{', template, defaultTitle: 'Broken',
    })).toThrow('valid SDOC');
    expect(() => prepareCurrentDocumentTemplateApplication({
      currentText: '{"sdoc":"2.0","doc":{"type":"doc"}}', template, defaultTitle: 'Future',
    })).toThrow('valid SDOC');
  });

  it('accepts only fully identified template application messages', () => {
    expect(isEditorToHostMessage({
      type: 'applyTemplate',
      templateId: 'builtin:technical-report',
      sessionId: identity.sessionId,
      documentId: identity.documentId,
      baseRevision: identity.revision,
    })).toBe(true);
    expect(isEditorToHostMessage({ type: 'applyTemplate', templateId: 'builtin:technical-report' })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'applyTemplate',
      templateId: '',
      sessionId: identity.sessionId,
      documentId: identity.documentId,
      baseRevision: identity.revision,
    })).toBe(false);
    expect(isEditorToHostMessage({ type: 'requestTemplateCatalog' })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'templateCatalog',
      diagnosticCount: 0,
      templates: [{
        id: 'builtin:technical-report',
        name: 'Technical report',
        source: 'builtin',
        sourceLabel: 'Structured Doc Editor',
      }],
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'templateCatalog',
      diagnosticCount: 0,
      templates: [{ id: 42, name: 'Broken', source: 'builtin', sourceLabel: 'Built-in' }],
    })).toBe(false);
  });
});
