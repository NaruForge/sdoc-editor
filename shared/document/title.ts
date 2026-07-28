export const DOCUMENT_TITLE_MAX_LENGTH = 200;

export type DocumentTitleValidationResult =
  | { ok: true; title: string }
  | { ok: false; reason: 'empty' | 'too-long' };

export const unicodeCodePointLength = (value: string): number => {
  let length = 0;
  for (const _codePoint of value) length += 1;
  return length;
};

export const normalizeDocumentTitle = (value: string): DocumentTitleValidationResult => {
  if (unicodeCodePointLength(value) > DOCUMENT_TITLE_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  const title = value.trim();
  if (title.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, title };
};

export const validateDocumentTitle = (value: string): string | undefined => {
  const result = normalizeDocumentTitle(value);
  if (!result.ok && result.reason === 'empty') return 'Enter a document title.';
  if (!result.ok) return 'The title must be 200 characters or fewer.';
  return undefined;
};
