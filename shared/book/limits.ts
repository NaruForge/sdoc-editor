import {
  MAX_AGGREGATE_ASSET_BYTES,
  MAX_DOCUMENT_BYTES,
  RESOURCE_LOAD_CONCURRENCY,
} from '../resourceLimits';

export const BOOK_MANIFEST_MAX_BYTES = 1024 * 1024;
export const BOOK_MAX_DOCUMENTS = 1024;
export const BOOK_MAX_DIAGNOSTICS = 256;
export const BOOK_MAX_PATH_LENGTH = 1_024;
export const BOOK_MAX_DIAGNOSTIC_TEXT_LENGTH = 2_000;
export const BOOK_CHAPTER_MAX_BYTES = MAX_DOCUMENT_BYTES;
export const BOOK_AGGREGATE_MAX_BYTES = MAX_AGGREGATE_ASSET_BYTES;
export const BOOK_LOAD_CONCURRENCY = RESOURCE_LOAD_CONCURRENCY;

export const measureBookUtf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;
