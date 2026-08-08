import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SETTING_REGISTRY,
  SETTINGS_DEFAULTS,
  diffDocumentSettingsSnapshots,
  materializeDocumentSettings,
  resolveDocumentSettingsSnapshot,
} from '../shared/settingsResolver';

describe('provenance-aware settings resolution', () => {
  it('resolves portable standalone settings without legacy host defaults', () => {
    const snapshot = resolveDocumentSettingsSnapshot({
      context: 'standalone',
      documentSettings: { captionStyle: 'korean', headingNumbering: false },
      hostSettings: { captionStyle: 'ieee', pdfScale: 125 },
    });

    expect(snapshot.values).toMatchObject({
      captionStyle: 'korean',
      headingNumbering: false,
      pdfScale: SETTINGS_DEFAULTS.pdfScale,
    });
    expect(snapshot.entries.captionStyle).toMatchObject({
      source: 'document',
      scope: 'document',
      portability: 'portable',
    });
    expect(snapshot.entries.pdfScale).toMatchObject({
      source: 'built-in',
      scope: 'product',
      portability: 'portable',
    });
  });

  it('uses a Book profile over built-ins and reports conflicting chapter overrides', () => {
    const snapshot = resolveDocumentSettingsSnapshot({
      context: 'book',
      bookProfileSettings: { captionStyle: 'iso', headingNumbering: false },
      hostSettings: { captionStyle: 'korean', headingNumbering: true },
      chapterSettings: [
        { documentPath: './one.sdoc', settings: { captionStyle: 'ieee', headingNumbering: false } },
        { documentPath: './two.sdoc', settings: { captionStyle: 'iso' } },
      ],
    });

    expect(snapshot.values.captionStyle).toBe('iso');
    expect(snapshot.values.headingNumbering).toBe(false);
    expect(snapshot.entries.captionStyle.source).toBe('book-profile');
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'CHAPTER_SETTING_OVERRIDDEN',
        key: 'captionStyle',
        documentPath: './one.sdoc',
      }),
    ]);
  });

  it('keeps temporary view preferences session-only in editor resolution', () => {
    const snapshot = resolveDocumentSettingsSnapshot({
      context: 'editor',
      documentSettings: { headingNumbering: false, headingDecoration: false },
      hostSettings: { captionStyle: 'ieee' },
      temporaryView: { headingNumbering: 'show', headingDecoration: 'follow-document' },
    });

    expect(snapshot.values.headingNumbering).toBe(true);
    expect(snapshot.entries.headingNumbering).toMatchObject({
      source: 'temporary-view',
      scope: 'session',
      portability: 'session-only',
    });
    expect(snapshot.entries.headingDecoration.source).toBe('document');
    expect(snapshot.entries.captionStyle).toMatchObject({
      source: 'host',
      scope: 'host',
      portability: 'host-local',
    });
  });

  it('provides deterministic fingerprints, materialization, and ordered diffs', () => {
    const baseline = resolveDocumentSettingsSnapshot({
      context: 'standalone',
      documentSettings: { captionStyle: 'modern', headingNumbering: true },
    });
    const reorderedBaseline = resolveDocumentSettingsSnapshot({
      context: 'standalone',
      documentSettings: { headingNumbering: true, captionStyle: 'modern' },
    });
    const current = resolveDocumentSettingsSnapshot({
      context: 'standalone',
      documentSettings: { captionStyle: 'korean', headingNumbering: false },
    });

    expect(baseline.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reorderedBaseline.fingerprint).toBe(baseline.fingerprint);
    expect(materializeDocumentSettings(current, ['captionStyle', 'headingNumbering']))
      .toEqual({ captionStyle: 'korean', headingNumbering: false });
    expect(diffDocumentSettingsSnapshots(baseline, current).map((change) => change.key))
      .toEqual(['headingNumbering', 'captionStyle']);
    expect(Object.keys(DOCUMENT_SETTING_REGISTRY)).toEqual(Object.keys(SETTINGS_DEFAULTS));
  });
});
