import { resolveEditorSettings } from '@shared/settingsResolver';
import type { DocumentSettings, ResolvedEditorSettings } from '@shared/types';
import type { EditorSettings, HostToEditorMessage } from '@shared/types/messages';

type TauriSettingsAction =
  | { type: 'SET_SETTINGS'; payload: Partial<EditorSettings> }
  | { type: 'SET_DOC_SETTINGS'; payload: Partial<DocumentSettings> | null };

/** Apply only settings messages that have been acknowledged by the Tauri host. */
export function dispatchTauriSettingsMessage(
  message: HostToEditorMessage,
  dispatch: (action: TauriSettingsAction) => void,
): boolean {
  switch (message.type) {
    case 'settingsChanged':
      dispatch({ type: 'SET_SETTINGS', payload: message.settings });
      return true;
    case 'docSettingsChanged':
      dispatch({ type: 'SET_DOC_SETTINGS', payload: message.docSettings ?? null });
      return true;
    default:
      return false;
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

/** Narrow native preferences and resolve all semantic defaults in the shared TypeScript core. */
export function resolveTauriEditorSettings(
  value: unknown,
  documentSettings: Partial<DocumentSettings> | null,
): ResolvedEditorSettings {
  const raw = record(value) ?? {};
  const external: Partial<DocumentSettings> = {};
  for (const key of ['headingDecoration'] as const) {
    if (typeof raw[key] === 'boolean') external[key] = raw[key];
  }
  for (const key of [
    'headingH1Color', 'headingH2Color', 'headingH3Color',
    'headingH4Color', 'headingH5Color', 'headingH6Color',
  ] as const) {
    if (typeof raw[key] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(raw[key])) external[key] = raw[key];
  }
  return resolveEditorSettings(documentSettings ?? undefined, external, {
    defaultImageAlignment: raw.defaultImageAlignment === 'left'
      || raw.defaultImageAlignment === 'right' || raw.defaultImageAlignment === 'center'
      ? raw.defaultImageAlignment : undefined,
    exportImagePath: raw.exportImagePath === 'absolute' || raw.exportImagePath === 'relative'
      ? raw.exportImagePath : undefined,
  });
}
