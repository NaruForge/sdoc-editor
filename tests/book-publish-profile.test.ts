import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDefaultSdocBookPublishProfile,
  parseBook,
  upgradeBookToV1_1,
  type SdocBookV1_0,
} from '../shared/book';

describe('sdocbook 1.1 publish profile', () => {
  it('keeps 1.0 readable without silently adding a publish profile', () => {
    const result = parseBook({
      sdocBook: '1.0',
      title: 'Legacy Book',
      documents: [{ path: './chapter.sdoc' }],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.book).toEqual({
      sdocBook: '1.0',
      title: 'Legacy Book',
      documents: [{ path: './chapter.sdoc' }],
    });
    expect(result.book).not.toHaveProperty('publish');
  });

  it('round-trips a complete inline 1.1 publish profile', () => {
    const publish = createDefaultSdocBookPublishProfile();
    publish.settings.captionStyle = 'korean';
    publish.theme.cssPath = './styles/book.css';
    publish.html.selfContained = 'full';
    publish.pdf.scale = 90;
    publish.diagrams.failurePolicy = 'fail';
    publish.outputDir = './dist';

    const result = parseBook({
      sdocBook: '1.1',
      title: 'Portable Book',
      publish,
      documents: [{ path: './chapter.sdoc' }],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.book).toEqual({
      sdocBook: '1.1',
      title: 'Portable Book',
      publish,
      documents: [{ path: './chapter.sdoc' }],
    });
  });

  it('requires an inline publish profile for 1.1 and validates its complete settings snapshot', () => {
    const missing = parseBook({
      sdocBook: '1.1',
      documents: [{ path: './chapter.sdoc' }],
    });
    expect(missing.book).toBeUndefined();
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({
      code: 'BOOK_PUBLISH_PROFILE_REQUIRED',
    }));

    const incomplete = createDefaultSdocBookPublishProfile() as unknown as {
      settings: Record<string, unknown>;
    };
    delete incomplete.settings.headingNumbering;
    const invalid = parseBook({
      sdocBook: '1.1',
      publish: incomplete,
      documents: [{ path: './chapter.sdoc' }],
    });
    expect(invalid.book).toBeUndefined();
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PUBLISH_PROFILE_INVALID',
    }));
  });

  it('blocks unknown publish-profile properties instead of silently dropping them', () => {
    const publish = {
      ...createDefaultSdocBookPublishProfile(),
      externalProfile: './publish.json',
    };
    const result = parseBook({
      sdocBook: '1.1', publish, documents: [{ path: './chapter.sdoc' }],
    });

    expect(result.book).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'PUBLISH_PROFILE_INVALID',
    }));
  });

  it.each(['1.0', '1.1'] as const)(
    'blocks schema-unknown manifest and document properties in %s',
    (version) => {
      const base = {
        sdocBook: version,
        ...(version === '1.1' ? { publish: createDefaultSdocBookPublishProfile() } : {}),
      };
      const remote = parseBook({
        ...base,
        remoteTarget: 'https://example.invalid/release',
        documents: [{ path: './chapter.sdoc' }],
      });
      expect(remote.book).toBeUndefined();
      expect(remote.diagnostics).toContainEqual(expect.objectContaining({
        severity: 'error', code: 'BOOK_PROPERTY_UNSUPPORTED',
      }));

      const documentExtra = parseBook({
        ...base,
        documents: [{ path: './chapter.sdoc', remoteTarget: 'release' }],
      });
      expect(documentExtra.book).toBeUndefined();
      expect(documentExtra.diagnostics).toContainEqual(expect.objectContaining({
        severity: 'error', code: 'BOOK_PROPERTY_UNSUPPORTED', documentPath: './chapter.sdoc',
      }));
    },
  );

  it('blocks a publish property on 1.0 to match the versioned schema branch', () => {
    const result = parseBook({
      sdocBook: '1.0',
      publish: createDefaultSdocBookPublishProfile(),
      documents: [{ path: './chapter.sdoc' }],
    });
    expect(result.book).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'BOOK_PROPERTY_UNSUPPORTED',
    }));
  });

  it.each(['#abc', '#abcd', '#aabbcc', '#aabbccdd'])(
    'accepts supported CSS hex color %s',
    (color) => {
      const publish = createDefaultSdocBookPublishProfile();
      publish.settings.headingH1Color = color;
      expect(parseBook({
        sdocBook: '1.1', publish, documents: [{ path: './chapter.sdoc' }],
      }).book).toBeDefined();
    },
  );

  it.each(['#abcde', '#abcdef0'])(
    'rejects unsupported CSS hex length %s consistently with the schema',
    (color) => {
      const publish = createDefaultSdocBookPublishProfile();
      publish.settings.headingH1Color = color;
      const result = parseBook({
        sdocBook: '1.1', publish, documents: [{ path: './chapter.sdoc' }],
      });
      expect(result.book).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: 'PUBLISH_PROFILE_INVALID',
      }));
    },
  );

  it('rejects unsafe Book-relative CSS and output paths', () => {
    const cssTraversal = createDefaultSdocBookPublishProfile();
    cssTraversal.theme.cssPath = '../outside.css';
    const unsafeCss = parseBook({
      sdocBook: '1.1', publish: cssTraversal, documents: [{ path: './chapter.sdoc' }],
    });
    expect(unsafeCss.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PUBLISH_PATH_OUTSIDE_BOOK',
    }));

    const absoluteOutput = createDefaultSdocBookPublishProfile();
    absoluteOutput.outputDir = 'C:\\exports';
    const unsafeOutput = parseBook({
      sdocBook: '1.1', publish: absoluteOutput, documents: [{ path: './chapter.sdoc' }],
    });
    expect(unsafeOutput.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PUBLISH_PATH_OUTSIDE_BOOK',
    }));
  });

  it('accepts case-insensitive CSS extensions at both runtime and schema boundaries', () => {
    const publish = createDefaultSdocBookPublishProfile();
    publish.theme.cssPath = './styles/PRINT.CSS';
    expect(parseBook({
      sdocBook: '1.1', publish, documents: [{ path: './chapter.sdoc' }],
    }).book).toBeDefined();
  });

  it('upgrades only through an explicit profile-bearing operation', () => {
    const legacy: SdocBookV1_0 = {
      sdocBook: '1.0',
      title: 'Legacy',
      documents: [{ path: './chapter.sdoc' }],
    };
    const publish = createDefaultSdocBookPublishProfile();

    expect(upgradeBookToV1_1(legacy, publish)).toEqual({
      sdocBook: '1.1',
      title: 'Legacy',
      documents: [{ path: './chapter.sdoc' }],
      publish,
    });
    expect(legacy).not.toHaveProperty('publish');
    expect(legacy.sdocBook).toBe('1.0');
  });
});

describe('sdocbook schema parity', () => {
  let validate: ValidateFunction;

  beforeAll(async () => {
    const schema = JSON.parse(await readFile(resolve(import.meta.dirname, '..', 'sdocbook.schema.json'), 'utf8'));
    validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  });

  it('accepts 1.0 and requires publish only for 1.1', () => {
    expect(validate({ sdocBook: '1.0', documents: [{ path: './chapter.sdoc' }] })).toBe(true);
    expect(validate({ sdocBook: '1.1', documents: [{ path: './chapter.sdoc' }] })).toBe(false);
    expect(validate({
      sdocBook: '1.1',
      publish: createDefaultSdocBookPublishProfile(),
      documents: [{ path: './chapter.sdoc' }],
    })).toBe(true);
  });

  it('rejects non-relative publish paths at the schema boundary', () => {
    const publish = createDefaultSdocBookPublishProfile();
    publish.outputDir = '../outside';
    expect(validate({
      sdocBook: '1.1', publish, documents: [{ path: './chapter.sdoc' }],
    })).toBe(false);
  });

  it('matches runtime fail-closed traversal and case-insensitive CSS path handling', () => {
    const publish = createDefaultSdocBookPublishProfile();
    publish.theme.cssPath = './styles/PRINT.CSS';
    expect(validate({
      sdocBook: '1.1', publish, documents: [{ path: './chapter.sdoc' }],
    })).toBe(true);
    expect(validate({
      sdocBook: '1.0', documents: [{ path: '../outside.sdoc' }],
    })).toBe(false);
    expect(validate({
      sdocBook: '1.0', documents: [{ path: './chapters/../outside.sdoc' }],
    })).toBe(false);
    expect(parseBook({
      sdocBook: '1.0', documents: [{ path: '../outside.sdoc' }],
    }).book?.documents).toEqual([]);
    expect(parseBook({
      sdocBook: '1.0', documents: [{ path: './chapters/../outside.sdoc' }],
    }).book?.documents).toEqual([]);
  });

  it('keeps the documented 1.1 example valid in both schema and runtime parser', async () => {
    const example = JSON.parse(await readFile(
      resolve(import.meta.dirname, '..', 'examples', 'book-v1.1.sdocbook'),
      'utf8',
    )) as unknown;
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    const parsed = parseBook(example);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.book?.sdocBook).toBe('1.1');
  });
});
