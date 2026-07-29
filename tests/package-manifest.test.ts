import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
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
});
