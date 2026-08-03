import { describe, expect, it } from 'vitest';
import {
  createTemplateSessionState,
  templateSessionReducer,
} from '../shared/editor/templateSession';
import type { ManagedTemplateDescriptor } from '../shared/types/messages';

const templates: ManagedTemplateDescriptor[] = [
  { id: 'builtin:a', name: 'A', source: 'builtin', sourceLabel: 'Built-in' },
  { id: 'user:b', name: 'B', source: 'user', sourceLabel: 'User', revisionToken: 'b' },
  { id: 'user:c', name: 'C', source: 'user', sourceLabel: 'User', revisionToken: 'c' },
];
const error = { code: 'catalog-unavailable' as const, message: 'Catalog unavailable.' };

describe('template session reducer', () => {
  it('accepts only the latest correlated catalog response', () => {
    let state = createTemplateSessionState();
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'one' });
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'two' });
    state = templateSessionReducer(state, {
      type: 'catalog-succeeded', requestId: 'one', templates, diagnostics: [], personalRootScope: 'local',
    });
    expect(state.templates).toEqual([]);
    state = templateSessionReducer(state, {
      type: 'catalog-succeeded', requestId: 'two', templates, diagnostics: [], personalRootScope: 'remote',
    });
    expect(state.catalog.phase).toBe('ready');
    expect(state.templates).toEqual(templates);
    expect(state.personalRootScope).toBe('remote');
  });

  it('keeps the last ready list and selection when refresh fails', () => {
    let state = createTemplateSessionState();
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'one' });
    state = templateSessionReducer(state, {
      type: 'catalog-succeeded', requestId: 'one', templates, diagnostics: [], personalRootScope: 'local',
    });
    state = templateSessionReducer(state, { type: 'selected', templateId: 'user:b' });
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'two' });
    state = templateSessionReducer(state, { type: 'catalog-failed', requestId: 'two', error });
    expect(state.catalog.phase).toBe('failed');
    expect(state.templates).toEqual(templates);
    expect(state.selectedId).toBe('user:b');
  });

  it('clears selection only when filtering removes it', () => {
    let state = createTemplateSessionState();
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'one' });
    state = templateSessionReducer(state, {
      type: 'catalog-succeeded', requestId: 'one', templates, diagnostics: [], personalRootScope: 'local',
    });
    state = templateSessionReducer(state, { type: 'selected', templateId: 'user:b' });
    state = templateSessionReducer(state, { type: 'query-changed', query: 'B' });
    expect(state.selectedId).toBe('user:b');
    state = templateSessionReducer(state, { type: 'query-changed', query: 'A' });
    expect(state.selectedId).toBeUndefined();
  });

  it('defers new and deleted selection until the UI-owned refresh succeeds', () => {
    let state = createTemplateSessionState();
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'one' });
    state = templateSessionReducer(state, {
      type: 'catalog-succeeded', requestId: 'one', templates, diagnostics: [], personalRootScope: 'local',
    });
    state = templateSessionReducer(state, { type: 'query-changed', query: 'old search' });
    state = templateSessionReducer(state, {
      type: 'action-started', requestId: 'save', operation: 'save',
    });
    state = templateSessionReducer(state, {
      type: 'action-completed', requestId: 'save', templateId: 'user:new',
    });
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'two' });
    state = templateSessionReducer(state, {
      type: 'catalog-succeeded', requestId: 'two', templates: [
        ...templates,
        { id: 'user:new', name: 'New', source: 'user', sourceLabel: 'User', revisionToken: 'new' },
      ], diagnostics: [], personalRootScope: 'local',
    });
    expect(state.source).toBe('user');
    expect(state.query).toBe('');
    expect(state.selectedId).toBe('user:new');

    state = templateSessionReducer(state, {
      type: 'action-started', requestId: 'delete', operation: 'delete', templateId: 'user:new', visibleIndex: 2,
    });
    state = templateSessionReducer(state, { type: 'action-completed', requestId: 'delete' });
    state = templateSessionReducer(state, { type: 'catalog-requested', requestId: 'three' });
    state = templateSessionReducer(state, {
      type: 'catalog-succeeded', requestId: 'three', templates, diagnostics: [], personalRootScope: 'local',
    });
    expect(state.selectedId).toBe('user:c');
  });

  it('announces a dialog cancellation without accepting a stale failure', () => {
    let state = createTemplateSessionState();
    state = templateSessionReducer(state, {
      type: 'action-confirming', operation: 'apply', templateId: 'builtin:a',
    });
    state = templateSessionReducer(state, { type: 'action-dialog-cancelled' });
    expect(state.action).toEqual({
      phase: 'cancelled', operation: 'apply', templateId: 'builtin:a',
    });
    expect(state.focusIntent).toBe('selected');

    state = templateSessionReducer(state, {
      type: 'action-failed', requestId: 'never-sent',
      error: { code: 'operation-failed', message: 'Ignored.' },
    });
    expect(state.action.phase).toBe('cancelled');
  });

  it('records a barrier failure after the UI enters the running state', () => {
    let state = createTemplateSessionState();
    state = templateSessionReducer(state, {
      type: 'action-started', requestId: 'apply-1', operation: 'apply', templateId: 'builtin:a',
    });
    state = templateSessionReducer(state, {
      type: 'action-failed', requestId: 'apply-1',
      error: { code: 'operation-failed', message: 'The pending save failed.' },
    });
    expect(state.action).toMatchObject({
      phase: 'failed', requestId: 'apply-1', operation: 'apply', templateId: 'builtin:a',
    });
  });
});
