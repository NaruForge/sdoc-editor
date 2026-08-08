import { describe, expect, it } from 'vitest';
import {
  createInitialEditorState,
  editorReducer,
} from '../shared/editor/context/EditorContext';
import { toSettingsSyncState } from '../shared/editor/designSettings';

describe('Design settings editor state', () => {
  it('re-resolves portable settings and caption derivatives for every document patch', () => {
    const initial = createInitialEditorState('en');
    const korean = editorReducer(initial, {
      type: 'SET_DOC_SETTINGS',
      payload: { captionStyle: 'korean', headingDecoration: false },
    });

    expect(korean.settingsSnapshot.entries.captionStyle.source).toBe('document');
    expect(korean.settings.captionStyle).toBe('korean');
    expect(korean.settings.imageCaptionPrefix).toBe('그림 ');
    expect(korean.settings.tableCaptionPrefix).toBe('표 ');
    expect(korean.settings.headingDecoration).toBe(false);

    const removed = editorReducer(korean, {
      type: 'SET_DOC_SETTINGS',
      payload: null,
    });
    expect(removed.settingsSnapshot.entries.captionStyle.source).toBe('built-in');
    expect(removed.settings.captionStyle).toBe('modern');
    expect(removed.settings.imageCaptionPrefix).toBe('Figure ');
  });

  it('keeps session view preferences out of persisted settings', () => {
    const initial = editorReducer(createInitialEditorState('en'), {
      type: 'SET_DOC_SETTINGS',
      payload: { headingNumbering: false, headingDecoration: false },
    });
    const viewed = editorReducer(initial, {
      type: 'SET_VIEW_PREFERENCES',
      payload: { headingNumbering: 'show', headingDecoration: 'hide' },
    });

    expect(viewed.docSettings).toEqual({
      headingNumbering: false,
      headingDecoration: false,
    });
    expect(viewed.settingsSnapshot.entries.headingNumbering.source).toBe('temporary-view');
    expect(viewed.settings.headingNumbering).toBe(true);
    expect(viewed.settings.headingDecoration).toBe(false);
  });

  it('accepts legacy host messages only for host-owned editor settings', () => {
    const updated = editorReducer(createInitialEditorState('en'), {
      type: 'SET_SETTINGS',
      payload: {
        captionStyle: 'ieee',
        defaultImageAlignment: 'right',
        exportImagePath: 'absolute',
        fontWeightBody: 600,
      },
    });

    expect(updated.settingsSnapshot.entries.captionStyle.source).toBe('built-in');
    expect(updated.settings.captionStyle).toBe('modern');
    expect(updated.settings.defaultImageAlignment).toBe('right');
    expect(updated.settings.exportImagePath).toBe('absolute');
    expect(updated.settings.fontWeightBody).toBe(600);
  });

  it('stores actual synchronization presentation independently from settings', () => {
    const initial = createInitialEditorState('en');
    const failed = editorReducer(initial, {
      type: 'SET_SETTINGS_SYNC_STATE',
      payload: { status: 'failed', message: 'write failed', canRetry: true },
    });

    expect(failed.settingsSyncState).toEqual({
      status: 'failed',
      message: 'write failed',
      canRetry: true,
    });
    expect(failed.settingsSnapshot).toBe(initial.settingsSnapshot);
  });

  it('maps document persistence truth to Design synchronization states', () => {
    expect(toSettingsSyncState({ phase: 'modified', retryable: false }))
      .toEqual({ status: 'local-change' });
    expect(toSettingsSyncState({ phase: 'disk-pending', retryable: false }))
      .toEqual({ status: 'synced' });
    expect(toSettingsSyncState({
      phase: 'failed',
      retryable: true,
      message: 'write failed',
    })).toEqual({ status: 'failed', canRetry: true, message: 'write failed' });
    expect(toSettingsSyncState({ phase: 'conflict', retryable: false }))
      .toEqual({ status: 'conflict' });
  });
});
