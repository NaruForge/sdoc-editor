export const LEGACY_SETTING_KEYS = [
  'structuredDocEditor.caption.crossRefIncludeCaption',
  'structuredDocEditor.caption.numbering',
  'structuredDocEditor.caption.style',
  'structuredDocEditor.equation.numbering',
  'structuredDocEditor.export.outputDir',
  'structuredDocEditor.export.pdfScale',
  'structuredDocEditor.export.selfContained',
  'structuredDocEditor.font.body',
  'structuredDocEditor.font.bold',
  'structuredDocEditor.font.h1',
  'structuredDocEditor.font.h2',
  'structuredDocEditor.font.h3',
  'structuredDocEditor.heading.decoration',
  'structuredDocEditor.heading.h1Color',
  'structuredDocEditor.heading.h2Color',
  'structuredDocEditor.heading.h3Color',
  'structuredDocEditor.heading.h4Color',
  'structuredDocEditor.heading.h5Color',
  'structuredDocEditor.heading.h6Color',
  'structuredDocEditor.heading.numbering',
  'structuredDocEditor.slide.accentColor',
  'structuredDocEditor.slide.breakLevel',
  'structuredDocEditor.slide.primaryColor',
  'structuredDocEditor.slide.showTitleSlide',
  'structuredDocEditor.slide.transition',
  'structuredDocEditor.theme.accentColor',
  'structuredDocEditor.theme.companyLogo',
  'structuredDocEditor.theme.companyName',
  'structuredDocEditor.theme.customStyles',
  'structuredDocEditor.theme.fontFamily',
  'structuredDocEditor.theme.primaryColor',
  'structuredDocEditor.update.sharedFolder',
] as const;

export type LegacySettingsScopeKind = 'user' | 'workspace' | 'workspaceFolder';

export interface LegacySettingsScope {
  id: string;
  kind: LegacySettingsScopeKind;
  label: string;
  read: (key: string) => unknown;
  remove: (key: string) => Promise<void>;
}

export interface LegacySettingTarget {
  key: string;
  scopeId: string;
  scopeKind: LegacySettingsScopeKind;
  scopeLabel: string;
}

export interface LegacySettingRemovalFailure {
  target: LegacySettingTarget;
  error: unknown;
}

export type LegacySettingsCleanupResult =
  | { status: 'none' }
  | { status: 'cancelled'; targets: LegacySettingTarget[] }
  | {
    status: 'completed';
    removed: LegacySettingTarget[];
    failures: LegacySettingRemovalFailure[];
  };

interface DetectedLegacySetting {
  target: LegacySettingTarget;
  scope: LegacySettingsScope;
}

const detectLegacySettings = (scopes: readonly LegacySettingsScope[]): DetectedLegacySetting[] =>
  scopes.flatMap((scope) => LEGACY_SETTING_KEYS.flatMap((key) => (
    scope.read(key) === undefined
      ? []
      : [{
        target: {
          key,
          scopeId: scope.id,
          scopeKind: scope.kind,
          scopeLabel: scope.label,
        },
        scope,
      }]
  )));

export async function cleanUpLegacySettings(
  scopes: readonly LegacySettingsScope[],
  confirm: (targets: readonly LegacySettingTarget[]) => Promise<boolean>,
): Promise<LegacySettingsCleanupResult> {
  const detected = detectLegacySettings(scopes);
  if (detected.length === 0) return { status: 'none' };

  const targets = detected.map(({ target }) => target);
  if (!await confirm(targets)) return { status: 'cancelled', targets };

  const removed: LegacySettingTarget[] = [];
  const failures: LegacySettingRemovalFailure[] = [];
  for (const { target, scope } of detected) {
    try {
      await scope.remove(target.key);
      removed.push(target);
    } catch (error) {
      failures.push({ target, error });
    }
  }

  return { status: 'completed', removed, failures };
}

export function formatLegacySettingsPreview(
  targets: readonly LegacySettingTarget[],
): string {
  const groups = new Map<string, string[]>();
  for (const target of targets) {
    const keys = groups.get(target.scopeLabel) ?? [];
    keys.push(target.key);
    groups.set(target.scopeLabel, keys);
  }

  return [...groups.entries()]
    .map(([label, keys]) => `${label} (${keys.length})\n${keys.map((key) => `- ${key}`).join('\n')}`)
    .join('\n\n');
}
