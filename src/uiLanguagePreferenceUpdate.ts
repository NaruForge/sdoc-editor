import type { UiLanguagePreference } from '../shared/editor/i18n/locale';

export interface UiLanguagePreferenceUpdateDependencies {
  write(preference: UiLanguagePreference): Promise<void>;
  publishCurrent(): void;
  recoverFromWriteFailure(error: unknown): Promise<void>;
}

export type UiLanguagePreferenceUpdateResult = 'applied' | 'failed';

export const OPEN_USER_SETTINGS_ACTION = 'Open User Settings';
export const UI_LANGUAGE_WRITE_FAILURE_MESSAGE =
  'Structured Doc interface language was not changed because VS Code could not write User Settings. Fix errors or warnings in User Settings, then try again.';

export interface UiLanguageWriteFailureRecoveryDependencies {
  report(error: unknown): void;
  showError(message: string, action: string): Promise<string | undefined>;
  openUserSettings(): Promise<void>;
}

export async function recoverFromUiLanguageWriteFailure(
  error: unknown,
  dependencies: UiLanguageWriteFailureRecoveryDependencies,
): Promise<void> {
  dependencies.report(error);
  const selectedAction = await dependencies.showError(
    UI_LANGUAGE_WRITE_FAILURE_MESSAGE,
    OPEN_USER_SETTINGS_ACTION,
  );
  if (selectedAction === OPEN_USER_SETTINGS_ACTION) {
    await dependencies.openUserSettings();
  }
}

/**
 * Persists a UI-language preference without allowing a rejected VS Code settings write
 * to poison the editor's recoverable message queue. The host always republishes the
 * persisted value so the controlled webview select either confirms or rolls back.
 */
export async function updateUiLanguagePreference(
  preference: UiLanguagePreference,
  dependencies: UiLanguagePreferenceUpdateDependencies,
): Promise<UiLanguagePreferenceUpdateResult> {
  try {
    await dependencies.write(preference);
  } catch (error: unknown) {
    try {
      dependencies.publishCurrent();
    } catch {
      // The panel may have been disposed while VS Code was reporting the settings error.
    }
    try {
      await dependencies.recoverFromWriteFailure(error);
    } catch {
      // Failure reporting must not rethrow the original settings error into the message queue.
    }
    return 'failed';
  }

  dependencies.publishCurrent();
  return 'applied';
}
