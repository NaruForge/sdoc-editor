import { describe, expect, it } from 'vitest';
import { isEditorToHostMessage, isHostToEditorMessage } from '../shared/types/messageGuards';

describe('editor host message boundary', () => {
  it('accepts valid discriminated messages', () => {
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
    expect(isHostToEditorMessage({
      type: 'drawioFileUpdated', documentId: 'doc-a', generation: 2,
      relativePath: './drawio/a.drawio.svg', newWebviewUri: 'asset://a',
    })).toBe(true);
  });

  it('rejects unknown and malformed messages', () => {
    expect(isEditorToHostMessage({
      type: 'edit',
      mutation: { content: { type: 'doc', content: [] }, meta: {}, documentSettings: null },
    })).toBe(false);
    expect(isEditorToHostMessage({ type: 'replaceImage', pos: '4' })).toBe(false);
    expect(isEditorToHostMessage({ type: 'retiredAiSupport' })).toBe(false);
    expect(isHostToEditorMessage({ type: 'settingsChanged', settings: null })).toBe(false);
    expect(isHostToEditorMessage({ type: 'drawioFileUpdated', relativePath: './a.svg' })).toBe(false);
  });

  it('requires identity and revision on persistence updates', () => {
    expect(isHostToEditorMessage({
      type: 'init', sessionId: 'session-1', documentId: 'doc-a', revision: 4,
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
      content: { type: 'doc', content: [] },
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
