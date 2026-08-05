import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_SETTING_KEYS,
  cleanUpLegacySettings,
  formatLegacySettingsPreview,
  type LegacySettingsScope,
} from '../src/legacySettingsCleanup';

const createScope = (
  id: string,
  label: string,
  values: Record<string, unknown>,
  remove: (key: string) => Promise<void> = async () => undefined,
): LegacySettingsScope => ({
  id,
  kind: id === 'user' ? 'user' : id === 'workspace' ? 'workspace' : 'workspaceFolder',
  label,
  read: (key) => values[key],
  remove,
});

describe('legacy settings cleanup', () => {
  it('uses the exact historical allowlist without current host settings', () => {
    expect(LEGACY_SETTING_KEYS).toHaveLength(33);
    expect(LEGACY_SETTING_KEYS).toContain('structuredDocEditor.theme.customStyles');
    expect(LEGACY_SETTING_KEYS).toContain('structuredDocEditor.slide.transition');
    expect(LEGACY_SETTING_KEYS).not.toContain('structuredDocEditor.ui.language');
    expect(LEGACY_SETTING_KEYS).not.toContain('structuredDocEditor.export.imagePath');
    expect(LEGACY_SETTING_KEYS).toContain('structuredDocEditor.diagramRenderer.enabled');
  });

  it('finds and removes legacy settings from user, workspace, and folder scopes', async () => {
    const removed: string[] = [];
    const scopes = [
      createScope('user', 'User', {
        'structuredDocEditor.diagramRenderer.enabled': true,
        'structuredDocEditor.theme.primaryColor': '#123456',
        'structuredDocEditor.ui.language': 'ko',
      }, async (key) => { removed.push(`user:${key}`); }),
      createScope('workspace', 'Workspace', {
        'structuredDocEditor.slide.transition': 'fade',
      }, async (key) => { removed.push(`workspace:${key}`); }),
      createScope('folder:a', 'Workspace Folder: docs', {
        'structuredDocEditor.heading.numbering': true,
      }, async (key) => { removed.push(`folder:a:${key}`); }),
    ];
    const confirm = vi.fn(async () => true);

    const result = await cleanUpLegacySettings(scopes, confirm);

    expect(result).toEqual({
      status: 'completed',
      removed: [
        expect.objectContaining({ key: 'structuredDocEditor.diagramRenderer.enabled', scopeKind: 'user' }),
        expect.objectContaining({ key: 'structuredDocEditor.theme.primaryColor', scopeKind: 'user' }),
        expect.objectContaining({ key: 'structuredDocEditor.slide.transition', scopeKind: 'workspace' }),
        expect.objectContaining({ key: 'structuredDocEditor.heading.numbering', scopeKind: 'workspaceFolder' }),
      ],
      failures: [],
    });
    expect(removed).toEqual([
      'user:structuredDocEditor.diagramRenderer.enabled',
      'user:structuredDocEditor.theme.primaryColor',
      'workspace:structuredDocEditor.slide.transition',
      'folder:a:structuredDocEditor.heading.numbering',
    ]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'structuredDocEditor.ui.language' }),
    ]));
  });

  it('does nothing when no legacy setting is present', async () => {
    const remove = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => true);

    const result = await cleanUpLegacySettings([
      createScope('user', 'User', {
        'structuredDocEditor.ui.language': 'en',
        'structuredDocEditor.export.imagePath': 'relative',
      }, remove),
    ], confirm);

    expect(result).toEqual({ status: 'none' });
    expect(confirm).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('leaves every setting untouched when the user cancels', async () => {
    const remove = vi.fn(async () => undefined);

    const result = await cleanUpLegacySettings([
      createScope('user', 'User', {
        'structuredDocEditor.theme.customStyles': 'body {}',
      }, remove),
    ], async () => false);

    expect(result).toEqual({
      status: 'cancelled',
      targets: [expect.objectContaining({ key: 'structuredDocEditor.theme.customStyles' })],
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('continues after a failed removal and reports partial success', async () => {
    const scope = createScope('user', 'User', {
      'structuredDocEditor.caption.style': 'ieee',
      'structuredDocEditor.theme.companyName': 'Example',
    }, async (key) => {
      if (key === 'structuredDocEditor.caption.style') throw new Error('read only');
    });

    const result = await cleanUpLegacySettings([scope], async () => true);

    expect(result).toEqual({
      status: 'completed',
      removed: [expect.objectContaining({ key: 'structuredDocEditor.theme.companyName' })],
      failures: [{
        target: expect.objectContaining({ key: 'structuredDocEditor.caption.style' }),
        error: expect.objectContaining({ message: 'read only' }),
      }],
    });
  });

  it('formats the confirmation preview by scope without values', () => {
    expect(formatLegacySettingsPreview([
      {
        key: 'structuredDocEditor.theme.primaryColor',
        scopeId: 'user',
        scopeKind: 'user',
        scopeLabel: 'User',
      },
      {
        key: 'structuredDocEditor.slide.transition',
        scopeId: 'user',
        scopeKind: 'user',
        scopeLabel: 'User',
      },
      {
        key: 'structuredDocEditor.heading.numbering',
        scopeId: 'folder:a',
        scopeKind: 'workspaceFolder',
        scopeLabel: 'Workspace Folder: docs',
      },
    ])).toBe([
      'User (2)',
      '- structuredDocEditor.theme.primaryColor',
      '- structuredDocEditor.slide.transition',
      '',
      'Workspace Folder: docs (1)',
      '- structuredDocEditor.heading.numbering',
    ].join('\n'));
  });
});
