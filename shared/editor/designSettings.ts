import type {
  DocumentSettingKey,
  DocumentSettings,
  ResolvedDocumentSettingsSnapshot,
  TemporaryDocumentViewPreferences,
} from '../types';
import type { DocumentSavePresentation } from './saveStatus';

export type SettingsSyncState =
  | { status: 'idle' }
  | { status: 'local-change' }
  | { status: 'syncing' }
  | { status: 'synced' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'failed'; message?: string; canRetry: boolean }
  | { status: 'conflict'; message?: string };

export function toSettingsSyncState(
  presentation: DocumentSavePresentation | null,
): SettingsSyncState {
  if (!presentation) return { status: 'idle' };
  switch (presentation.phase) {
    case 'blocked':
      return { status: 'failed', canRetry: false, ...(presentation.message
        ? { message: presentation.message }
        : {}) };
    case 'conflict':
      return { status: 'conflict', ...(presentation.message
        ? { message: presentation.message }
        : {}) };
    case 'failed':
      return {
        status: 'failed',
        canRetry: presentation.retryable,
        ...(presentation.message ? { message: presentation.message } : {}),
      };
    case 'saving':
      return { status: 'saving' };
    case 'syncing':
      return { status: 'syncing' };
    case 'modified':
      return { status: 'local-change' };
    case 'disk-pending':
      return { status: 'synced' };
    case 'saved':
      return { status: 'saved' };
  }
}

export interface DesignPanelAdapter {
  /** Resolver snapshot shared with editor rendering and export preflight. */
  settingsSnapshot: ResolvedDocumentSettingsSnapshot;
  /** Controlled, editor-session-only preferences. Never persist these in `.sdoc`. */
  viewPreferences: Required<TemporaryDocumentViewPreferences>;
  onViewPreferencesChange: (preferences: Required<TemporaryDocumentViewPreferences>) => void;
  /** Host-confirmed persistence state; `saved` must only follow a disk save. */
  settingsSyncState?: SettingsSyncState;
  onRetrySettingsSync?: () => void;
}

export function createDefaultViewPreferences(): Required<TemporaryDocumentViewPreferences> {
  return {
    headingNumbering: 'follow-document',
    headingDecoration: 'follow-document',
  };
}

function compactSettings(settings: Partial<DocumentSettings>): Partial<DocumentSettings> | null {
  return Object.keys(settings).length > 0 ? settings : null;
}

export function removeSettingsOverrides(
  current: Partial<DocumentSettings> | null,
  keys: readonly DocumentSettingKey[],
): Partial<DocumentSettings> | null {
  const next = { ...(current ?? {}) };
  for (const key of keys) delete next[key];
  return compactSettings(next);
}

export function restoreSettingsGroupBaseline(
  current: Partial<DocumentSettings> | null,
  baseline: Partial<DocumentSettings> | null,
  keys: readonly DocumentSettingKey[],
): Partial<DocumentSettings> | null {
  const next = { ...(current ?? {}) };
  for (const key of keys) {
    const baselineValue = baseline?.[key];
    if (baselineValue === undefined) delete next[key];
    else (next as Record<DocumentSettingKey, unknown>)[key] = baselineValue;
  }
  return compactSettings(next);
}

export function materializeSettingsGroup(
  current: Partial<DocumentSettings> | null,
  snapshot: ResolvedDocumentSettingsSnapshot,
  keys: readonly DocumentSettingKey[],
): Partial<DocumentSettings> {
  const next = { ...(current ?? {}) };
  for (const key of keys) {
    (next as Record<DocumentSettingKey, unknown>)[key] = snapshot.values[key];
  }
  return next;
}

export function countChangedSettings(
  current: Partial<DocumentSettings> | null,
  baseline: Partial<DocumentSettings> | null,
  keys: readonly DocumentSettingKey[],
): number {
  return keys.filter((key) => !Object.is(current?.[key], baseline?.[key])).length;
}
