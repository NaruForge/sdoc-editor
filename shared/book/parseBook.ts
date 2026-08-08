import type {
  BookDiagnostic,
  BookParseResult,
  SdocBook,
  SdocBookDocumentEntry,
  SdocBookPublishProfileV1,
  SdocBookPublishSettingsV1,
} from './types';
import { validateDocumentSettings } from '../document/documentContract';
import {
  BOOK_MANIFEST_MAX_BYTES,
  BOOK_MAX_DIAGNOSTICS,
  BOOK_MAX_DOCUMENTS,
  BOOK_MAX_DIAGNOSTIC_TEXT_LENGTH,
  BOOK_MAX_PATH_LENGTH,
  measureBookUtf8Bytes,
} from './limits';

const BOOK_PROPERTIES = new Set([
  'sdocBook', 'title', 'author', 'version', 'counterPolicy', 'documents', 'publish',
]);
const PUBLISH_PROPERTIES = new Set([
  'profileVersion', 'settings', 'theme', 'html', 'pdf', 'diagrams', 'outputDir',
]);
const PUBLISH_SETTING_KEYS = [
  'headingNumbering',
  'headingStartNumber',
  'headingDecoration',
  'headingH1Color',
  'headingH2Color',
  'headingH3Color',
  'headingH4Color',
  'headingH5Color',
  'headingH6Color',
  'captionStyle',
  'captionNumbering',
  'equationNumbering',
  'crossRefIncludeCaption',
] as const satisfies readonly (keyof SdocBookPublishSettingsV1)[];
const PUBLISH_SETTING_KEY_SET = new Set<string>(PUBLISH_SETTING_KEYS);
const BOOK_HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function normalizeInput(input: unknown): { value?: unknown; diagnostic?: BookDiagnostic } {
  if (typeof input !== 'string') return { value: input };
  const byteLength = measureBookUtf8Bytes(input);
  if (byteLength > BOOK_MANIFEST_MAX_BYTES) {
    return {
      diagnostic: {
        severity: 'error',
        code: 'BOOK_MANIFEST_TOO_LARGE',
        message: `.sdocbook manifest exceeds the ${BOOK_MANIFEST_MAX_BYTES.toLocaleString('en-US')} byte limit (${byteLength.toLocaleString('en-US')} bytes).`,
      },
    };
  }
  if (!input.trim()) return { value: { sdocBook: '1.0', documents: [] } };
  try {
    return { value: JSON.parse(input) as unknown };
  } catch (error) {
    return {
      diagnostic: {
        severity: 'error',
        code: 'BOOK_INVALID',
        message: `Invalid .sdocbook JSON: ${error instanceof Error ? error.message : String(error)}`
          .slice(0, BOOK_MAX_DIAGNOSTIC_TEXT_LENGTH),
      },
    };
  }
}

/** Convert an untrusted path to the stable Book-relative form used by the book core. */
export function normalizeBookRelativePath(
  input: string,
  options: { allowBookRoot?: boolean; rejectParentSegments?: boolean } = {},
): string | null {
  if (input.length > BOOK_MAX_PATH_LENGTH) return null;
  const path = input.trim().replace(/\\/g, '/');
  if (!path
    || /[\u0000-\u001f\u007f]/.test(path)
    || path.startsWith('/')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)
    || path.startsWith('//')) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment.includes(':')) return null;
    if (segment === '..') {
      if (options.rejectParentSegments) return null;
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? `./${segments.join('/')}` : options.allowBookRoot ? './' : null;
}

/** Convert a document path to the stable, project-relative form used by the book core. */
export function normalizeBookDocumentPath(input: string): string | null {
  return normalizeBookRelativePath(input, { rejectParentSegments: true });
}

type AddBookDiagnostic = (diagnostic: BookDiagnostic) => void;

function parsePublishProfile(
  value: unknown,
  addDiagnostic: AddBookDiagnostic,
): SdocBookPublishProfileV1 | undefined {
  let invalid = false;
  const addInvalid = (message: string): void => {
    invalid = true;
    addDiagnostic({ severity: 'error', code: 'PUBLISH_PROFILE_INVALID', message });
  };

  if (!isRecord(value)) {
    addInvalid('publish must be an inline publish profile object.');
    return undefined;
  }

  for (const property of Object.keys(value)) {
    if (!PUBLISH_PROPERTIES.has(property)) {
      addInvalid(`Unsupported publish profile property: ${property}`);
    }
  }

  if (value.profileVersion !== '1') {
    addInvalid('publish.profileVersion must be 1.');
  }

  const rawSettings = value.settings;
  let settings: SdocBookPublishSettingsV1 | undefined;
  if (!isRecord(rawSettings)
    || !validateDocumentSettings(rawSettings)
    || Object.keys(rawSettings).some((key) => !PUBLISH_SETTING_KEY_SET.has(key))
    || PUBLISH_SETTING_KEYS.some((key) => rawSettings[key] === undefined)
    || ([1, 2, 3, 4, 5, 6] as const).some((level) =>
      !BOOK_HEX_COLOR_PATTERN.test(String(rawSettings[`headingH${level}Color`] ?? '')))) {
    addInvalid('publish.settings must contain the complete portable Book settings snapshot.');
  } else {
    settings = Object.fromEntries(
      PUBLISH_SETTING_KEYS.map((key) => [key, rawSettings[key]]),
    ) as SdocBookPublishSettingsV1;
  }

  let theme: SdocBookPublishProfileV1['theme'] | undefined;
  if (!isRecord(value.theme) || value.theme.id !== 'default-v1') {
    addInvalid('publish.theme.id must be default-v1.');
  } else if (Object.keys(value.theme).some((key) => key !== 'id' && key !== 'cssPath')) {
    addInvalid('publish.theme contains an unsupported property.');
  } else if (value.theme.cssPath !== undefined && typeof value.theme.cssPath !== 'string') {
    addInvalid('publish.theme.cssPath must be a Book-relative CSS path.');
  } else {
    const cssPath = typeof value.theme.cssPath === 'string'
      ? normalizeBookRelativePath(value.theme.cssPath, { rejectParentSegments: true })
      : undefined;
    if (typeof value.theme.cssPath === 'string'
      && (!cssPath || !cssPath.toLocaleLowerCase('en-US').endsWith('.css'))) {
      invalid = true;
      addDiagnostic({
        severity: 'error',
        code: 'PUBLISH_PATH_OUTSIDE_BOOK',
        message: `Publish CSS path must stay inside the Book folder and use .css: ${value.theme.cssPath}`,
      });
    } else {
      theme = { id: 'default-v1', ...(cssPath ? { cssPath } : {}) };
    }
  }

  let html: SdocBookPublishProfileV1['html'] | undefined;
  if (!isRecord(value.html)
    || !['none', 'images-only', 'full'].includes(String(value.html.selfContained))
    || Object.keys(value.html).some((key) => key !== 'selfContained')) {
    addInvalid('publish.html must contain a valid selfContained mode.');
  } else {
    html = { selfContained: value.html.selfContained as SdocBookPublishProfileV1['html']['selfContained'] };
  }

  let pdf: SdocBookPublishProfileV1['pdf'] | undefined;
  if (!isRecord(value.pdf)
    || typeof value.pdf.scale !== 'number'
    || !Number.isFinite(value.pdf.scale)
    || value.pdf.scale < 10
    || value.pdf.scale > 200
    || Object.keys(value.pdf).some((key) => key !== 'scale')) {
    addInvalid('publish.pdf.scale must be a finite number from 10 through 200.');
  } else {
    pdf = { scale: value.pdf.scale };
  }

  let diagrams: SdocBookPublishProfileV1['diagrams'] | undefined;
  if (!isRecord(value.diagrams)
    || (value.diagrams.failurePolicy !== 'fail' && value.diagrams.failurePolicy !== 'source-fallback')
    || Object.keys(value.diagrams).some((key) => key !== 'failurePolicy')) {
    addInvalid('publish.diagrams.failurePolicy must be fail or source-fallback.');
  } else {
    diagrams = { failurePolicy: value.diagrams.failurePolicy };
  }

  let outputDir: string | undefined;
  if (value.outputDir !== undefined) {
    if (typeof value.outputDir !== 'string') {
      addInvalid('publish.outputDir must be a Book-relative directory.');
    } else {
      outputDir = normalizeBookRelativePath(value.outputDir, {
        allowBookRoot: true,
        rejectParentSegments: true,
      }) ?? undefined;
      if (!outputDir) {
        invalid = true;
        addDiagnostic({
          severity: 'error',
          code: 'PUBLISH_PATH_OUTSIDE_BOOK',
          message: `Publish output directory must stay inside the Book folder: ${value.outputDir}`,
        });
      }
    }
  }

  if (invalid || !settings || !theme || !html || !pdf || !diagrams) return undefined;
  return {
    profileVersion: '1',
    settings,
    theme,
    html,
    pdf,
    diagrams,
    ...(outputDir ? { outputDir } : {}),
  };
}

export function parseBook(input: unknown): BookParseResult {
  const normalizedInput = normalizeInput(input);
  if (normalizedInput.diagnostic) {
    return { diagnostics: [normalizedInput.diagnostic] };
  }

  const value = normalizedInput.value;
  if (!isRecord(value)) {
    return {
      diagnostics: [{ severity: 'error', code: 'BOOK_INVALID', message: '.sdocbook root must be an object.' }],
    };
  }

  const diagnostics: BookDiagnostic[] = [];
  let diagnosticsTruncated = false;
  let contractShapeInvalid = false;
  const addDiagnostic = (diagnostic: BookDiagnostic): void => {
    const bounded: BookDiagnostic = {
      ...diagnostic,
      message: diagnostic.message.slice(0, BOOK_MAX_DIAGNOSTIC_TEXT_LENGTH),
      ...(diagnostic.documentPath
        ? { documentPath: diagnostic.documentPath.slice(0, BOOK_MAX_PATH_LENGTH) }
        : {}),
      ...(diagnostic.nodeId
        ? { nodeId: diagnostic.nodeId.slice(0, BOOK_MAX_PATH_LENGTH) }
        : {}),
    };
    if (diagnostics.length < BOOK_MAX_DIAGNOSTICS - 1) diagnostics.push(bounded);
    else diagnosticsTruncated = true;
  };
  const bookVersion = value.sdocBook;
  if (bookVersion !== '1.0' && bookVersion !== '1.1') {
    addDiagnostic({
      severity: 'error',
      code: 'BOOK_VERSION_UNSUPPORTED',
      message: `Unsupported .sdocbook version: ${String(bookVersion ?? '(missing)')}`,
    });
  }

  for (const property of Object.keys(value)) {
    if (!BOOK_PROPERTIES.has(property)) {
      contractShapeInvalid = true;
      addDiagnostic({
        severity: 'error',
        code: 'BOOK_PROPERTY_UNSUPPORTED',
        message: `Unsupported .sdocbook property: ${property}`,
      });
    }
  }

  for (const property of ['title', 'author', 'version'] as const) {
    if (value[property] !== undefined && typeof value[property] !== 'string') {
      addDiagnostic({
        severity: 'error',
        code: 'BOOK_INVALID',
        message: `${property} must be a string.`,
      });
    }
  }
  if (value.counterPolicy !== undefined && value.counterPolicy !== 'continue' && value.counterPolicy !== 'reset') {
    addDiagnostic({ severity: 'error', code: 'BOOK_INVALID', message: 'counterPolicy must be continue or reset.' });
  }

  let publish: SdocBookPublishProfileV1 | undefined;
  if (bookVersion === '1.1') {
    if (value.publish === undefined) {
      addDiagnostic({
        severity: 'error',
        code: 'BOOK_PUBLISH_PROFILE_REQUIRED',
        message: '.sdocbook 1.1 requires an inline publish profile.',
      });
    } else {
      publish = parsePublishProfile(value.publish, addDiagnostic);
    }
  } else if (bookVersion === '1.0' && value.publish !== undefined) {
    contractShapeInvalid = true;
    addDiagnostic({
      severity: 'error',
      code: 'BOOK_PROPERTY_UNSUPPORTED',
      message: 'publish is supported only by .sdocbook 1.1 and was not applied.',
    });
  }

  const documents: SdocBookDocumentEntry[] = [];
  const seenPaths = new Set<string>();
  if (!Array.isArray(value.documents)) {
    addDiagnostic({ severity: 'error', code: 'BOOK_INVALID', message: 'documents must be an array.' });
  } else {
    if (value.documents.length > BOOK_MAX_DOCUMENTS) {
      addDiagnostic({
        severity: 'error',
        code: 'BOOK_DOCUMENT_LIMIT_EXCEEDED',
        message: `.sdocbook contains ${value.documents.length.toLocaleString('en-US')} documents; the limit is ${BOOK_MAX_DOCUMENTS.toLocaleString('en-US')}.`,
      });
    }
    value.documents.slice(0, BOOK_MAX_DOCUMENTS).forEach((item, index) => {
      if (!isRecord(item) || typeof item.path !== 'string' || !item.path.trim()) {
        addDiagnostic({
          severity: 'error',
          code: 'DOCUMENT_PATH_INVALID',
          message: `Document ${index + 1} must have a non-empty path.`,
        });
        return;
      }

      const normalizedPath = normalizeBookDocumentPath(item.path);
      if (!normalizedPath) {
        addDiagnostic({
          severity: 'error',
          code: 'DOCUMENT_PATH_OUTSIDE_BOOK',
          message: `Document path must stay inside the book folder: ${item.path}`,
          documentPath: item.path,
        });
        return;
      }
      if (!normalizedPath.toLowerCase().endsWith('.sdoc')) {
        addDiagnostic({
          severity: 'error',
          code: 'DOCUMENT_PATH_INVALID',
          message: `Book documents must use the .sdoc extension: ${normalizedPath}`,
          documentPath: normalizedPath,
        });
      }
      const portableCollisionKey = normalizedPath.normalize('NFC').toLocaleLowerCase('en-US');
      if (seenPaths.has(portableCollisionKey)) {
        addDiagnostic({
          severity: 'error',
          code: 'DOCUMENT_DUPLICATE',
          message: `Document is listed more than once: ${normalizedPath}`,
          documentPath: normalizedPath,
        });
      }
      seenPaths.add(portableCollisionKey);

      for (const property of Object.keys(item)) {
        if (property !== 'path' && property !== 'label') {
          contractShapeInvalid = true;
          addDiagnostic({
            severity: 'error',
            code: 'BOOK_PROPERTY_UNSUPPORTED',
            message: `Unsupported document property in ${normalizedPath}: ${property}`,
            documentPath: normalizedPath,
          });
        }
      }
      if (item.label !== undefined && typeof item.label !== 'string') {
        addDiagnostic({
          severity: 'error',
          code: 'BOOK_INVALID',
          message: `Document label must be a string: ${normalizedPath}`,
          documentPath: normalizedPath,
        });
      }

      const entry: SdocBookDocumentEntry = { path: normalizedPath };
      if (typeof item.label === 'string' && item.label.trim()) entry.label = item.label.trim();
      documents.push(entry);
    });
  }

  if (documents.length === 0) {
    addDiagnostic({
      severity: 'error',
      code: 'BOOK_NO_DOCUMENTS',
      message: 'Add at least one .sdoc document to the book.',
    });
  }

  if (diagnosticsTruncated) {
    diagnostics.push({
      severity: 'warning',
      code: 'BOOK_DIAGNOSTICS_TRUNCATED',
      message: `Additional book diagnostics were omitted after the first ${(BOOK_MAX_DIAGNOSTICS - 1).toLocaleString('en-US')}.`,
    });
  }

  if (bookVersion !== '1.0' && bookVersion !== '1.1') return { diagnostics };
  if (contractShapeInvalid) return { diagnostics };
  if (bookVersion === '1.1' && !publish) return { diagnostics };

  let book: SdocBook;
  if (bookVersion === '1.0') {
    book = { sdocBook: '1.0', documents };
  } else {
    if (!publish) return { diagnostics };
    book = { sdocBook: '1.1', publish, documents };
  }
  if (typeof value.title === 'string') book.title = value.title;
  if (typeof value.author === 'string') book.author = value.author;
  if (typeof value.version === 'string') book.version = value.version;
  if (value.counterPolicy === 'continue' || value.counterPolicy === 'reset') book.counterPolicy = value.counterPolicy;

  return { book, diagnostics };
}
