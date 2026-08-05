import { describe, expect, it } from 'vitest';
import { isEditorToHostMessage, isHostToEditorMessage } from '../shared/types/messageGuards';

describe('editor host message boundary', () => {
  it('accepts only supported UI language preferences and resolved locales', () => {
    expect(isEditorToHostMessage({
      type: 'updateUiLanguage',
      preference: 'ko',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'updateUiLanguage',
      preference: 'system',
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'uiLanguageChanged',
      preference: 'auto',
      locale: 'en',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'uiLanguageChanged',
      preference: 'auto',
      locale: 'ja',
    })).toBe(false);
  });

  it('accepts valid discriminated messages', () => {
    expect(isEditorToHostMessage({
      type: 'editorTextFocusChanged',
      sessionId: 'session-1',
      documentId: 'doc-a',
      focused: true,
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'edit',
      sessionId: 'session-1',
      documentId: 'doc-a',
      editId: 'edit-1',
      baseRevision: 1,
      localGeneration: 2,
      mutation: {
        content: { type: 'doc', content: [] },
        meta: {},
        documentSettings: null,
      },
    })).toBe(true);
    expect(isEditorToHostMessage({ type: 'selectCssFile', target: 'html' })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'requestTemplateCatalog',
      requestId: 'catalog-1',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'export',
      requestId: 'file-1',
      sessionId: 'session-1',
      documentId: 'doc-a',
      format: 'html',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'drawioFileUpdated', documentId: 'doc-a', generation: 2,
      relativePath: './drawio/a.drawio.svg', newWebviewUri: 'asset://a',
    })).toBe(true);
  });

  it('rejects unknown and malformed messages', () => {
    expect(isEditorToHostMessage({
      type: 'editorTextFocusChanged',
      sessionId: 'session-1',
      documentId: 'doc-a',
      focused: 'true',
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'editorTextFocusChanged',
      focused: true,
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'edit',
      mutation: { content: { type: 'doc', content: [] }, meta: {}, documentSettings: null },
    })).toBe(false);
    expect(isEditorToHostMessage({ type: 'replaceImage', pos: '4' })).toBe(false);
    expect(isEditorToHostMessage({ type: 'retiredAiSupport' })).toBe(false);
    expect(isHostToEditorMessage({ type: 'settingsChanged', settings: null })).toBe(false);
    expect(isHostToEditorMessage({ type: 'drawioFileUpdated', relativePath: './a.svg' })).toBe(false);
    expect(isEditorToHostMessage({ type: 'requestTemplateCatalog' })).toBe(false);
    expect(isEditorToHostMessage({ type: 'export', format: 'html' })).toBe(false);
  });

  it('narrows request-correlated template, file, and diagram messages', () => {
    expect(isHostToEditorMessage({
      type: 'templateCatalog',
      requestId: 'catalog-1',
      templates: [],
      diagnostics: [{
        id: 'diagnostic-1',
        code: 'read-failed',
        source: 'workspace',
        severity: 'error',
        targetLabel: 'broken.sdoc',
        recovery: 'retry',
      }],
      personalRootScope: 'local',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'templateCatalog',
      requestId: 'catalog-1',
      templates: [],
      diagnostics: [{
        id: 'diagnostic-1',
        code: 'read-failed',
        source: 'workspace',
        severity: 'error',
        targetLabel: 'C:\\Users\\secret\\broken.sdoc',
        recovery: 'retry',
      }],
      personalRootScope: 'local',
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'templateApplicationFinished',
      requestId: 'apply-1',
      result: 'cancelled',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'templateCatalogFailed',
      requestId: 'catalog-2',
      error: { code: 'catalog-unavailable', message: 'The catalog could not be loaded.' },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'templateCatalogFailed',
      requestId: 'catalog-2',
      error: { code: 'raw-os-error', message: 'C:\\Users\\secret\\templates' },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'templateApplicationFinished',
      requestId: 'apply-2',
      result: 'failed',
      error: { code: 'document-changed', message: 'The document changed.' },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'templateOperationFinished',
      requestId: 'save-1',
      operation: 'save',
      result: 'completed',
      templateId: 'user:11111111-1111-4111-8111-111111111111',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'templateOperationFinished',
      requestId: 'save-2',
      operation: 'save',
      result: 'failed',
      error: { code: 'operation-failed', message: 'C:\\Users\\secret\\template.sdoc' },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'templateCatalogFailed',
      requestId: 'catalog-3',
      error: { code: 'catalog-unavailable', message: 'Failed at /srv/private/template.sdoc' },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'templateCatalogFailed',
      requestId: 'catalog-4',
      error: { code: 'catalog-unavailable', message: 'Failed.\nraw details' },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'templateCatalogFailed',
      requestId: 'catalog-5',
      error: { code: 'catalog-unavailable', message: 'Failed.', raw: { path: '/secret' } },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'templateCatalogFailed',
      requestId: 'catalog-6',
      error: { code: 'catalog-unavailable', message: 'Failed at file:///srv/private/template.sdoc' },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'fileOperationStatus',
      sessionId: 'session-1',
      state: {
        phase: 'running',
        requestId: 'file-1',
        kind: 'export',
        format: 'html',
        stage: 'rendering',
      },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'fileOperationStatus',
      sessionId: 'session-1',
      state: { phase: 'failed', requestId: 'file-1', error: 'raw error' },
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'renderDiagram',
      requestId: 'diagram-1',
      language: 'plantuml',
      source: '@startuml\nA -> B\n@enduml',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'renderDiagram',
      requestId: 'diagram-2',
      language: 'mermaid',
      source: 'graph TD',
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'diagramRenderResult',
      requestId: 'diagram-1',
      result: {
        status: 'error',
        code: 'timeout',
        message: 'The renderer timed out.',
        retryable: true,
      },
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'updateDiagramRendererSettings',
      settings: {
        consent: 'granted',
        endpoint: 'https://kroki.io',
        allowPrivateNetwork: false,
      },
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'updateDiagramRendererSettings',
      settings: {
        consent: 'yes',
        endpoint: 'https://kroki.io',
        allowPrivateNetwork: false,
      },
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'updateDiagramRendererSettings',
      settings: {
        consent: { toString: () => 'granted' },
        endpoint: 'https://kroki.io',
        allowPrivateNetwork: false,
      },
    })).toBe(false);
    expect(() => isEditorToHostMessage({
      type: 'updateDiagramRendererSettings',
      settings: {
        consent: { [Symbol.toPrimitive]: () => { throw new Error('must not coerce'); } },
        endpoint: 'https://kroki.io',
        allowPrivateNetwork: false,
      },
    })).not.toThrow();
    expect(isEditorToHostMessage({
      type: 'resolveDiagramRendererConsent',
      requestId: 'consent-1',
      consent: 'declined',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'resolveDiagramRendererConsent',
      requestId: 'consent-2',
      consent: 'undecided',
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'diagramRendererConsentResult',
      requestId: 'consent-1',
      result: {
        status: 'resolved',
        settings: {
          consent: 'declined',
          endpoint: 'https://kroki.io',
          allowPrivateNetwork: false,
        },
      },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'diagramRendererConsentResult',
      requestId: 'consent-2',
      result: { status: 'error', message: 'Could not save.' },
    })).toBe(true);
  });

  it('requires validated metadata on personal template writes', () => {
    const identity = {
      requestId: 'personal-1',
      sessionId: 'session-1',
      documentId: 'doc-a',
      baseRevision: 3,
    };
    expect(isEditorToHostMessage({
      type: 'savePersonalTemplate',
      ...identity,
      metadata: { name: 'Template', description: 'Description', category: 'Report' },
    })).toBe(true);
    expect(isEditorToHostMessage({ type: 'savePersonalTemplate', ...identity })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'savePersonalTemplate',
      ...identity,
      metadata: { name: '', description: 'Description' },
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'savePersonalTemplate',
      ...identity,
      metadata: { name: 'x'.repeat(201) },
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'updatePersonalTemplate',
      ...identity,
      templateId: 'user:11111111-1111-4111-8111-111111111111',
      revisionToken: 'fingerprint',
      metadata: { name: 'Renamed' },
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'duplicatePersonalTemplate',
      ...identity,
      templateId: 'user:11111111-1111-4111-8111-111111111111',
      revisionToken: 'fingerprint',
      metadata: { name: 'Copy', category: 'x'.repeat(101) },
    })).toBe(false);
  });

  it('requires identity and revision on persistence updates', () => {
    expect(isHostToEditorMessage({
      type: 'init', locale: 'ko', sessionId: 'session-1', documentId: 'doc-a', revision: 4,
      snapshot: {
        content: { type: 'doc', content: [] },
        meta: {},
        documentSettings: null,
      },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'init',
      sessionId: 'session-1',
      documentId: 'doc-a',
      revision: 4,
      snapshot: {
        content: { type: 'doc', content: [] },
        meta: {},
        documentSettings: null,
      },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'init',
      locale: 'en',
      sessionId: 'session-1',
      documentId: 'doc-a',
      revision: 4,
      content: { type: 'doc', content: [] },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'init',
      locale: 'ja',
      sessionId: 'session-1',
      documentId: 'doc-a',
      revision: 4,
      snapshot: {
        content: { type: 'doc', content: [] },
        meta: {},
        documentSettings: null,
      },
    })).toBe(false);
    expect(isHostToEditorMessage({ type: 'requestFlush', sessionId: 'session-1', requestId: 'flush-1' })).toBe(true);
    expect(isHostToEditorMessage({ type: 'requestFlush' })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'editRejected', sessionId: 'session-1', documentId: 'doc-a',
      editId: 'edit-1', revision: 5, code: 'STALE_REVISION', message: 'stale',
      hostSnapshot: {
        content: { type: 'doc', content: [] },
        meta: {},
        documentSettings: null,
      },
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'flushComplete', sessionId: 'session-1', requestId: 'flush-1',
    })).toBe(true);
    expect(isEditorToHostMessage({ type: 'flushComplete' })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'externalChange',
      sessionId: 'session-1',
      documentId: 'doc-a',
      revision: 6,
      snapshot: {
        content: { type: 'doc', content: [] },
        meta: {},
        documentSettings: null,
      },
    })).toBe(true);
  });
});
