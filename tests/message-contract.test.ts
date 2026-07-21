import { describe, expect, it } from 'vitest';
import { isEditorToHostMessage, isHostToEditorMessage } from '../shared/types/messageGuards';

describe('editor host message boundary', () => {
  it('accepts valid discriminated messages', () => {
    expect(isEditorToHostMessage({ type: 'edit', content: { type: 'doc', content: [] } })).toBe(true);
    expect(isEditorToHostMessage({ type: 'selectCssFile', target: 'html' })).toBe(true);
    expect(isHostToEditorMessage({ type: 'drawioFileUpdated', relativePath: './drawio/a.svg', newWebviewUri: 'asset://a' })).toBe(true);
  });

  it('rejects unknown and malformed messages', () => {
    expect(isEditorToHostMessage({ type: 'edit', content: null })).toBe(false);
    expect(isEditorToHostMessage({ type: 'replaceImage', pos: '4' })).toBe(false);
    expect(isEditorToHostMessage({ type: 'retiredAiSupport' })).toBe(false);
    expect(isHostToEditorMessage({ type: 'settingsChanged', settings: null })).toBe(false);
    expect(isHostToEditorMessage({ type: 'drawioFileUpdated', relativePath: './a.svg' })).toBe(false);
  });

  it('requires identity and revision on persistence updates', () => {
    expect(isHostToEditorMessage({
      type: 'init', sessionId: 'session-1', documentId: 'doc-a', revision: 4,
      content: { type: 'doc', content: [] },
    })).toBe(true);
    expect(isHostToEditorMessage({ type: 'init', content: { type: 'doc', content: [] } })).toBe(false);
    expect(isHostToEditorMessage({ type: 'requestFlush', sessionId: 'session-1', requestId: 'flush-1' })).toBe(true);
    expect(isHostToEditorMessage({ type: 'requestFlush' })).toBe(false);
    expect(isHostToEditorMessage({
      type: 'editRejected', sessionId: 'session-1', editId: 'edit-1', revision: 5,
      reason: 'stale', content: { type: 'doc', content: [] },
    })).toBe(true);
  });
});
