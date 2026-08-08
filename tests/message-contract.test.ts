import { describe, expect, it } from 'vitest';
import { isEditorToHostMessage, isHostToEditorMessage } from '../shared/types/messageGuards';
import {
  applyImportedContentWithRollback,
  reduceStandaloneFileOperationHostMessage,
  requiresLegacyImportConfirmation,
} from '../webview-ui/src/hooks/useEditorMessages';
import {
  createFileOperationControllerState,
} from '../shared/editor/fileOperations';

describe('editor host message boundary', () => {
  it('adopts a host-initiated Palette preflight from idle through confirmation', () => {
    const identity = {
      sessionId: 'session-1',
      documentId: 'file:///c%3A/workspace/report.sdoc',
    };
    const intent = { kind: 'export' as const, format: 'html' as const };
    const preparing = reduceStandaloneFileOperationHostMessage(
      createFileOperationControllerState(identity.sessionId),
      {
        type: 'fileOperationStatus',
        ...identity,
        state: {
          phase: 'preflighting', requestId: 'palette-1', intent,
          stage: 'Preparing immutable export snapshot…',
        },
      },
      identity,
    );
    expect(preparing.operationState).toMatchObject({
      phase: 'preflighting', requestId: 'palette-1', intent,
    });

    const awaiting = reduceStandaloneFileOperationHostMessage(preparing, {
      type: 'fileOperationPreflight',
      ...identity,
      requestId: 'palette-1',
      plan: {
        planId: 'plan-1', intent,
        source: { displayName: 'report.sdoc', sizeBytes: 10, revision: 2 },
        destination: { displayName: 'report.html', exists: false },
        warnings: [], requiresConfirmation: true,
      },
    }, identity);
    expect(awaiting.operationState).toMatchObject({
      phase: 'awaiting-confirmation', requestId: 'palette-1',
      plan: { planId: 'plan-1' },
    });

    const undoRunning = reduceStandaloneFileOperationHostMessage(awaiting, {
      type: 'fileOperationStatus',
      ...identity,
      state: {
        phase: 'running', requestId: 'undo-1',
        kind: 'import', format: 'markdown',
        intent: { kind: 'import', format: 'markdown' },
        stage: 'Restoring previous body…',
      },
    }, identity);
    expect(undoRunning.operationState).toMatchObject({
      phase: 'running', requestId: 'undo-1', kind: 'import',
    });
  });

  it('rolls back the local import checkpoint before reporting an ACK failure', async () => {
    const before = { type: 'doc' as const, content: [{ type: 'paragraph' as const }] };
    const imported = { type: 'doc' as const, content: [{ type: 'heading' as const }] };
    const replacements: unknown[] = [];
    const order: string[] = [];

    const applied = await applyImportedContentWithRollback({
      content: imported,
      checkpoint: before,
      replace: (content) => { replacements.push(content); return true; },
      flush: () => { order.push('flush'); },
      afterAcknowledged: async () => { throw new Error('write rejected'); },
      restoreSyncCheckpoint: () => { order.push('restore-sync'); },
      reportApplied: async (value) => { order.push(`report:${String(value)}`); },
    });

    expect(applied).toBe(false);
    expect(replacements).toEqual([imported, before]);
    expect(order).toEqual(['flush', 'restore-sync', 'report:false']);
  });

  it('does not ask for a second import confirmation after common preflight', () => {
    const base = {
      type: 'importContent' as const,
      requestId: 'request-1',
      sessionId: 'session-1',
      documentId: 'doc-a',
      content: { type: 'doc' as const, content: [] },
    };
    expect(requiresLegacyImportConfirmation(base)).toBe(true);
    expect(requiresLegacyImportConfirmation({
      ...base,
      confirmation: 'preflight-confirmed',
    })).toBe(false);
  });

  it('accepts a host-authorized import checkpoint restore without a preflight plan id', () => {
    expect(isHostToEditorMessage({
      type: 'fileOperationStatus',
      sessionId: 'session-1',
      documentId: 'file:///c%3A/workspace/report.sdoc',
      state: {
        phase: 'running',
        requestId: 'undo-1',
        kind: 'import',
        format: 'markdown',
        intent: { kind: 'import', format: 'markdown' },
        stage: 'Restoring previous body…',
      },
    })).toBe(true);
  });
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
      type: 'uiReady',
      sessionId: 'session-1',
      documentId: 'doc-a',
    })).toBe(true);
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
    expect(isHostToEditorMessage({
      type: 'init', locale: 'en', sessionId: 'session-1', documentId: 'doc-a', revision: 1, isDirty: false,
      documentState: {
        status: 'ready',
        snapshot: { content: { type: 'doc', content: [] }, meta: {}, documentSettings: null },
      },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'init', locale: 'ko', sessionId: 'session-2', documentId: 'doc-b', revision: 2, isDirty: true,
      documentState: {
        status: 'invalid', reason: 'malformed',
        diagnostics: [{ path: '/', message: 'invalid document' }],
      },
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'recoverInvalidDocument', requestId: 'recover-1', sessionId: 'session-1',
      documentId: 'doc-a', baseRevision: 2,
      mutation: { content: { type: 'doc', content: [] }, meta: {}, documentSettings: null },
    })).toBe(true);
  });

  it('rejects unknown and malformed messages', () => {
    expect(isEditorToHostMessage({ type: 'uiReady', sessionId: 'session-1' })).toBe(false);
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
    expect(isHostToEditorMessage({
      type: 'init', locale: 'en', sessionId: 'session-1', documentId: 'doc-a', revision: 1, isDirty: false,
      documentState: { status: 'invalid', reason: 'malformed', diagnostics: [] },
    })).toBe(false);
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
    expect(isHostToEditorMessage({
      type: 'diagramRenderResult',
      requestId: 'diagram-2',
      result: {
        status: 'ready',
        dataUrl: 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMSAxIj48L3N2Zz4=',
        width: 1,
        height: 1,
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

  it('validates the preflight file-operation protocol without exposing host paths', () => {
    const identity = {
      requestId: 'operation-1',
      sessionId: 'session-1',
      documentId: 'doc-a',
    };
    const intent = { kind: 'export', format: 'html' };
    const plan = {
      planId: 'plan-1',
      intent,
      source: { displayName: 'report.sdoc', sizeBytes: 512, revision: 7 },
      destination: {
        displayName: 'Workspace · ./dist/report.html',
        exists: true,
        scope: 'workspace',
        relativePath: './dist/report.html',
      },
      effectiveSettings: {
        fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        items: [{ key: 'captionStyle', value: 'modern', source: 'document' }],
      },
      diagram: { failurePolicy: 'source-fallback', fallbackCount: 0 },
      warnings: ['The destination will be replaced.'],
      requiresConfirmation: true,
    };

    expect(isEditorToHostMessage({
      type: 'fileOperationPrepare',
      ...identity,
      baseRevision: 7,
      intent,
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'fileOperationPreflight',
      ...identity,
      plan,
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'fileOperationExecute',
      ...identity,
      planId: 'plan-1',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'fileOperationCancel',
      ...identity,
      planId: 'plan-1',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'fileOperationRetry',
      ...identity,
      previousRequestId: 'operation-0',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'fileOperationResultAction',
      ...identity,
      actionRequestId: 'action-open-1',
      action: 'open',
      artifactId: 'artifact-1',
    })).toBe(true);
    expect(isEditorToHostMessage({
      type: 'fileOperationResultAction',
      ...identity,
      actionRequestId: 'action-repeat-1',
      action: 'repeat',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'fileOperationResultActionStatus',
      ...identity,
      actionRequestId: 'action-open-1',
      action: 'open',
      status: 'completed',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'fileOperationStatus',
      sessionId: 'session-1',
      documentId: 'doc-a',
      state: {
        phase: 'awaiting-confirmation',
        requestId: 'operation-1',
        intent,
        plan,
      },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'fileOperationStatus',
      sessionId: 'session-1',
      documentId: 'doc-a',
      state: {
        phase: 'succeeded',
        requestId: 'operation-1',
        result: 'completed',
        intent,
        details: {
          outcome: 'completed',
          artifact: {
            artifactId: 'artifact-1',
            displayName: 'report.html',
            sizeBytes: 1024,
          },
          warnings: [],
          availableActions: [
            { action: 'open', artifactId: 'artifact-1' },
            { action: 'repeat' },
          ],
        },
      },
    })).toBe(true);

    expect(isEditorToHostMessage({
      type: 'fileOperationPrepare',
      ...identity,
      requestId: 'x'.repeat(129),
      baseRevision: 7,
      intent,
    })).toBe(false);
    expect(isHostToEditorMessage({ type: 'showFileOperation', tab: 'export' })).toBe(true);
    expect(isHostToEditorMessage({ type: 'showFileOperation', tab: 'settings' })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'importContent',
      requestId: 'import-1', sessionId: 'session-1', documentId: 'doc-a',
      confirmation: 'preflight-confirmed',
      content: { type: 'doc', content: [] },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'importHtml',
      requestId: 'import-1', sessionId: 'session-1', documentId: 'doc-a',
      confirmation: 'untrusted', html: '<p>body</p>',
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'fileOperationPrepare',
      ...identity,
      baseRevision: 7,
      intent: { kind: 'export', format: 'exe' },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'fileOperationPreflight',
      ...identity,
      plan: {
        ...plan,
        destination: { displayName: 'C:\\Users\\person\\report.html', exists: true },
      },
    })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'fileOperationPreflight',
      ...identity,
      plan: { ...plan, warnings: Array.from({ length: 101 }, () => 'warning') },
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'fileOperationExecute',
      ...identity,
      planId: '../plan-1',
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'fileOperationResultAction',
      ...identity,
      actionRequestId: 'action-open-1',
      action: 'open',
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'fileOperationResultAction',
      ...identity,
      actionRequestId: 'action-repeat-1',
      action: 'repeat',
      artifactId: 'artifact-1',
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'fileOperationResultAction',
      ...identity,
      actionRequestId: identity.requestId,
      action: 'repeat',
    })).toBe(false);
    expect(isEditorToHostMessage({
      type: 'fileOperationResultAction',
      ...identity,
      action: 'repeat',
    })).toBe(false);
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
      type: 'init', locale: 'ko', sessionId: 'session-1', documentId: 'doc-a', revision: 4, isDirty: false,
      documentState: {
        status: 'ready',
        snapshot: {
          content: { type: 'doc', content: [] },
          meta: {},
          documentSettings: null,
        },
      },
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'init',
      sessionId: 'session-1',
      documentId: 'doc-a',
      revision: 4,
      isDirty: false,
      documentState: {
        status: 'ready',
        snapshot: {
          content: { type: 'doc', content: [] },
          meta: {},
          documentSettings: null,
        },
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
    expect(isHostToEditorMessage({
      type: 'requestFlush', sessionId: 'session-1', documentId: 'doc-a', requestId: 'flush-1',
    })).toBe(true);
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
      type: 'flushComplete', sessionId: 'session-1', documentId: 'doc-a', requestId: 'flush-1',
    })).toBe(true);
    expect(isEditorToHostMessage({ type: 'flushComplete' })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'editAcknowledged', sessionId: 'session-1', documentId: 'doc-a', editId: 'edit-1',
      revision: 5, modified: '2026-08-06T01:00:00.000Z',
    })).toBe(true);
    expect(isHostToEditorMessage({
      type: 'documentSaveState', sessionId: 'session-1', documentId: 'doc-a',
      saveGeneration: 1, revision: 5, phase: 'saved', modified: '2026-08-06T01:00:00.000Z',
    })).toBe(true);
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
