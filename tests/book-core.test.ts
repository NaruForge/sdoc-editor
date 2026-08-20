import { describe, expect, it } from 'vitest';
import {
  applyBookManifestMutation,
  assertBookEditApplied,
  BOOK_AGGREGATE_MAX_BYTES,
  BOOK_CHAPTER_MAX_BYTES,
  BOOK_LOAD_CONCURRENCY,
  BOOK_MANIFEST_MAX_BYTES,
  BOOK_MAX_DIAGNOSTICS,
  BOOK_MAX_DOCUMENTS,
  BOOK_MAX_PATH_LENGTH,
  BookDocumentLoadError,
  BookMutationError,
  composeBook,
  extractBookRootBody,
  hasBookErrors,
  isBookMutationResult,
  isBookWebviewMessage,
  measureBookUtf8Bytes,
  parseBook,
  prepareBookMutationSnapshot,
  serializeBookManifestForMutation,
  type BookDocumentLoader,
  type BookLoadedDocument,
  type SdocBook,
} from '../shared/book';
import type { TiptapNode } from '../shared/types';
import { buildNumberingIndex } from '../shared/document/numbering';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { convertJsonToAdoc, convertJsonToHtml, convertJsonToMarkdown, convertJsonToSlides } from '../shared/converter';

const text = (value: string, href?: string): TiptapNode => ({
  type: 'text',
  text: value,
  ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
});

function memoryLoader(files: Record<string, unknown>): BookDocumentLoader {
  return {
    async load(path) {
      if (!(path in files)) throw new BookDocumentLoadError('not-found', path);
      const value = files[path];
      return {
        value,
        byteLength: measureBookUtf8Bytes(typeof value === 'string' ? value : JSON.stringify(value)),
      };
    },
  };
}

const loadedDocument = (value: unknown, byteLength?: number): BookLoadedDocument => ({
  value,
  byteLength: byteLength ?? measureBookUtf8Bytes(typeof value === 'string' ? value : JSON.stringify(value)),
});

const emptyDocument = { type: 'doc', content: [] };

async function flushMicrotasksUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await Promise.resolve();
  expect(predicate()).toBe(true);
}

describe('sdocbook parsing', () => {
  it('extracts refresh markup when the book root has accessibility attributes', () => {
    expect(extractBookRootBody(
      '<body><div id="book-root" role="main" aria-busy="false"><div>chapter</div></div><script>bind()</script></body>',
    )).toBe('<div>chapter</div>');
    expect(() => extractBookRootBody('<div id="other"></div><script></script>')).toThrow();
  });

  it('normalizes document paths without changing the persisted format version', () => {
    const result = parseBook(JSON.stringify({
      sdocBook: '1.0',
      title: 'Guide',
      documents: [{ path: 'chapters\\intro.sdoc', label: 'Introduction' }],
    }));

    expect(result.book).toEqual({
      sdocBook: '1.0',
      title: 'Guide',
      documents: [{ path: './chapters/intro.sdoc', label: 'Introduction' }],
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('reports malformed JSON, unsafe paths, duplicates, and empty books', () => {
    expect(parseBook('{').diagnostics[0].code).toBe('BOOK_INVALID');

    const result = parseBook({
      sdocBook: '1.0',
      documents: [
        { path: '../outside.sdoc' },
        { path: './chapter.sdoc' },
        { path: 'chapter.sdoc' },
      ],
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      'DOCUMENT_PATH_OUTSIDE_BOOK',
      'DOCUMENT_DUPLICATE',
    ]);
    expect(parseBook('').diagnostics.map((item) => item.code)).toContain('BOOK_NO_DOCUMENTS');
  });

  it('rejects document paths that collide on a portable Windows checkout', () => {
    const result = parseBook({
      sdocBook: '1.0',
      documents: [{ path: './Guide/Intro.sdoc' }, { path: './guide/intro.sdoc' }],
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'DOCUMENT_DUPLICATE' }));
  });

  it('bounds persisted path and diagnostic projection text', () => {
    const longPath = `${'a'.repeat(BOOK_MAX_PATH_LENGTH)}.sdoc`;
    const result = parseBook({ sdocBook: '1.0', documents: [{ path: longPath }] });

    expect(result.book?.documents).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ code: 'DOCUMENT_PATH_OUTSIDE_BOOK' });
    expect(result.diagnostics.every((item) => item.message.length <= 2_000)).toBe(true);
  });

  it('validates optional metadata instead of silently dropping invalid values', () => {
    const result = parseBook({
      sdocBook: '1.0',
      title: 42,
      documents: [{ path: './chapter.sdoc' }],
    });

    expect(result.book?.title).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'BOOK_INVALID',
      message: 'title must be a string.',
    }));
  });

  it('accepts only typed book webview commands', () => {
    expect(isBookWebviewMessage({ type: 'openDocument', index: 0 })).toBe(true);
    expect(isBookWebviewMessage({
      type: 'updateMeta', key: 'title', value: 'Guide', requestId: 'meta-1', baseRevision: 3,
    })).toBe(true);
    expect(isBookWebviewMessage({ type: 'updateMeta', key: 'title', value: 'Guide' })).toBe(false);
    expect(isBookWebviewMessage({ type: 'addDocument', requestId: 'add-1', baseRevision: 3 })).toBe(true);
    expect(isBookWebviewMessage({ type: 'removeDocument', index: 0, requestId: '', baseRevision: 3 })).toBe(false);
    expect(isBookWebviewMessage({ type: 'openDocument', path: './chapter.sdoc' })).toBe(false);
    expect(isBookWebviewMessage({ type: 'exportProject', format: 'docx' })).toBe(false);
  });

  it('accepts only correlated book mutation results', () => {
    expect(isBookMutationResult({
      type: 'bookMutationResult', requestId: 'move-1', status: 'applied', revision: 4,
    })).toBe(true);
    expect(isBookMutationResult({
      type: 'bookMutationResult', requestId: 'move-1', status: 'rejected', revision: 3,
      error: { code: 'stale-revision', message: 'stale' },
    })).toBe(true);
    expect(isBookMutationResult({
      type: 'bookMutationResult', status: 'applied', revision: 4,
    })).toBe(false);
    expect(isBookMutationResult({
      type: 'bookMutationResult', requestId: 'move-1', status: 'rejected', revision: 3,
    })).toBe(false);
  });

  it('enforces the manifest byte limit at the exact UTF-8 boundary', () => {
    const serialized = JSON.stringify({ sdocBook: '1.0', documents: [{ path: './one.sdoc' }] });
    const atLimit = serialized + ' '.repeat(BOOK_MANIFEST_MAX_BYTES - measureBookUtf8Bytes(serialized));

    expect(measureBookUtf8Bytes(atLimit)).toBe(BOOK_MANIFEST_MAX_BYTES);
    expect(parseBook(atLimit).diagnostics).toEqual([]);
    expect(parseBook(`${atLimit} `).diagnostics).toContainEqual(expect.objectContaining({
      code: 'BOOK_MANIFEST_TOO_LARGE',
    }));
  });

  it('enforces the document-count limit at the exact boundary', () => {
    const documents = Array.from({ length: BOOK_MAX_DOCUMENTS + 1 }, (_, index) => ({
      path: `./chapter-${index}.sdoc`,
    }));

    expect(parseBook({ sdocBook: '1.0', documents: documents.slice(0, BOOK_MAX_DOCUMENTS) }).diagnostics)
      .not.toContainEqual(expect.objectContaining({ code: 'BOOK_DOCUMENT_LIMIT_EXCEEDED' }));
    const oversized = parseBook({ sdocBook: '1.0', documents });
    expect(oversized.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'BOOK_DOCUMENT_LIMIT_EXCEEDED' }));
    expect(oversized.book?.documents).toHaveLength(BOOK_MAX_DOCUMENTS);
  });

  it('caps diagnostic projection for hostile manifests', () => {
    const result = parseBook({
      sdocBook: '1.0',
      documents: Array.from({ length: BOOK_MAX_DOCUMENTS }, (_, index) => ({
        path: `./chapter-${index}.txt`,
        [`unsupported-${index}`]: true,
      })),
    });

    expect(result.diagnostics).toHaveLength(BOOK_MAX_DIAGNOSTICS);
    expect(result.diagnostics.at(-1)).toMatchObject({ code: 'BOOK_DIAGNOSTICS_TRUNCATED' });
  });

  it('validates the chapter counter policy', () => {
    expect(parseBook({ sdocBook: '1.0', counterPolicy: 'reset', documents: [{ path: 'one.sdoc' }] }).book)
      .toMatchObject({ counterPolicy: 'reset' });
    expect(parseBook({ sdocBook: '1.0', counterPolicy: 'sometimes', documents: [{ path: 'one.sdoc' }] })
      .diagnostics.map((item) => item.code)).toContain('BOOK_INVALID');
  });
});

describe('sdocbook mutations', () => {
  const manifestText = JSON.stringify({
    sdocBook: '1.0',
    documents: [{ path: './a.sdoc' }, { path: './b.sdoc' }, { path: './c.sdoc' }],
  });

  it('rejects a stale queue-time snapshot before parsing a mutation', () => {
    expect(() => prepareBookMutationSnapshot(manifestText, 8, 7)).toThrowError(BookMutationError);
    try {
      prepareBookMutationSnapshot(manifestText, 8, 7);
    } catch (error) {
      expect(error).toMatchObject({ code: 'stale-revision' });
    }
  });

  it('treats an applyEdit false result as a correlated mutation failure', () => {
    expect(() => assertBookEditApplied(false)).toThrowError(BookMutationError);
    try {
      assertBookEditApplied(false);
    } catch (error) {
      expect(error).toMatchObject({ code: 'apply-failed' });
    }
    expect(() => assertBookEditApplied(true)).not.toThrow();
  });

  it('refuses to serialize a visual mutation beyond the manifest byte limit', () => {
    const oversized: SdocBook = {
      sdocBook: '1.0',
      title: 'x'.repeat(BOOK_MANIFEST_MAX_BYTES),
      documents: [{ path: './one.sdoc' }],
    };

    expect(() => serializeBookManifestForMutation(oversized)).toThrowError(BookMutationError);
    try {
      serializeBookManifestForMutation(oversized);
    } catch (error) {
      expect(error).toMatchObject({ code: 'limit-exceeded' });
    }
  });

  it('preserves manifest order through add, move, and remove mutations', () => {
    const original = prepareBookMutationSnapshot(manifestText, 7, 7);
    const added = applyBookManifestMutation(original, {
      type: 'addDocuments', paths: ['./d.sdoc', './e.sdoc', './D.sdoc'],
    });
    const moved = applyBookManifestMutation(added, { type: 'moveDocument', from: 4, to: 1 });
    const removed = applyBookManifestMutation(moved, { type: 'removeDocument', index: 2 });

    expect(original.documents.map((entry) => entry.path)).toEqual(['./a.sdoc', './b.sdoc', './c.sdoc']);
    expect(added.documents.map((entry) => entry.path)).toEqual([
      './a.sdoc', './b.sdoc', './c.sdoc', './d.sdoc', './e.sdoc',
    ]);
    expect(removed.documents.map((entry) => entry.path)).toEqual([
      './a.sdoc', './e.sdoc', './c.sdoc', './d.sdoc',
    ]);
  });
});

describe('sdocbook composition', () => {
  it('blocks endnotes until a book placement policy is defined', async () => {
    const result = await composeBook({
      sdocBook: '1.0',
      documents: [{ path: './chapter.sdoc' }],
    }, memoryLoader({
      './chapter.sdoc': {
        sdoc: '1.0',
        meta: {},
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Body' },
          { type: 'endnote', attrs: { id: 'endnote-1', body: 'Note' } },
        ] }] },
      },
    }));

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'ENDNOTES_UNSUPPORTED',
      documentPath: './chapter.sdoc',
    }));
  });

  const book: SdocBook = {
    sdocBook: '1.0',
    title: 'System Guide',
    author: 'Team',
    documents: [
      { path: './chapters/intro.sdoc' },
      { path: './chapters/reference.sdoc', label: 'Reference' },
    ],
  };

  it('does not schedule chapter I/O when the manifest exceeds the document-count limit', async () => {
    let loadCount = 0;
    const result = await composeBook({
      sdocBook: '1.0',
      documents: Array.from({ length: BOOK_MAX_DOCUMENTS + 1 }, (_, index) => ({
        path: `./${index}.sdoc`,
      })),
    }, {
      async load() {
        loadCount += 1;
        return loadedDocument(emptyDocument);
      },
    });

    expect(loadCount).toBe(0);
    expect(result.documents).toHaveLength(BOOK_MAX_DOCUMENTS + 1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'BOOK_DOCUMENT_LIMIT_EXCEEDED',
    }));
  });

  it('preserves order, rebases assets, and resolves sibling document links', async () => {
    const result = await composeBook(book, memoryLoader({
      './chapters/intro.sdoc': {
        sdoc: '1.0',
        meta: { title: 'Intro' },
        doc: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { id: 'intro', level: 1 }, content: [text('Introduction')] },
            { type: 'image', attrs: { id: 'overview-image', src: './images/overview.png' } },
            { type: 'paragraph', content: [text('Details', './reference.sdoc#api')] },
          ],
        },
      },
      './chapters/reference.sdoc': {
        sdoc: '1.0',
        meta: { title: 'Reference' },
        doc: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { id: 'api', level: 1 }, content: [text('API')] },
          ],
        },
      },
    }));

    expect(result.meta).toEqual({ title: 'System Guide', author: 'Team' });
    expect(result.documents.map((document) => document.label)).toEqual(['intro', 'Reference']);
    expect(result.doc.content?.map((node) => node.type)).toEqual([
      'horizontalRule', 'heading', 'image', 'paragraph', 'horizontalRule', 'heading',
    ]);
    expect(result.doc.content?.[2].attrs?.src).toBe('chapters/images/overview.png');
    expect(result.doc.content?.[3].content?.[0].marks?.[0].attrs?.href).toBe('#api');
    expect(result.diagnostics).toEqual([]);
    expect(() => assertPersistedDocument({ sdoc: '1.0', meta: result.meta, doc: result.doc })).not.toThrow();
  });

  it('maps fragmentless document links to deterministic chapter anchors', async () => {
    const result = await composeBook({
      sdocBook: '1.0',
      documents: [{ path: './one.sdoc' }, { path: './nested/two.sdoc' }],
    }, memoryLoader({
      './one.sdoc': { type: 'doc', content: [{ type: 'paragraph', content: [text('Next', './nested/two.sdoc')] }] },
      './nested/two.sdoc': { type: 'doc', content: [{ type: 'paragraph', content: [text('Two')] }] },
    }));
    const secondAnchor = result.doc.content?.[2].attrs?.id;
    expect(secondAnchor).toBe('chapter-nested-two');
    expect(result.doc.content?.[1].content?.[0].marks?.[0].attrs?.href).toBe(`#${secondAnchor}`);
    expect(convertJsonToHtml(result.doc)).toContain(`id="${secondAnchor}"`);
    expect(convertJsonToMarkdown(result.doc)).toContain(`<a id="${secondAnchor}"></a>`);
    expect(convertJsonToAdoc(result.doc)).toContain(`[[${secondAnchor}]]`);
    expect(convertJsonToSlides(result.doc)).toContain(`id="${secondAnchor}"`);
    expect(convertJsonToHtml(result.doc)).not.toContain(`<hr id="${secondAnchor}"`);
    expect(convertJsonToMarkdown(result.doc)).not.toContain(`<a id="${secondAnchor}"></a>\n---`);
    expect(convertJsonToAdoc(result.doc)).not.toContain(`[[${secondAnchor}]]\n'''`);
  });

  it('loads chapters in parallel while preserving manifest and diagnostic order', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const composing = composeBook({
      sdocBook: '1.0', documents: [{ path: './slow.sdoc' }, { path: './broken.sdoc' }],
    }, {
      async load(chapterPath) {
        started.push(chapterPath);
        if (chapterPath === './slow.sdoc') await gate;
        throw new BookDocumentLoadError('read-failed', chapterPath);
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['./slow.sdoc', './broken.sdoc']);
    release();
    const result = await composing;
    expect(result.diagnostics.map((item) => item.documentPath)).toEqual(['./slow.sdoc', './broken.sdoc']);
  });

  it('bounds chapter loading at four while filling the next manifest slot deterministically', async () => {
    const entries = Array.from({ length: BOOK_LOAD_CONCURRENCY + 2 }, (_, index) => `./${index}.sdoc`);
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    let active = 0;
    let maximumActive = 0;
    const composing = composeBook({
      sdocBook: '1.0', documents: entries.map((chapterPath) => ({ path: chapterPath })),
    }, {
      async load(chapterPath, signal) {
        started.push(chapterPath);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve, reject) => {
          releases.set(chapterPath, resolve);
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        active -= 1;
        return loadedDocument(emptyDocument);
      },
    });

    await Promise.resolve();
    expect(started).toEqual(entries.slice(0, BOOK_LOAD_CONCURRENCY));
    releases.get(entries[0])?.();
    await flushMicrotasksUntil(() => started.length === BOOK_LOAD_CONCURRENCY + 1);
    expect(started).toEqual(entries.slice(0, BOOK_LOAD_CONCURRENCY + 1));
    releases.get(entries[1])?.();
    await flushMicrotasksUntil(() => started.length === entries.length);
    expect(started).toEqual(entries);
    for (const chapterPath of entries.slice(2)) releases.get(chapterPath)?.();
    await composing;
    expect(maximumActive).toBe(BOOK_LOAD_CONCURRENCY);
  });

  it('aborts superseded composition without publishing chapter diagnostics', async () => {
    const controller = new AbortController();
    const composing = composeBook({
      sdocBook: '1.0', documents: [{ path: './slow.sdoc' }],
    }, {
      async load(_chapterPath, signal) {
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    }, [], controller.signal);
    controller.abort(new Error('superseded'));
    await expect(composing).rejects.toThrow('superseded');
  });

  it('does not schedule new chapters after cancellation', async () => {
    const controller = new AbortController();
    const entries = Array.from({ length: BOOK_LOAD_CONCURRENCY + 2 }, (_, index) => `./${index}.sdoc`);
    const started: string[] = [];
    const composing = composeBook({
      sdocBook: '1.0', documents: entries.map((chapterPath) => ({ path: chapterPath })),
    }, {
      async load(chapterPath, signal) {
        started.push(chapterPath);
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return loadedDocument(emptyDocument);
      },
    }, [], controller.signal);

    await Promise.resolve();
    expect(started).toEqual(entries.slice(0, BOOK_LOAD_CONCURRENCY));
    controller.abort(new Error('cancelled'));
    await expect(composing).rejects.toThrow('cancelled');
    expect(started).toEqual(entries.slice(0, BOOK_LOAD_CONCURRENCY));
  });

  it('enforces chapter and aggregate byte limits at boundary plus one', async () => {
    const atChapterLimit = await composeBook({
      sdocBook: '1.0', documents: [{ path: './exact.sdoc' }],
    }, { async load() { return loadedDocument(emptyDocument, BOOK_CHAPTER_MAX_BYTES); } });
    const overChapterLimit = await composeBook({
      sdocBook: '1.0', documents: [{ path: './large.sdoc' }],
    }, { async load() { return loadedDocument(emptyDocument, BOOK_CHAPTER_MAX_BYTES + 1); } });

    expect(atChapterLimit.documents[0].status).toBe('ok');
    expect(overChapterLimit.diagnostics).toContainEqual(expect.objectContaining({
      code: 'DOCUMENT_TOO_LARGE', documentPath: './large.sdoc',
    }));

    const aggregateEntries = Array.from({ length: 8 }, (_, index) => ({ path: `./${index}.sdoc` }));
    const exactAggregate = await composeBook({ sdocBook: '1.0', documents: aggregateEntries }, {
      async load() { return loadedDocument(emptyDocument, BOOK_CHAPTER_MAX_BYTES); },
    });
    const overAggregate = await composeBook({
      sdocBook: '1.0', documents: [...aggregateEntries, { path: './overflow.sdoc' }],
    }, {
      async load(chapterPath) {
        return loadedDocument(
          emptyDocument,
          chapterPath === './overflow.sdoc' ? 1 : BOOK_CHAPTER_MAX_BYTES,
        );
      },
    });

    expect(BOOK_CHAPTER_MAX_BYTES * 8).toBe(BOOK_AGGREGATE_MAX_BYTES);
    expect(exactAggregate.diagnostics).toEqual([]);
    expect(overAggregate.diagnostics).toContainEqual(expect.objectContaining({
      code: 'BOOK_AGGREGATE_TOO_LARGE', documentPath: './overflow.sdoc',
    }));
    expect(overAggregate.documents.map((document) => document.path)).toEqual([
      ...aggregateEntries.map((entry) => entry.path), './overflow.sdoc',
    ]);
  });

  it('returns diagnostics instead of silently exporting incomplete content', async () => {
    const result = await composeBook({
      sdocBook: '1.0',
      documents: [
        { path: './one.sdoc' },
        { path: './two.sdoc' },
        { path: './missing.sdoc' },
      ],
    }, memoryLoader({
      './one.sdoc': {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { id: 'shared', level: 1 }, content: [text('One')] },
          { type: 'paragraph', content: [text('Broken', './two.sdoc#unknown')] },
        ],
      },
      './two.sdoc': {
        type: 'doc',
        content: [{ type: 'heading', attrs: { id: 'shared', level: 1 }, content: [text('Two')] }],
      },
    }));

    expect(result.documents.map((document) => document.status)).toEqual(['ok', 'ok', 'missing']);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'DOCUMENT_MISSING',
      'ID_DUPLICATE',
      'REFERENCE_BROKEN',
    ]));
    expect(hasBookErrors(result.diagnostics)).toBe(true);
  });

  it('distinguishes invalid document content from a missing file', async () => {
    const result = await composeBook({
      sdocBook: '1.0',
      documents: [{ path: './invalid.sdoc' }],
    }, memoryLoader({ './invalid.sdoc': '{not json' }));

    expect(result.documents[0].status).toBe('invalid');
    expect(result.diagnostics[0].code).toBe('DOCUMENT_INVALID');
  });

  it('blocks unsafe chapter assets instead of preserving traversal paths', async () => {
    const result = await composeBook({
      sdocBook: '1.0',
      documents: [{ path: './chapters/unsafe.sdoc' }],
    }, memoryLoader({
      './chapters/unsafe.sdoc': {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: '../../../secret.txt' } }],
      },
    }));

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'ASSET_PATH_OUTSIDE_BOOK',
    }));
    expect(result.doc.content?.[1].attrs?.src).toBeUndefined();
  });

  it('validates complete chapter contracts before composition', async () => {
    const result = await composeBook({
      sdocBook: '1.0',
      documents: [{ path: './invalid.sdoc' }],
    }, memoryLoader({
      './invalid.sdoc': {
        sdoc: '1.0',
        meta: { title: 42 },
        doc: { type: 'doc', content: [] },
      },
    }));

    expect(result.documents[0].status).toBe('invalid');
    expect(result.diagnostics[0].code).toBe('DOCUMENT_INVALID');
  });

  it('provides deterministic reset boundaries for chapter numbering', async () => {
    const result = await composeBook({
      sdocBook: '1.0', counterPolicy: 'reset',
      documents: [{ path: './one.sdoc' }, { path: './two.sdoc' }],
    }, memoryLoader({
      './one.sdoc': { type: 'doc', content: [{ type: 'image', attrs: { id: 'one', src: './images/one.png' } }] },
      './two.sdoc': { type: 'doc', content: [{ type: 'image', attrs: { id: 'two', src: './images/two.png' } }] },
    }));
    const numbering = buildNumberingIndex(result.doc, {
      headingNumbering: true, captionNumbering: 'sequential', equationNumbering: 'sequential',
      captionStyle: 'modern', crossRefIncludeCaption: false,
      counterResetPaths: result.counterResetPaths,
    });
    expect(result.counterResetPaths).toEqual(['0', '2']);
    expect(numbering.byId.get('one')?.number).toBe('1');
    expect(numbering.byId.get('two')?.number).toBe('1');
  });
});
