import { describe, expect, it } from 'vitest';
import type { ResolvedDocumentSettingsSnapshot, TiptapNode } from '../shared/types';
import {
  RevisionBoundCanonicalPersistenceCache,
  type CanonicalPersistenceAuthority,
} from '../src/utils/canonicalPersistenceSnapshot';

const documentIdentity = {};
const authority: CanonicalPersistenceAuthority = {
  sessionId: 'session-1',
  documentId: 'file:///workspace/report.sdoc',
  documentIdentity,
};
const content = (text: string): TiptapNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const resolvedSettings = Object.freeze({
  version: '1',
  context: 'standalone',
  values: Object.freeze({}),
  entries: Object.freeze({}),
  diagnostics: Object.freeze([]),
  fingerprint: 'settings-1',
}) as unknown as ResolvedDocumentSettingsSnapshot;

describe('revision-bound canonical persistence snapshots', () => {
  it('reuses only components owned by the exact host revision and live document identity', () => {
    const cache = new RevisionBoundCanonicalPersistenceCache();
    cache.adopt(authority, {
      revision: 7,
      componentRevisions: { content: 2, metadata: 1, settings: 0 },
      metadata: { title: 'Baseline', modified: '2026-01-01T00:00:00.000Z' },
      documentSettings: null,
      resolvedSettings,
      normalizedContent: content('baseline'),
    });

    const contentEdit = cache.resolve(authority, 7, {
      content: 3, metadata: 1, settings: 0,
    });
    expect(contentEdit).toMatchObject({
      changed: { content: true, metadata: false, settings: false },
      reuse: { metadata: true, settings: true, resolvedSettings: true, normalizedContent: false },
    });
    expect(contentEdit?.snapshot.metadata.title).toBe('Baseline');

    expect(cache.resolve({ ...authority, sessionId: 'session-2' }, 7, {
      content: 3, metadata: 1, settings: 0,
    })).toBeUndefined();
    expect(cache.resolve({ ...authority, documentIdentity: {} }, 7, {
      content: 3, metadata: 1, settings: 0,
    })).toBeUndefined();
    expect(cache.resolve(authority, 8, {
      content: 3, metadata: 1, settings: 0,
    })).toBeUndefined();
  });

  it('reuses a validated normalized document only for metadata-only mutations', () => {
    const cache = new RevisionBoundCanonicalPersistenceCache();
    const normalizedContent = content('canonical');
    cache.adopt(authority, {
      revision: 11,
      componentRevisions: { content: 4, metadata: 2, settings: 1 },
      metadata: { title: 'Before', modified: '2026-01-01T00:00:00.000Z' },
      documentSettings: { headingNumbering: true },
      resolvedSettings,
      normalizedContent,
    });

    const metadataEdit = cache.resolve(authority, 11, {
      content: 4, metadata: 3, settings: 1,
    });
    expect(metadataEdit).toMatchObject({
      changed: { content: false, metadata: true, settings: false },
      reuse: { metadata: false, settings: true, resolvedSettings: true, normalizedContent: true },
    });
    expect(metadataEdit?.snapshot.normalizedContent).toBe(normalizedContent);

    const settingsEdit = cache.resolve(authority, 11, {
      content: 4, metadata: 2, settings: 2,
    });
    expect(settingsEdit).toMatchObject({
      changed: { content: false, metadata: false, settings: true },
      reuse: { metadata: true, settings: false, resolvedSettings: false, normalizedContent: false },
    });
  });

  it('does not treat an unprepared source document as canonical normalized content', () => {
    const cache = new RevisionBoundCanonicalPersistenceCache();
    cache.adopt(authority, {
      revision: 1,
      componentRevisions: { content: 0, metadata: 0, settings: 0 },
      metadata: { title: 'Opened source' },
      documentSettings: null,
    });

    expect(cache.resolve(authority, 1, {
      content: 0, metadata: 1, settings: 0,
    })).toMatchObject({
      reuse: { metadata: false, settings: true, resolvedSettings: false, normalizedContent: false },
    });
  });

  it('fails closed for stale, decreasing, unchanged, invalidated, and close/reopen authority', () => {
    const cache = new RevisionBoundCanonicalPersistenceCache();
    cache.adopt(authority, {
      revision: 5,
      componentRevisions: { content: 2, metadata: 2, settings: 2 },
      metadata: { title: 'Safe' },
      documentSettings: null,
      resolvedSettings,
      normalizedContent: content('safe'),
    });

    expect(cache.resolve(authority, 5, {
      content: 1, metadata: 2, settings: 2,
    })).toBeUndefined();
    expect(cache.resolve(authority, 5, {
      content: 2, metadata: 2, settings: 2,
    })).toBeUndefined();
    cache.invalidate();
    expect(cache.resolve(authority, 5, {
      content: 3, metadata: 2, settings: 2,
    })).toBeUndefined();

    cache.adopt({ ...authority, documentIdentity: {} }, {
      revision: 5,
      componentRevisions: { content: 2, metadata: 2, settings: 2 },
      metadata: { title: 'Reopened' },
      documentSettings: null,
    });
    expect(cache.resolve(authority, 5, {
      content: 3, metadata: 2, settings: 2,
    })).toBeUndefined();
  });

  it('never exposes a forged unchanged component from an incoming mutation', () => {
    const cache = new RevisionBoundCanonicalPersistenceCache();
    const safeContent = content('safe');
    cache.adopt(authority, {
      revision: 3,
      componentRevisions: { content: 1, metadata: 1, settings: 0 },
      metadata: { title: 'Safe' },
      documentSettings: null,
      resolvedSettings,
      normalizedContent: safeContent,
    });

    const forgedIncomingContent = { type: 'doc', content: [{ type: 'script' }] };
    const metadataOnlyHint = cache.resolve(authority, 3, {
      content: 1, metadata: 2, settings: 0,
    });
    expect(forgedIncomingContent).not.toEqual(safeContent);
    expect(metadataOnlyHint?.snapshot.normalizedContent).toBe(safeContent);
    expect(metadataOnlyHint?.reuse.normalizedContent).toBe(true);
  });
});
