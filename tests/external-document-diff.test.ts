import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TiptapNode } from '../shared/types';
import { parseDocumentTextContract } from '../shared/document/documentContract';
import type { DocumentMutation } from '../shared/persistence/DocumentSyncCoordinator';
import {
  areDocumentMutationsSemanticallyEqual,
  ExternalChangeBanner,
  ExternalChangeComparison,
  ExternalChangePrompt,
  buildExternalChangeComparison,
  buildExternalDocumentDiff,
  buildExternalMutationDiff,
  externalChangePromptTabTarget,
  initialExternalChangePromptState,
  reduceExternalChangePromptState,
} from '../shared/editor/externalChanges';

const text = (value: string): TiptapNode => ({ type: 'text', text: value });
const paragraph = (value: string): TiptapNode => ({
  type: 'paragraph',
  content: [text(value)],
});
const heading = (id: string, value: string): TiptapNode => ({
  type: 'heading',
  attrs: { id, level: 1 },
  content: [text(value)],
});
const doc = (...content: TiptapNode[]): TiptapNode => ({ type: 'doc', content });
const snapshot = (
  content: TiptapNode,
  meta: DocumentMutation['meta'] = {},
  documentSettings: DocumentMutation['documentSettings'] = null,
): DocumentMutation => ({ content, meta, documentSettings });

describe('external document block diff', () => {
  it('uses persistent ids to report a changed and moved heading once', () => {
    const mine = doc(heading('intro', 'Introduction'), paragraph('Body'));
    const external = doc(paragraph('Body'), heading('intro', 'Overview'));

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 0, removed: 0, changed: 1, moved: 2 });
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.find((block) => block.key === 'id:intro')).toMatchObject({
      kinds: ['changed', 'moved'],
      mine: { identityStrategy: 'persistent-id', index: 0, path: [0], preview: 'Introduction' },
      external: { identityStrategy: 'persistent-id', index: 1, path: [1], preview: 'Overview' },
    });
  });

  it('does not fallback-match blocks with different persistent ids', () => {
    const mine = doc(heading('old-heading', 'Same title'));
    const external = doc(heading('new-heading', 'Same title'));

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 1, removed: 1, changed: 0, moved: 0 });
    expect(result.blocks.map((block) => block.kinds)).toEqual([['removed'], ['added']]);
  });

  it('aligns id-less blocks by exact content before type order', () => {
    const mine = doc(paragraph('Alpha'), paragraph('Beta'));
    const external = doc(paragraph('Inserted'), paragraph('Alpha'), paragraph('Beta'));

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 1, removed: 0, changed: 0, moved: 0 });
    expect(result.blocks.filter((block) => block.kinds.includes('changed'))).toHaveLength(0);
    expect(result.blocks.find((block) => block.kinds.includes('added'))?.external).toMatchObject({
      type: 'paragraph',
      preview: 'Inserted',
      identityStrategy: 'fallback',
    });
  });

  it('classifies removed, added, and changed non-text top-level blocks', () => {
    const mine = doc(
      { type: 'image', attrs: { id: 'hero', src: './old.png', caption: 'Old hero' } },
      { type: 'mathBlock', attrs: { id: 'equation', latex: 'x=1' } },
    );
    const external = doc(
      { type: 'image', attrs: { id: 'hero', src: './new.png', caption: 'New hero' } },
      { type: 'table', attrs: { id: 'data', caption: 'Results' } },
    );

    const result = buildExternalDocumentDiff(mine, external);

    expect(result.summary).toEqual({ added: 1, removed: 1, changed: 1, moved: 0 });
    expect(result.blocks.map((block) => block.kinds)).toEqual([['changed'], ['removed'], ['added']]);
    expect(result.blocks[0].external?.preview).toBe('caption: New hero · src: ./new.png');
  });

  it('is deterministic for object attributes regardless of key insertion order', () => {
    const mine = doc({
      type: 'diagram',
      attrs: { id: 'system', language: 'mermaid', code: 'graph TD' },
    });
    const external = doc({
      type: 'diagram',
      attrs: { code: 'graph TD', id: 'system', language: 'mermaid' },
    });

    expect(buildExternalDocumentDiff(mine, external)).toMatchObject({
      hasChanges: false,
      blocks: [],
      summary: { added: 0, removed: 0, changed: 0, moved: 0 },
    });
  });
});

describe('external mutation diff', () => {
  it('reports metadata-only and raw document-setting changes even when body content is equal', () => {
    const body = doc(paragraph('Same body'));
    const result = buildExternalMutationDiff(
      snapshot(body, { title: 'Mine', extension: { z: 1, a: 2 } }, { pdfScale: 70 }),
      snapshot(body, { title: 'External', extension: { a: 2, z: 1 } }, { pdfScale: 80 }),
    );

    expect(result.hasChanges).toBe(true);
    expect(result.metadata).toMatchObject([
      { path: '/meta/title', mine: { preview: 'Mine' }, external: { preview: 'External' } },
    ]);
    expect(result.settings).toMatchObject([
      { path: '/meta/settings/pdfScale', mine: { preview: '70' }, external: { preview: '80' } },
    ]);
    expect(result.content.hasChanges).toBe(false);
  });

  it('sorts extension metadata deterministically and bounds large previews', () => {
    const body = doc();
    const result = buildExternalMutationDiff(
      snapshot(body, { zeta: 'mine', alpha: 'x'.repeat(10_000) }),
      snapshot(body, { zeta: 'external', alpha: 'short' }),
    );

    expect(result.metadata.map((field) => field.key)).toEqual(['alpha', 'zeta']);
    expect(result.metadata[0].mine?.truncated).toBe(true);
    expect(result.metadata[0].mine?.preview.length).toBeLessThanOrEqual(4097);
  });

  it('has no semantic changes when persisted JSON differs only by a final newline', () => {
    const persisted = JSON.stringify(persistedEnvelope, null, 2);
    expect(persisted.endsWith('\n')).toBe(false);

    const result = buildExternalMutationDiff(
      mutationFromPersistedText(persisted),
      mutationFromPersistedText(`${persisted}\n`),
    );

    expect(result.hasChanges).toBe(false);
    expect(result.metadata).toEqual([]);
    expect(result.settings).toEqual([]);
    expect(result.content.hasChanges).toBe(false);
    expect(areDocumentMutationsSemanticallyEqual(
      mutationFromPersistedText(persisted),
      mutationFromPersistedText(`${persisted}\n`),
    )).toBe(true);
  });

  it('has no semantic changes when persisted JSON differs only by CRLF versus LF', () => {
    const persisted = JSON.stringify(persistedEnvelope, null, 2);
    const appliedCrlf = persisted.replace(/\n/g, '\r\n');

    const result = buildExternalMutationDiff(
      mutationFromPersistedText(appliedCrlf),
      mutationFromPersistedText(persisted),
    );

    expect(result.hasChanges).toBe(false);
    expect(result.metadata).toEqual([]);
    expect(result.settings).toEqual([]);
    expect(result.content.hasChanges).toBe(false);
    expect(areDocumentMutationsSemanticallyEqual(
      mutationFromPersistedText(appliedCrlf),
      mutationFromPersistedText(persisted),
    )).toBe(true);
  });
});

describe('external change comparison UI', () => {
  it('builds a frozen read-only side-by-side model', () => {
    const diff = buildExternalDocumentDiff(doc(heading('intro', 'Mine')), doc(heading('intro', 'On disk')));
    const model = buildExternalChangeComparison(diff, {
      title: 'Review external edit',
      mine: 'Current editor',
      external: 'Disk version',
    });

    expect(model).toMatchObject({
      title: 'Review external edit',
      rows: [
        {
          kinds: ['changed'],
          mine: { label: 'Current editor', block: { preview: 'Mine' } },
          external: { label: 'Disk version', block: { preview: 'On disk' } },
        },
      ],
    });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.rows)).toBe(true);
    expect(Object.isFrozen(model.rows[0])).toBe(true);
  });

  it('shows all actions when dirty and hides Keep mine when clean', () => {
    const callbacks = {
      onCompare: vi.fn(),
      onKeepMine: vi.fn(),
      onReload: vi.fn(),
    };
    const dirtyMarkup = renderToStaticMarkup(
      React.createElement(ExternalChangeBanner, {
        isDirty: true,
        ...callbacks,
      }),
    );
    const cleanMarkup = renderToStaticMarkup(
      React.createElement(ExternalChangeBanner, {
        isDirty: false,
        ...callbacks,
      }),
    );

    expect(dirtyMarkup).toContain('Compare');
    expect(dirtyMarkup).toContain('Keep mine');
    expect(dirtyMarkup).toContain('Reload');
    expect(cleanMarkup).not.toContain('Keep mine');
  });

  it('renders the comparison as a non-modal region with a close action', () => {
    const model = buildExternalChangeComparison(
      buildExternalDocumentDiff(doc(paragraph('Mine')), doc(paragraph('External'))),
    );
    const markup = renderToStaticMarkup(
      React.createElement(ExternalChangeComparison, {
        model,
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('<section');
    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('Mine');
    expect(markup).toContain('External');
    expect(markup).toContain('Changed');
    expect(markup).toContain('Close comparison');
  });
});

describe('external change resolution prompt', () => {
  it('uses a discriminated state machine and blocks cancellation or duplicate actions while running', () => {
    const confirming = reduceExternalChangePromptState(initialExternalChangePromptState, {
      type: 'confirm',
      resolution: 'keep-mine',
    });
    expect(confirming).toEqual({ kind: 'confirming', resolution: 'keep-mine' });

    const running = reduceExternalChangePromptState(confirming, { type: 'run' });
    expect(running).toEqual({ kind: 'running', resolution: 'keep-mine' });
    expect(reduceExternalChangePromptState(running, { type: 'cancel' })).toBe(running);
    expect(
      reduceExternalChangePromptState(running, {
        type: 'confirm',
        resolution: 'reload',
      }),
    ).toBe(running);

    const failed = reduceExternalChangePromptState(running, { type: 'fail' });
    expect(failed).toEqual({ kind: 'failed', resolution: 'keep-mine' });
    expect(reduceExternalChangePromptState(failed, { type: 'run' })).toEqual({
      kind: 'running',
      resolution: 'keep-mine',
    });
    expect(reduceExternalChangePromptState(failed, { type: 'cancel' })).toBe(initialExternalChangePromptState);
  });

  it('wraps Tab and Shift+Tab and traps focus even when running disables every control', () => {
    expect(externalChangePromptTabTarget(1, 2, false)).toBe(0);
    expect(externalChangePromptTabTarget(0, 2, true)).toBe(1);
    expect(externalChangePromptTabTarget(-1, 2, false)).toBe(0);
    expect(externalChangePromptTabTarget(-1, 0, false)).toBe(-1);
  });

  it('renders localized banner actions without exposing a dialog before confirmation', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ExternalChangePrompt, {
        isDirty: true,
        onCompare: vi.fn(),
        onKeepMine: vi.fn(async () => undefined),
        onReload: vi.fn(async () => undefined),
        labels: {
          message: 'Changed elsewhere',
          compare: 'Inspect',
          keepMine: 'Preserve local',
          reload: 'Use disk',
        },
      }),
    );

    expect(markup).toContain('Changed elsewhere');
    expect(markup).toContain('Inspect');
    expect(markup).toContain('Preserve local');
    expect(markup).toContain('Use disk');
    expect(markup).not.toContain('role="alertdialog"');
  });

  it('exposes banner busy, disabled, status, and generic error semantics', () => {
    const callbacks = {
      onCompare: vi.fn(),
      onKeepMine: vi.fn(),
      onReload: vi.fn(),
    };
    const busyMarkup = renderToStaticMarkup(
      React.createElement(ExternalChangeBanner, {
        isDirty: true,
        ...callbacks,
        busy: true,
        disabled: true,
        status: 'Reloading safely',
      }),
    );
    const failedMarkup = renderToStaticMarkup(
      React.createElement(ExternalChangeBanner, {
        isDirty: true,
        ...callbacks,
        error: 'Resolution failed',
      }),
    );

    expect(busyMarkup).toContain('aria-busy="true"');
    expect(busyMarkup.match(/disabled=""/g)).toHaveLength(3);
    expect(busyMarkup).toContain('role="status"');
    expect(busyMarkup).toContain('Reloading safely');
    expect(failedMarkup).toContain('role="alert"');
    expect(failedMarkup).toContain('Resolution failed');
  });
});

const persistedEnvelope = {
  sdoc: '1.0',
  meta: {
    title: 'Newline probe',
    author: '',
    version: '0.1',
    created: '2026-08-14T00:00:00.000Z',
    modified: '2026-08-14T00:00:00.000Z',
    settings: { pdfScale: 80 },
  },
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  },
};

const mutationFromPersistedText = (text: string): DocumentMutation => {
  const contract = parseDocumentTextContract(text);
  if (!contract.ok) {
    throw new Error(`expected valid persisted document: ${contract.kind}`);
  }
  const { settings: documentSettings, ...persistedMeta } = contract.envelope.meta;
  return {
    content: contract.envelope.doc,
    meta: persistedMeta,
    documentSettings: documentSettings ?? null,
  };
};
