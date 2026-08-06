import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  scripts?: Record<string, string>;
  activationEvents?: unknown;
  contributes?: {
    customEditors?: unknown;
    commands?: unknown;
    keybindings?: unknown;
    configuration?: {
      properties?: Record<string, unknown>;
    };
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as PackageManifest;

describe('VS Code package manifest', () => {
  it('activates both contributed custom editors explicitly', () => {
    expect(manifest.activationEvents).toEqual(expect.arrayContaining([
      'onCustomEditor:structuredDocEditor.sdoc',
      'onCustomEditor:structuredDocEditor.sdocBook',
    ]));

    expect(manifest.contributes?.customEditors).toEqual(expect.arrayContaining([
      expect.objectContaining({ viewType: 'structuredDocEditor.sdoc' }),
      expect.objectContaining({ viewType: 'structuredDocEditor.sdocBook' }),
    ]));
  });

  it('contributes an Auto/Korean/English UI language preference', () => {
    expect(manifest.contributes?.configuration?.properties?.['structuredDocEditor.ui.language'])
      .toEqual(expect.objectContaining({
        type: 'string',
        default: 'auto',
        enum: ['auto', 'ko', 'en'],
        scope: 'window',
      }));
  });

  it('exposes only current host-level settings in the VS Code Settings UI', () => {
    const properties = manifest.contributes?.configuration?.properties ?? {};

    expect(Object.keys(properties).sort()).toEqual([
      'structuredDocEditor.diagramRenderer.allowPrivateNetwork',
      'structuredDocEditor.diagramRenderer.endpoint',
      'structuredDocEditor.export.imagePath',
      'structuredDocEditor.image.defaultAlignment',
      'structuredDocEditor.ui.language',
    ]);
    expect(properties).not.toHaveProperty('structuredDocEditor.theme.customStyles');
  });

  it('routes the platform bold shortcut to the focused editable sdoc editor', () => {
    expect(manifest.contributes?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'structuredDocEditor.toggleBold' }),
    ]));
    expect(manifest.contributes?.keybindings).toEqual(expect.arrayContaining([
      {
        command: 'structuredDocEditor.toggleBold',
        key: 'ctrl+b',
        mac: 'cmd+b',
        when: 'activeCustomEditorId == structuredDocEditor.sdoc && focusedCustomEditorIsEditable && structuredDocEditor.editorTextFocus',
      },
    ]));
    expect(manifest.contributes?.menus?.commandPalette).toEqual(expect.arrayContaining([
      {
        command: 'structuredDocEditor.toggleBold',
        when: 'false',
      },
    ]));
  });

  it('contributes the explicit legacy settings cleanup command', () => {
    expect(manifest.contributes?.commands).toEqual(expect.arrayContaining([
      {
        command: 'structuredDocEditor.cleanUpLegacySettings',
        title: 'Clean Up Legacy Settings',
        category: 'Structured Doc Editor',
      },
    ]));
  });

  it('copies the offline export runtime as part of every extension build', () => {
    expect(manifest.scripts?.build).toContain('npm run export-assets:copy');
    expect(manifest.scripts?.['export-assets:copy']).toBe('node scripts/copy-export-assets.mjs');
  });
});
