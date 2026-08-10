import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DocumentSyncState } from '../shared/persistence/DocumentSyncCoordinator';
import { DocumentHeader } from '../shared/editor/components/DocumentHeader';
import { EditorI18nProvider, useEditorI18n } from '../shared/editor/i18n';
import {
  createHostDocumentSaveState,
  deriveDocumentSavePresentation,
  markHostDocumentDirty,
  observeDocumentSaveState,
} from '../shared/editor/saveStatus';

const syncState = (patch: Partial<DocumentSyncState> = {}): DocumentSyncState => ({
  sessionId: 'session-a',
  documentId: 'doc-a',
  acknowledgedRevision: 4,
  localGeneration: 0,
  acknowledgedGeneration: 0,
  localMutation: null,
  inFlight: null,
  pending: null,
  error: null,
  conflict: null,
  externalChange: null,
  ...patch,
});

const LocalizedDocumentHeader = ({ phase }: { phase: 'disk-pending' | 'saved' }) => {
  const { t } = useEditorI18n();
  return React.createElement(DocumentHeader, {
    author: '',
    version: '',
    created: '2026-08-06T00:00:00.000Z',
    modified: '2026-08-06T01:00:00.000Z',
    onAuthorChange: () => undefined,
    onVersionChange: () => undefined,
    saveStatus: {
      phase,
      label: t(phase === 'saved' ? 'editor.saved' : 'editor.diskPending'),
      retryable: false,
    },
  });
};

const renderKoreanDocumentHeader = (phase: 'disk-pending' | 'saved'): string =>
  renderToStaticMarkup(React.createElement(
    EditorI18nProvider,
    { locale: 'ko' },
    React.createElement(LocalizedDocumentHeader, { phase }),
  ));

describe('document save presentation', () => {
  it('renders the host-confirmed final save state as 저장됨 in Korean', () => {
    const markup = renderKoreanDocumentHeader('saved');

    expect(markup).toContain('role="status"');
    expect(markup).toContain('저장됨');
    expect(markup).not.toContain('디스크 저장 대기 중');
  });

  it('distinguishes the Korean disk-pending state from the final saved state', () => {
    const markup = renderKoreanDocumentHeader('disk-pending');

    expect(markup).toContain('role="status"');
    expect(markup).toContain('디스크 저장 대기 중');
    expect(markup).not.toContain('>저장됨<');
  });

  it('does not call a buffer acknowledgement saved until a matching disk-save event arrives', () => {
    const initial = createHostDocumentSaveState({
      sessionId: 'session-a', documentId: 'doc-a', revision: 4, isDirty: false,
    });
    expect(deriveDocumentSavePresentation(syncState(), initial, 'editable').phase).toBe('saved');

    const dirty = markHostDocumentDirty(initial, 5, '2026-08-06T01:00:00.000Z');
    expect(deriveDocumentSavePresentation(
      syncState({ acknowledgedRevision: 5, acknowledgedModified: dirty.modified }),
      dirty,
      'editable',
    ).phase).toBe('disk-pending');

    const saving = observeDocumentSaveState(dirty, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 1, revision: 5, phase: 'saving',
    });
    expect(deriveDocumentSavePresentation(syncState({ acknowledgedRevision: 5 }), saving, 'editable').phase)
      .toBe('saving');

    const saved = observeDocumentSaveState(saving, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 1, revision: 5, phase: 'saved', modified: dirty.modified,
    });
    expect(deriveDocumentSavePresentation(syncState({ acknowledgedRevision: 5 }), saved, 'editable').phase)
      .toBe('saved');
  });

  it('preserves an active save generation when its flush acknowledgement arrives', () => {
    const dirty = createHostDocumentSaveState({
      sessionId: 'session-a', documentId: 'doc-a', revision: 4, isDirty: true,
    });
    const saving = observeDocumentSaveState(dirty, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 1, revision: 4, phase: 'saving',
    });
    const acknowledgedDuringSave = markHostDocumentDirty(
      saving,
      5,
      '2026-08-06T01:00:00.000Z',
    );
    expect(acknowledgedDuringSave.phase).toBe('saving');

    const saved = observeDocumentSaveState(acknowledgedDuringSave, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 1, revision: 5, phase: 'saved',
      modified: '2026-08-06T01:00:00.000Z',
    });
    expect(saved.phase).toBe('saved');
    expect(deriveDocumentSavePresentation(
      syncState({ acknowledgedRevision: 5 }),
      saved,
      'editable',
    ).phase).toBe('saved');
  });

  it('ignores stale, cross-document, and terminal-regression save events', () => {
    const initial = createHostDocumentSaveState({
      sessionId: 'session-a', documentId: 'doc-a', revision: 4, isDirty: true,
    });
    const saving = observeDocumentSaveState(initial, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 2, revision: 5, phase: 'saving',
    });
    const saved = observeDocumentSaveState(saving, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 2, revision: 5, phase: 'saved', modified: '2026-08-06T01:00:00.000Z',
    });

    expect(observeDocumentSaveState(saved, {
      type: 'documentSaveState', sessionId: 'session-b', documentId: 'doc-a',
      saveGeneration: 3, revision: 6, phase: 'saved',
    })).toBe(saved);
    expect(observeDocumentSaveState(saved, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 1, revision: 6, phase: 'saved',
    })).toBe(saved);
    expect(observeDocumentSaveState(saved, {
      type: 'documentSaveState', sessionId: 'session-a', documentId: 'doc-a',
      saveGeneration: 2, revision: 5, phase: 'saving',
    })).toBe(saved);
  });

  it('prioritizes invalid, conflict, transient failure, syncing, and newer local changes', () => {
    const host = createHostDocumentSaveState({
      sessionId: 'session-a', documentId: 'doc-a', revision: 4, isDirty: false,
    });
    expect(deriveDocumentSavePresentation(syncState(), host, 'invalid').phase).toBe('blocked');
    expect(deriveDocumentSavePresentation(syncState({
      externalChange: { revision: 5, hostSnapshot: { content: { type: 'doc' }, meta: {}, documentSettings: null } },
    }), host, 'editable').phase).toBe('conflict');
    expect(deriveDocumentSavePresentation(syncState({
      error: { editId: 'e', localGeneration: 1, code: 'WRITE_FAILED', message: 'retry' },
    }), host, 'editable')).toMatchObject({ phase: 'failed', retryable: true });
    expect(deriveDocumentSavePresentation(syncState({
      localGeneration: 1,
      inFlight: {
        sessionId: 'session-a', documentId: 'doc-a', editId: 'e', baseRevision: 4,
        localGeneration: 1, mutation: { content: { type: 'doc' }, meta: {}, documentSettings: null },
      },
    }), host, 'editable').phase).toBe('syncing');
    expect(deriveDocumentSavePresentation(syncState({
      localGeneration: 2, acknowledgedGeneration: 1,
    }), host, 'editable').phase).toBe('modified');
  });
});
