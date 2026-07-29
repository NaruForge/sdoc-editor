import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  activationEvents?: unknown;
  contributes?: {
    customEditors?: unknown;
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
});
