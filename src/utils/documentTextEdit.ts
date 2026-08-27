export type DocumentTextEditCandidate = Readonly<{
  startOffset: number;
  endOffset: number;
  text: string;
}>;

export type DocumentTextEdit = DocumentTextEditCandidate & Readonly<{
  kind: 'minimal' | 'full';
}>;

export type SdocDocumentTextEditPlan = Readonly<{
  kind: 'single-span' | 'modified-and-content';
  edits: readonly DocumentTextEdit[];
}>;

export type DocumentTextEditCandidateFactory = (
  currentText: string,
  nextText: string,
) => DocumentTextEditCandidate;

export type DocumentTextEditSource = Readonly<{
  version: number;
  text: string;
}>;

export type DocumentTextEditMetrics = Readonly<{
  sourceCodeUnits: number;
  targetCodeUnits: number;
  sourceRangeCodeUnits: number;
  insertedCodeUnits: number;
  replacementRatioPpm: number;
}>;

const isHighSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xd800 && codeUnit <= 0xdbff;

const isLowSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xdc00 && codeUnit <= 0xdfff;

/**
 * VS Code positions are UTF-16 offsets. Keep edit boundaries outside CRLF and
 * surrogate pairs so positionAt never has to interpret a half line ending or
 * half code point.
 */
const isUnsafeBoundary = (text: string, offset: number): boolean => {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (before === 0x0d && after === 0x0a)
    || (isHighSurrogate(before) && isLowSurrogate(after));
};

export const computeMinimalDocumentTextEdit: DocumentTextEditCandidateFactory = (
  currentText,
  nextText,
) => {
  const sharedLimit = Math.min(currentText.length, nextText.length);
  let startOffset = 0;
  while (startOffset < sharedLimit
    && currentText.charCodeAt(startOffset) === nextText.charCodeAt(startOffset)) {
    startOffset += 1;
  }
  while (startOffset > 0
    && (isUnsafeBoundary(currentText, startOffset)
      || isUnsafeBoundary(nextText, startOffset))) {
    startOffset -= 1;
  }

  const suffixLimit = Math.min(
    currentText.length - startOffset,
    nextText.length - startOffset,
  );
  let suffixLength = 0;
  while (suffixLength < suffixLimit
    && currentText.charCodeAt(currentText.length - suffixLength - 1)
      === nextText.charCodeAt(nextText.length - suffixLength - 1)) {
    suffixLength += 1;
  }
  while (suffixLength > 0
    && (isUnsafeBoundary(currentText, currentText.length - suffixLength)
      || isUnsafeBoundary(nextText, nextText.length - suffixLength))) {
    suffixLength -= 1;
  }

  return {
    startOffset,
    endOffset: currentText.length - suffixLength,
    text: nextText.slice(startOffset, nextText.length - suffixLength),
  };
};

export const createFullDocumentTextEdit = (
  currentText: string,
  nextText: string,
): DocumentTextEdit => ({
  kind: 'full',
  startOffset: 0,
  endOffset: currentText.length,
  text: nextText,
});

const isValidCandidate = (
  currentText: string,
  nextText: string,
  candidate: DocumentTextEditCandidate,
): boolean => Number.isSafeInteger(candidate.startOffset)
  && Number.isSafeInteger(candidate.endOffset)
  && candidate.startOffset >= 0
  && candidate.endOffset >= candidate.startOffset
  && candidate.endOffset <= currentText.length
  && !isUnsafeBoundary(currentText, candidate.startOffset)
  && !isUnsafeBoundary(currentText, candidate.endOffset)
  && !isUnsafeBoundary(nextText, candidate.startOffset)
  && !isUnsafeBoundary(nextText, candidate.startOffset + candidate.text.length)
  && applyDocumentTextEdit(currentText, candidate) === nextText;

/**
 * Plans one contiguous replacement. A full replacement is deliberately kept
 * as the fail-closed path, including identical text where the existing host
 * protocol still requires a real document revision before it can ACK.
 */
export const planDocumentTextEdit = (
  currentText: string,
  nextText: string,
  createCandidate: DocumentTextEditCandidateFactory = computeMinimalDocumentTextEdit,
): DocumentTextEdit => {
  if (currentText === nextText) return createFullDocumentTextEdit(currentText, nextText);
  try {
    const candidate = createCandidate(currentText, nextText);
    if (!isValidCandidate(currentText, nextText, candidate)) {
      return createFullDocumentTextEdit(currentText, nextText);
    }
    const kind = candidate.startOffset === 0 && candidate.endOffset === currentText.length
      ? 'full'
      : 'minimal';
    return { kind, ...candidate };
  } catch {
    return createFullDocumentTextEdit(currentText, nextText);
  }
};

export const applyDocumentTextEdit = (
  currentText: string,
  edit: DocumentTextEditCandidate,
): string => currentText.slice(0, edit.startOffset)
  + edit.text
  + currentText.slice(edit.endOffset);

export const applyDocumentTextEdits = (
  currentText: string,
  edits: readonly DocumentTextEditCandidate[],
): string => [...edits]
  .sort((left, right) => right.startOffset - left.startOffset)
  .reduce((text, edit) => applyDocumentTextEdit(text, edit), currentText);

/**
 * Portable edit-size counters. The symmetric ratio is
 * (removed source code units + inserted target code units) /
 * (complete source code units + complete target code units), in integer ppm.
 */
export const measureDocumentTextEdit = (
  currentText: string,
  nextText: string,
  edit: DocumentTextEditCandidate,
): DocumentTextEditMetrics => {
  const sourceRangeCodeUnits = edit.endOffset - edit.startOffset;
  const insertedCodeUnits = edit.text.length;
  const completeCodeUnits = currentText.length + nextText.length;
  return {
    sourceCodeUnits: currentText.length,
    targetCodeUnits: nextText.length,
    sourceRangeCodeUnits,
    insertedCodeUnits,
    replacementRatioPpm: completeCodeUnits === 0
      ? 0
      : Math.round(
        ((sourceRangeCodeUnits + insertedCodeUnits) / completeCodeUnits) * 1_000_000,
      ),
  };
};

export const measureDocumentTextEdits = (
  currentText: string,
  nextText: string,
  edits: readonly DocumentTextEditCandidate[],
): DocumentTextEditMetrics => {
  const sourceRangeCodeUnits = edits.reduce(
    (total, edit) => total + edit.endOffset - edit.startOffset,
    0,
  );
  const insertedCodeUnits = edits.reduce((total, edit) => total + edit.text.length, 0);
  const completeCodeUnits = currentText.length + nextText.length;
  return {
    sourceCodeUnits: currentText.length,
    targetCodeUnits: nextText.length,
    sourceRangeCodeUnits,
    insertedCodeUnits,
    replacementRatioPpm: completeCodeUnits === 0
      ? 0
      : Math.round(
        ((sourceRangeCodeUnits + insertedCodeUnits) / completeCodeUnits) * 1_000_000,
      ),
  };
};

type JsonStringToken = Readonly<{
  startOffset: number;
  endOffset: number;
  value: string;
}>;

type JsonObjectProperty = Readonly<{
  key: string;
  valueStartOffset: number;
  valueEndOffset: number;
}>;

const skipJsonWhitespace = (text: string, offset: number): number => {
  let cursor = offset;
  while (cursor < text.length && /[\t\n\r ]/.test(text[cursor])) cursor += 1;
  return cursor;
};

const readJsonStringToken = (text: string, offset: number): JsonStringToken => {
  if (text[offset] !== '"') throw new Error('expected JSON string');
  let cursor = offset + 1;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === '"') {
      const endOffset = cursor + 1;
      const value: unknown = JSON.parse(text.slice(offset, endOffset));
      if (typeof value !== 'string') throw new Error('expected decoded JSON string');
      return { startOffset: offset, endOffset, value };
    }
    if (character === '\\') {
      cursor += 1;
      if (text[cursor] === 'u') cursor += 4;
    }
    cursor += 1;
  }
  throw new Error('unterminated JSON string');
};

const scanJsonValueEnd = (text: string, offset: number): number => {
  if (text[offset] === '"') return readJsonStringToken(text, offset).endOffset;
  if (text[offset] !== '{' && text[offset] !== '[') {
    let cursor = offset;
    while (cursor < text.length && !/[\t\n\r ,}\]]/.test(text[cursor])) cursor += 1;
    if (cursor === offset) throw new Error('empty JSON value');
    return cursor;
  }
  const stack: string[] = [text[offset]];
  let cursor = offset + 1;
  while (cursor < text.length && stack.length > 0) {
    if (text[cursor] === '"') {
      cursor = readJsonStringToken(text, cursor).endOffset;
      continue;
    }
    if (text[cursor] === '{' || text[cursor] === '[') stack.push(text[cursor]);
    if (text[cursor] === '}' || text[cursor] === ']') {
      const opening = stack.pop();
      if ((opening === '{' && text[cursor] !== '}')
        || (opening === '[' && text[cursor] !== ']')) {
        throw new Error('mismatched JSON container');
      }
    }
    cursor += 1;
  }
  if (stack.length > 0) throw new Error('unterminated JSON container');
  return cursor;
};

const readJsonObjectProperties = (
  text: string,
  objectOffset: number,
): readonly JsonObjectProperty[] => {
  if (text[objectOffset] !== '{') throw new Error('expected JSON object');
  const properties: JsonObjectProperty[] = [];
  let cursor = skipJsonWhitespace(text, objectOffset + 1);
  while (text[cursor] !== '}') {
    const key = readJsonStringToken(text, cursor);
    cursor = skipJsonWhitespace(text, key.endOffset);
    if (text[cursor] !== ':') throw new Error('expected JSON property colon');
    const valueStartOffset = skipJsonWhitespace(text, cursor + 1);
    const valueEndOffset = scanJsonValueEnd(text, valueStartOffset);
    properties.push({ key: key.value, valueStartOffset, valueEndOffset });
    cursor = skipJsonWhitespace(text, valueEndOffset);
    if (text[cursor] === '}') break;
    if (text[cursor] !== ',') throw new Error('expected JSON property separator');
    cursor = skipJsonWhitespace(text, cursor + 1);
  }
  if (text[cursor] !== '}') throw new Error('unterminated JSON object');
  return properties;
};

const findModifiedStringToken = (text: string): JsonStringToken => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected SDOC JSON object');
  }
  const rootOffset = skipJsonWhitespace(text, 0);
  const metaProperties = readJsonObjectProperties(text, rootOffset)
    .filter((property) => property.key === 'meta');
  if (metaProperties.length !== 1) throw new Error('expected one meta property');
  const meta = metaProperties[0];
  if (text[meta.valueStartOffset] !== '{') throw new Error('expected meta object');
  const modifiedProperties = readJsonObjectProperties(text, meta.valueStartOffset)
    .filter((property) => property.key === 'modified');
  if (modifiedProperties.length !== 1) throw new Error('expected one modified property');
  const modified = modifiedProperties[0];
  if (text[modified.valueStartOffset] !== '"') throw new Error('expected modified string');
  const token = readJsonStringToken(text, modified.valueStartOffset);
  if (token.endOffset !== modified.valueEndOffset) throw new Error('invalid modified token');
  return token;
};

const singleSpanPlan = (
  currentText: string,
  nextText: string,
): SdocDocumentTextEditPlan => ({
  kind: 'single-span',
  edits: [planDocumentTextEdit(currentText, nextText)],
});

/**
 * Splits only the canonical $.meta.modified token from one remaining span.
 * Any lexical ambiguity, offset shift, overlap, or reconstruction mismatch
 * falls back to the general single-span plan.
 */
export const planSdocDocumentTextEdits = (
  currentText: string,
  nextText: string,
): SdocDocumentTextEditPlan => {
  try {
    const currentModified = findModifiedStringToken(currentText);
    const nextModified = findModifiedStringToken(nextText);
    if (currentModified.value === nextModified.value
      || currentModified.startOffset !== nextModified.startOffset
      || currentModified.endOffset !== nextModified.endOffset) {
      return singleSpanPlan(currentText, nextText);
    }
    const nextModifiedText = nextText.slice(
      nextModified.startOffset,
      nextModified.endOffset,
    );
    if (nextModifiedText.length
      !== currentModified.endOffset - currentModified.startOffset) {
      return singleSpanPlan(currentText, nextText);
    }
    const modifiedEdit: DocumentTextEdit = {
      kind: 'minimal',
      startOffset: currentModified.startOffset,
      endOffset: currentModified.endOffset,
      text: nextModifiedText,
    };
    const virtualCurrent = applyDocumentTextEdit(currentText, modifiedEdit);
    if (virtualCurrent === nextText) {
      return { kind: 'single-span', edits: [modifiedEdit] };
    }
    const contentEdit = planDocumentTextEdit(virtualCurrent, nextText);
    const edits = [modifiedEdit, contentEdit]
      .sort((left, right) => left.startOffset - right.startOffset);
    if (edits[0].endOffset > edits[1].startOffset
      || applyDocumentTextEdits(currentText, edits) !== nextText) {
      return singleSpanPlan(currentText, nextText);
    }
    return { kind: 'modified-and-content', edits };
  } catch {
    return singleSpanPlan(currentText, nextText);
  }
};

export const isDocumentTextEditSourceCurrent = (
  source: DocumentTextEditSource,
  currentVersion: number,
  currentText: string,
): boolean => currentVersion === source.version && currentText === source.text;

export const isDocumentTextEditApplicationConfirmed = (
  source: DocumentTextEditSource,
  currentVersion: number,
  expectedText: string,
  currentText: string,
  consumedRevision: number | undefined,
): boolean => currentVersion === source.version + 1
  && currentText === expectedText
  && consumedRevision === currentVersion;
