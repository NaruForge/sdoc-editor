import { describe, expect, it, vi } from 'vitest';
import {
  OPEN_USER_SETTINGS_ACTION,
  recoverFromUiLanguageWriteFailure,
  updateUiLanguagePreference,
  type UiLanguageWriteFailureRecoveryDependencies,
  type UiLanguagePreferenceUpdateDependencies,
} from '../src/uiLanguagePreferenceUpdate';

const createDependencies = (
  overrides: Partial<UiLanguagePreferenceUpdateDependencies> = {},
): UiLanguagePreferenceUpdateDependencies => ({
  write: vi.fn(async () => {}),
  publishCurrent: vi.fn(),
  recoverFromWriteFailure: vi.fn(async () => {}),
  ...overrides,
});

describe('UI language preference update', () => {
  it('writes the requested preference and publishes the persisted value', async () => {
    const dependencies = createDependencies();

    await expect(updateUiLanguagePreference('ko', dependencies)).resolves.toBe('applied');

    expect(dependencies.write).toHaveBeenCalledWith('ko');
    expect(dependencies.publishCurrent).toHaveBeenCalledOnce();
    expect(dependencies.recoverFromWriteFailure).not.toHaveBeenCalled();
  });

  it('publishes the stored value to roll back the UI and offers recovery on write failure', async () => {
    const failure = new Error('Unable to write into user settings.');
    const dependencies = createDependencies({
      write: vi.fn(async () => { throw failure; }),
    });

    await expect(updateUiLanguagePreference('en', dependencies)).resolves.toBe('failed');

    expect(dependencies.publishCurrent).toHaveBeenCalledOnce();
    expect(dependencies.recoverFromWriteFailure).toHaveBeenCalledWith(failure);
  });

  it('still completes recovery when publishing the rollback cannot reach a disposed webview', async () => {
    const failure = new Error('Unable to write into user settings.');
    const dependencies = createDependencies({
      write: vi.fn(async () => { throw failure; }),
      publishCurrent: vi.fn(() => { throw new Error('disposed'); }),
    });

    await expect(updateUiLanguagePreference('auto', dependencies)).resolves.toBe('failed');

    expect(dependencies.recoverFromWriteFailure).toHaveBeenCalledWith(failure);
  });

  it('does not reject the editor message queue when recovery UI also fails', async () => {
    const dependencies = createDependencies({
      write: vi.fn(async () => { throw new Error('write failed'); }),
      recoverFromWriteFailure: vi.fn(async () => { throw new Error('notification failed'); }),
    });

    await expect(updateUiLanguagePreference('ko', dependencies)).resolves.toBe('failed');
  });
});

describe('UI language write failure recovery', () => {
  const createRecoveryDependencies = (
    overrides: Partial<UiLanguageWriteFailureRecoveryDependencies> = {},
  ): UiLanguageWriteFailureRecoveryDependencies => ({
    report: vi.fn(),
    showError: vi.fn(async () => undefined),
    openUserSettings: vi.fn(async () => {}),
    ...overrides,
  });

  it('opens User Settings JSON when the user selects the recovery action', async () => {
    const failure = new Error('settings contain errors');
    const dependencies = createRecoveryDependencies({
      showError: vi.fn(async () => OPEN_USER_SETTINGS_ACTION),
    });

    await recoverFromUiLanguageWriteFailure(failure, dependencies);

    expect(dependencies.report).toHaveBeenCalledWith(failure);
    expect(dependencies.showError).toHaveBeenCalledWith(
      expect.stringContaining('interface language was not changed'),
      OPEN_USER_SETTINGS_ACTION,
    );
    expect(dependencies.openUserSettings).toHaveBeenCalledOnce();
  });

  it('does not open settings when the recovery action is dismissed', async () => {
    const dependencies = createRecoveryDependencies();

    await recoverFromUiLanguageWriteFailure(new Error('cancelled'), dependencies);

    expect(dependencies.openUserSettings).not.toHaveBeenCalled();
  });
});
