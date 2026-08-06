import { describe, expect, it } from 'vitest';
import { canRecoverInvalidDocument } from '../shared/persistence/invalidDocumentRecovery';

const state = {
  writeBlocked: true,
  hasLoadedValidDocument: true,
  sessionId: 'session-a',
  documentId: 'file:///document.sdoc',
  revision: 7,
};

describe('invalid document recovery identity', () => {
  it('accepts only the exact blocked editor session, document, and revision', () => {
    expect(canRecoverInvalidDocument(state, {
      sessionId: 'session-a', documentId: 'file:///document.sdoc', baseRevision: 7,
    })).toBe(true);
    expect(canRecoverInvalidDocument(state, {
      sessionId: 'session-b', documentId: 'file:///document.sdoc', baseRevision: 7,
    })).toBe(false);
    expect(canRecoverInvalidDocument(state, {
      sessionId: 'session-a', documentId: 'file:///other.sdoc', baseRevision: 7,
    })).toBe(false);
    expect(canRecoverInvalidDocument(state, {
      sessionId: 'session-a', documentId: 'file:///document.sdoc', baseRevision: 6,
    })).toBe(false);
  });

  it('rejects recovery without a valid prior snapshot or active write block', () => {
    const request = {
      sessionId: 'session-a', documentId: 'file:///document.sdoc', baseRevision: 7,
    };
    expect(canRecoverInvalidDocument({ ...state, writeBlocked: false }, request)).toBe(false);
    expect(canRecoverInvalidDocument({ ...state, hasLoadedValidDocument: false }, request)).toBe(false);
  });
});
