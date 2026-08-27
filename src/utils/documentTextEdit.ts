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
  tokenOffsetSource: 'trusted' | 'lexical';
}>;

export type SdocModifiedStringToken = Readonly<{
  startOffset: number;
  endOffset: number;
  encodedToken: string;
}>;

export type SdocSerializedText = Readonly<{
  text: string;
  modifiedToken?: SdocModifiedStringToken;
}>;

export type SdocDocumentTextEditHints = Readonly<{
  currentModifiedToken: SdocModifiedStringToken;
  nextModifiedToken: SdocModifiedStringToken;
}>;

export type SdocModifiedTokenCacheAuthority = Readonly<{
  sessionId: string;
  documentId: string;
  documentIdentity: object;
}>;

export type SdocModifiedTokenCacheSource = Readonly<{
  revision: number;
  endOfLine: '\n' | '\r\n';
  sourceLength: number;
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

const MAX_CACHED_MODIFIED_TOKEN_CODE_UNITS = 256;
const MODIFIED_TOKEN_ANCHOR_CODE_UNITS = 32;

const readTrustedStringTokenValue = (
  text: string,
  token: SdocModifiedStringToken,
): string | undefined => {
  if (!Number.isSafeInteger(token.startOffset)
    || !Number.isSafeInteger(token.endOffset)
    || token.startOffset < 0
    || token.endOffset <= token.startOffset
    || token.endOffset > text.length
    || token.encodedToken.length > MAX_CACHED_MODIFIED_TOKEN_CODE_UNITS
    || token.endOffset - token.startOffset !== token.encodedToken.length
    || text.slice(token.startOffset, token.endOffset) !== token.encodedToken
    || isUnsafeBoundary(text, token.startOffset)
    || isUnsafeBoundary(text, token.endOffset)) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(token.encodedToken);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

type CachedModifiedTokenEntry = Readonly<{
  sessionId: string;
  documentId: string;
  documentIdentity: object;
  revision: number;
  endOfLine: '\n' | '\r\n';
  sourceLength: number;
  token: SdocModifiedStringToken;
  leftAnchor: string;
  rightAnchor: string;
}>;

/**
 * Holds only bounded lexical authority for one live TextDocument session. The
 * complete text and a complete-text hash deliberately never enter the cache.
 */
export class RevisionBoundSdocModifiedTokenCache {
  private entry: CachedModifiedTokenEntry | undefined;

  public get hasEntry(): boolean {
    return this.entry !== undefined;
  }

  public adopt(
    authority: SdocModifiedTokenCacheAuthority,
    source: SdocModifiedTokenCacheSource,
    text: string,
    token: SdocModifiedStringToken,
  ): boolean {
    this.invalidate();
    if (!authority.sessionId || !authority.documentId
      || !Number.isSafeInteger(source.revision)
      || source.revision < 0
      || source.sourceLength !== text.length
      || readTrustedStringTokenValue(text, token) === undefined) {
      return false;
    }
    this.entry = {
      ...authority,
      ...source,
      token: { ...token },
      leftAnchor: text.slice(
        Math.max(0, token.startOffset - MODIFIED_TOKEN_ANCHOR_CODE_UNITS),
        token.startOffset,
      ),
      rightAnchor: text.slice(
        token.endOffset,
        Math.min(text.length, token.endOffset + MODIFIED_TOKEN_ANCHOR_CODE_UNITS),
      ),
    };
    return true;
  }

  public resolve(
    authority: SdocModifiedTokenCacheAuthority,
    source: SdocModifiedTokenCacheSource,
    text: string,
  ): SdocModifiedStringToken | undefined {
    const entry = this.entry;
    if (!entry
      || entry.sessionId !== authority.sessionId
      || entry.documentId !== authority.documentId
      || entry.documentIdentity !== authority.documentIdentity
      || entry.revision !== source.revision
      || entry.endOfLine !== source.endOfLine
      || entry.sourceLength !== source.sourceLength
      || source.sourceLength !== text.length
      || readTrustedStringTokenValue(text, entry.token) === undefined
      || text.slice(
        Math.max(0, entry.token.startOffset - MODIFIED_TOKEN_ANCHOR_CODE_UNITS),
        entry.token.startOffset,
      ) !== entry.leftAnchor
      || text.slice(
        entry.token.endOffset,
        Math.min(text.length, entry.token.endOffset + MODIFIED_TOKEN_ANCHOR_CODE_UNITS),
      ) !== entry.rightAnchor) {
      this.invalidate();
      return undefined;
    }
    return { ...entry.token };
  }

  public invalidate(): void {
    this.entry = undefined;
  }
}

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

const findStringPropertyToken = (
  text: string,
  objectOffset: number,
  propertyName: string,
): JsonStringToken => {
  const properties = readJsonObjectProperties(text, objectOffset)
    .filter((property) => property.key === propertyName);
  if (properties.length !== 1) throw new Error(`expected one ${propertyName} property`);
  const property = properties[0];
  if (text[property.valueStartOffset] !== '"') {
    throw new Error(`expected ${propertyName} string`);
  }
  const token = readJsonStringToken(text, property.valueStartOffset);
  if (token.endOffset !== property.valueEndOffset) {
    throw new Error(`invalid ${propertyName} token`);
  }
  return token;
};

const countLineFeedsBefore = (text: string, offset: number): number => {
  let count = 0;
  for (let cursor = 0; cursor < offset; cursor += 1) {
    if (text.charCodeAt(cursor) === 0x0a) count += 1;
  }
  return count;
};

/**
 * Preserves JSON.stringify's exact persisted bytes while deriving the next
 * canonical modified-token offset from the small serialized meta object. It
 * never scans or parses the complete serialized document to find the token.
 */
export const serializePrettySdocWithModifiedToken = (
  envelope: Readonly<{
    sdoc: unknown;
    meta: Readonly<{ modified?: unknown }>;
    doc: unknown;
  }>,
  endOfLine: '\n' | '\r\n',
): SdocSerializedText => {
  const serializedLf = `${JSON.stringify(envelope, null, 2)}\n`;
  const text = endOfLine === '\n'
    ? serializedLf
    : serializedLf.replace(/\n/g, '\r\n');
  if (typeof envelope.meta.modified !== 'string') return { text };
  try {
    const serializedSdoc = JSON.stringify(envelope.sdoc);
    const serializedMeta = JSON.stringify(envelope.meta, null, 2);
    if (typeof serializedSdoc !== 'string' || typeof serializedMeta !== 'string') {
      return { text };
    }
    const metaToken = findStringPropertyToken(serializedMeta, 0, 'modified');
    if (metaToken.value !== envelope.meta.modified) return { text };
    const rootPrefix = `{\n  "sdoc": ${serializedSdoc},\n  "meta": `;
    if (!serializedLf.startsWith(rootPrefix)) return { text };
    const nestedIndentBeforeStart = countLineFeedsBefore(
      serializedMeta,
      metaToken.startOffset,
    ) * 2;
    const nestedIndentBeforeEnd = countLineFeedsBefore(
      serializedMeta,
      metaToken.endOffset,
    ) * 2;
    const lfStartOffset = rootPrefix.length
      + metaToken.startOffset
      + nestedIndentBeforeStart;
    const lfEndOffset = rootPrefix.length
      + metaToken.endOffset
      + nestedIndentBeforeEnd;
    const eolStartAdjustment = endOfLine === '\r\n'
      ? countLineFeedsBefore(serializedLf, lfStartOffset)
      : 0;
    const eolEndAdjustment = endOfLine === '\r\n'
      ? countLineFeedsBefore(serializedLf, lfEndOffset)
      : 0;
    const startOffset = lfStartOffset + eolStartAdjustment;
    const endOffset = lfEndOffset + eolEndAdjustment;
    const encodedToken = text.slice(startOffset, endOffset);
    const modifiedToken = { startOffset, endOffset, encodedToken };
    if (readTrustedStringTokenValue(text, modifiedToken) !== envelope.meta.modified) {
      return { text };
    }
    return { text, modifiedToken };
  } catch {
    return { text };
  }
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
  return findStringPropertyToken(text, meta.valueStartOffset, 'modified');
};

const singleSpanPlan = (
  currentText: string,
  nextText: string,
): SdocDocumentTextEditPlan => ({
  kind: 'single-span',
  edits: [planDocumentTextEdit(currentText, nextText)],
  tokenOffsetSource: 'lexical',
});

const segmentsEqual = (
  left: string,
  leftStart: number,
  leftEnd: number,
  right: string,
  rightStart: number,
): boolean => {
  const length = leftEnd - leftStart;
  if (rightStart + length > right.length) return false;
  for (let offset = 0; offset < length; offset += 1) {
    if (left.charCodeAt(leftStart + offset) !== right.charCodeAt(rightStart + offset)) {
      return false;
    }
  }
  return true;
};

const editsReconstructExactly = (
  currentText: string,
  nextText: string,
  edits: readonly DocumentTextEditCandidate[],
): boolean => {
  const sorted = [...edits].sort((left, right) => left.startOffset - right.startOffset);
  let sourceOffset = 0;
  let targetOffset = 0;
  for (const edit of sorted) {
    if (edit.startOffset < sourceOffset
      || edit.endOffset < edit.startOffset
      || edit.endOffset > currentText.length
      || !segmentsEqual(
        currentText,
        sourceOffset,
        edit.startOffset,
        nextText,
        targetOffset,
      )) {
      return false;
    }
    targetOffset += edit.startOffset - sourceOffset;
    if (!segmentsEqual(edit.text, 0, edit.text.length, nextText, targetOffset)) {
      return false;
    }
    targetOffset += edit.text.length;
    sourceOffset = edit.endOffset;
  }
  return segmentsEqual(
    currentText,
    sourceOffset,
    currentText.length,
    nextText,
    targetOffset,
  ) && targetOffset + currentText.length - sourceOffset === nextText.length;
};

const computeContentEditIgnoringModifiedToken = (
  currentText: string,
  nextText: string,
  modifiedToken: SdocModifiedStringToken,
): DocumentTextEdit | undefined => {
  const sharedLimit = Math.min(currentText.length, nextText.length);
  let startOffset = 0;
  while (startOffset < sharedLimit) {
    if (startOffset === modifiedToken.startOffset
      && modifiedToken.endOffset <= sharedLimit) {
      startOffset = modifiedToken.endOffset;
      continue;
    }
    if (currentText.charCodeAt(startOffset) !== nextText.charCodeAt(startOffset)) break;
    startOffset += 1;
  }
  if (startOffset === currentText.length && startOffset === nextText.length) return undefined;
  while (startOffset > 0
    && (isUnsafeBoundary(currentText, startOffset)
      || isUnsafeBoundary(nextText, startOffset))) {
    startOffset -= 1;
  }

  let currentEndOffset = currentText.length;
  let nextEndOffset = nextText.length;
  while (currentEndOffset > startOffset && nextEndOffset > startOffset) {
    if (currentEndOffset === modifiedToken.endOffset
      && nextEndOffset === modifiedToken.endOffset
      && modifiedToken.startOffset >= startOffset) {
      currentEndOffset = modifiedToken.startOffset;
      nextEndOffset = modifiedToken.startOffset;
      continue;
    }
    if (currentText.charCodeAt(currentEndOffset - 1)
      !== nextText.charCodeAt(nextEndOffset - 1)) break;
    currentEndOffset -= 1;
    nextEndOffset -= 1;
  }
  while ((isUnsafeBoundary(currentText, currentEndOffset)
    || isUnsafeBoundary(nextText, nextEndOffset))
    && currentEndOffset < currentText.length
    && nextEndOffset < nextText.length) {
    currentEndOffset += 1;
    nextEndOffset += 1;
  }
  return {
    kind: startOffset === 0 && currentEndOffset === currentText.length ? 'full' : 'minimal',
    startOffset,
    endOffset: currentEndOffset,
    text: nextText.slice(startOffset, nextEndOffset),
  };
};

const planWithTrustedModifiedTokens = (
  currentText: string,
  nextText: string,
  hints: SdocDocumentTextEditHints,
): SdocDocumentTextEditPlan | undefined => {
  const currentValue = readTrustedStringTokenValue(currentText, hints.currentModifiedToken);
  const nextValue = readTrustedStringTokenValue(nextText, hints.nextModifiedToken);
  if (currentValue === undefined || nextValue === undefined || currentValue === nextValue
    || hints.currentModifiedToken.startOffset !== hints.nextModifiedToken.startOffset
    || hints.currentModifiedToken.endOffset !== hints.nextModifiedToken.endOffset
    || hints.currentModifiedToken.encodedToken.length
      !== hints.nextModifiedToken.encodedToken.length) {
    return undefined;
  }
  const modifiedEdit: DocumentTextEdit = {
    kind: 'minimal',
    startOffset: hints.currentModifiedToken.startOffset,
    endOffset: hints.currentModifiedToken.endOffset,
    text: hints.nextModifiedToken.encodedToken,
  };
  const contentEdit = computeContentEditIgnoringModifiedToken(
    currentText,
    nextText,
    hints.currentModifiedToken,
  );
  const edits = contentEdit
    ? [modifiedEdit, contentEdit].sort((left, right) => left.startOffset - right.startOffset)
    : [modifiedEdit];
  if (edits.length > 2
    || (edits.length === 2 && edits[0].endOffset > edits[1].startOffset)
    || !editsReconstructExactly(currentText, nextText, edits)) {
    return undefined;
  }
  return {
    kind: edits.length === 2 ? 'modified-and-content' : 'single-span',
    edits,
    tokenOffsetSource: 'trusted',
  };
};

const planWithLexicalModifiedTokens = (
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
      return { kind: 'single-span', edits: [modifiedEdit], tokenOffsetSource: 'lexical' };
    }
    const contentEdit = planDocumentTextEdit(virtualCurrent, nextText);
    const edits = [modifiedEdit, contentEdit]
      .sort((left, right) => left.startOffset - right.startOffset);
    if (edits[0].endOffset > edits[1].startOffset
      || applyDocumentTextEdits(currentText, edits) !== nextText) {
      return singleSpanPlan(currentText, nextText);
    }
    return { kind: 'modified-and-content', edits, tokenOffsetSource: 'lexical' };
  } catch {
    return singleSpanPlan(currentText, nextText);
  }
};

/**
 * Splits only the canonical $.meta.modified token from one remaining span.
 * Any lexical ambiguity, offset shift, overlap, or reconstruction mismatch
 * falls back to the general single-span plan.
 */
export const planSdocDocumentTextEdits = (
  currentText: string,
  nextText: string,
  hints?: SdocDocumentTextEditHints,
): SdocDocumentTextEditPlan => {
  if (hints) {
    const trustedPlan = planWithTrustedModifiedTokens(currentText, nextText, hints);
    if (trustedPlan) return trustedPlan;
  }
  return planWithLexicalModifiedTokens(currentText, nextText);
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
