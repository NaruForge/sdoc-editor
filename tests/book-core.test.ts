import { describe, expect, it } from 'vitest';
import {
  BookDocumentLoadError,
  composeBook,
  hasBookErrors,
  isBookWebviewMessage,
  parseBook,
  type BookDocumentLoader,
  type SdocBook,
} from '../shared/book';
import type { TiptapNode } from '../shared/types';
import { buildNumberingIndex } from '../shared/document/numbering';

const text = (value: string, href?: string): TiptapNode => ({
  type: 'text',
  text: value,
  ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
});

function memoryLoader(files: Record<string, unknown>): BookDocumentLoader {
  return {
    async load(path) {
      if (!(path in files)) throw new BookDocumentLoadError('not-found', path);
      return files[path];
    },
  };
}

describe('sdocbook parsing', () => {
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
    expect(isBookWebviewMessage({ type: 'updateMeta', key: 'title', value: 'Guide' })).toBe(true);
    expect(isBookWebviewMessage({ type: 'openDocument', path: './chapter.sdoc' })).toBe(false);
    expect(isBookWebviewMessage({ type: 'exportProject', format: 'docx' })).toBe(false);
  });

  it('validates the chapter counter policy', () => {
    expect(parseBook({ sdocBook: '1.0', counterPolicy: 'reset', documents: [{ path: 'one.sdoc' }] }).book)
      .toMatchObject({ counterPolicy: 'reset' });
    expect(parseBook({ sdocBook: '1.0', counterPolicy: 'sometimes', documents: [{ path: 'one.sdoc' }] })
      .diagnostics.map((item) => item.code)).toContain('BOOK_INVALID');
  });
});

describe('sdocbook composition', () => {
  const book: SdocBook = {
    sdocBook: '1.0',
    title: 'System Guide',
    author: 'Team',
    documents: [
      { path: './chapters/intro.sdoc' },
      { path: './chapters/reference.sdoc', label: 'Reference' },
    ],
  };

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
    expect(result.doc.content?.map((node) => node.type)).toEqual(['heading', 'image', 'paragraph', 'heading']);
    expect(result.doc.content?.[1].attrs?.src).toBe('chapters/images/overview.png');
    expect(result.doc.content?.[2].content?.[0].marks?.[0].attrs?.href).toBe('#api');
    expect(result.diagnostics).toEqual([]);
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
    expect(result.doc.content?.[0].attrs?.src).toBeUndefined();
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
    expect(result.counterResetPaths).toEqual(['0', '1']);
    expect(numbering.byId.get('one')?.number).toBe('1');
    expect(numbering.byId.get('two')?.number).toBe('1');
  });
});
