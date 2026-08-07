import { computeRevision, decodeUtf8, encodeUtf8 } from './sha256';
import type { ReadProjection, Sha256Digest } from './types';

export const MAX_READ_CURSOR_LENGTH = 4_096;

export interface ReadCursorPayload {
  version: 1;
  revision: Sha256Digest;
  projection: ReadProjection;
  scope: string;
  query: Sha256Digest;
  next: number;
}

const BASE64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SHA256 = /^sha256:[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function encodeBase64Url(bytes: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset];
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    result += BASE64_URL[first >> 2];
    result += BASE64_URL[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      result += BASE64_URL[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) result += BASE64_URL[third & 0x3f];
  }
  return result;
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    const digit = BASE64_URL.indexOf(character);
    if (digit < 0) return undefined;
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && accumulator !== 0) return undefined;
  const decoded = new Uint8Array(bytes);
  return encodeBase64Url(decoded) === value ? decoded : undefined;
}

/** The checksum detects accidental or hostile corruption; it is not authentication. */
export function encodeReadCursor(payload: ReadCursorPayload): string {
  const encoded = encodeBase64Url(encodeUtf8(JSON.stringify(payload)));
  return `${encoded}.${computeRevision(encoded).slice('sha256:'.length)}`;
}

export function decodeReadCursor(value: string): ReadCursorPayload | undefined {
  if (value.length > MAX_READ_CURSOR_LENGTH) return undefined;
  const parts = value.split('.');
  if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[1])) return undefined;
  if (computeRevision(parts[0]).slice('sha256:'.length) !== parts[1]) return undefined;
  const bytes = decodeBase64Url(parts[0]);
  if (!bytes) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)
    || Object.keys(parsed).length !== 6
    || !['version', 'revision', 'projection', 'scope', 'query', 'next']
      .every((key) => Object.prototype.hasOwnProperty.call(parsed, key))
    || parsed.version !== 1
    || typeof parsed.revision !== 'string' || !SHA256.test(parsed.revision)
    || (parsed.projection !== 'catalog' && parsed.projection !== 'target'
      && parsed.projection !== 'section' && parsed.projection !== 'document')
    || typeof parsed.scope !== 'string' || parsed.scope.length > 1_024
    || typeof parsed.query !== 'string' || !SHA256.test(parsed.query)
    || !Number.isSafeInteger(parsed.next) || Number(parsed.next) < 0) {
    return undefined;
  }
  return parsed as unknown as ReadCursorPayload;
}
