import { describe, expect, it, vi } from 'vitest';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { getBuiltInTemplates } from '../shared/template';
import { isEditorToHostMessage } from '../shared/types/messageGuards';
import {
  canInitializeEmptyDocument,
  commitEmptyDocumentInitialization,
  isUninitializedSdocText,
  prepareEmptyDocumentInitialization,
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

  it('requires exact document identity, session, revision, and empty content', () => {
    expect(canInitializeEmptyDocument('  ', identity, identity)).toBe(true);
    expect(canInitializeEmptyDocument('', identity, { ...identity, revision: 2 })).toBe(false);
    expect(canInitializeEmptyDocument('', identity, { ...identity, documentId: 'other' })).toBe(false);
    expect(canInitializeEmptyDocument('{}', identity, identity)).toBe(false);
  });

  it('does not apply a prepared document after an external revision change', async () => {
    const apply = vi.fn(async () => undefined);
    await expect(commitEmptyDocumentInitialization({
      currentText: '',
      expected: identity,
      current: { ...identity, revision: identity.revision + 1 },
      preparedText: '{"sdoc":"1.0"}',
      apply,
    })).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('propagates edit failures without treating the empty document as initialized', async () => {
    let currentText = '';
    await expect(commitEmptyDocumentInitialization({
      currentText,
      expected: identity,
      current: identity,
      preparedText: '{"sdoc":"1.0"}',
      apply: async () => { throw new Error('VS Code rejected the document edit.'); },
    })).rejects.toThrow('rejected');
    expect(currentText).toBe('');
    expect(isUninitializedSdocText(currentText)).toBe(true);
  });

  it('prepares a schema-valid blank envelope without touching initialized content', async () => {
    const text = await prepareEmptyDocumentInitialization({
      mode: 'blank',
      currentText: '\n',
      defaultTitle: 'Explorer document',
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });

    expect(text).toBeDefined();
    const persisted: unknown = JSON.parse(text ?? '');
    expect(() => assertPersistedDocument(persisted)).not.toThrow();
    expect(persisted).toMatchObject({
      meta: { title: 'Explorer document', created: '2026-07-22T00:00:00.000Z' },
    });
    expect(isUninitializedSdocText(text ?? '')).toBe(false);

    await expect(prepareEmptyDocumentInitialization({
      mode: 'blank',
      currentText: '{"sdoc":"2.0"}',
      defaultTitle: 'Future document',
    })).rejects.toThrow('no longer empty');
    await expect(prepareEmptyDocumentInitialization({
      mode: 'blank',
      currentText: text ?? '',
      defaultTitle: 'Already initialized',
    })).rejects.toThrow('no longer empty');
  });

  it('returns no edit when experimental template or title selection is cancelled', async () => {
    const selectTemplate = vi.fn(async () => undefined);
    await expect(prepareEmptyDocumentInitialization({
      mode: 'template',
      currentText: '',
      defaultTitle: 'Cancelled',
      templates: [],
      selectTemplate,
      requestTitle: vi.fn(async () => 'Cancelled'),
    })).resolves.toBeUndefined();
    expect(selectTemplate).toHaveBeenCalledOnce();

    const builtIns = getBuiltInTemplates().filter((template) =>
      template.descriptor.id !== 'builtin:blank');
    await expect(prepareEmptyDocumentInitialization({
      mode: 'template',
      currentText: '',
      defaultTitle: 'Cancelled title',
      templates: builtIns,
      selectTemplate: vi.fn(async (templates) => templates[0]),
      requestTitle: vi.fn(async () => undefined),
    })).resolves.toBeUndefined();
  });

  it('accepts only fully identified initialization messages', () => {
    expect(isEditorToHostMessage({
      type: 'initializeEmptyDocument',
      mode: 'blank',
      sessionId: identity.sessionId,
      documentId: identity.documentId,
      baseRevision: identity.revision,
    })).toBe(true);
    expect(isEditorToHostMessage({ type: 'initializeEmptyDocument', mode: 'blank' })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'initializeEmptyDocument',
      mode: 'overwrite',
      sessionId: identity.sessionId,
      documentId: identity.documentId,
      baseRevision: identity.revision,
    })).toBe(false);
  });
});
