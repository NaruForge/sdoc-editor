import { TextDecoder } from 'node:util';

interface JsonInputErrors {
  invalidUtf8(message: string): Error;
  invalidJson(message: string): Error;
}

export function parseJsonInput(
  bytes: Uint8Array,
  label: string,
  errors: JsonInputErrors,
): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw errors.invalidUtf8(`${label} is not valid UTF-8`);
  }

  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw errors.invalidJson(`${label} is not valid JSON`);
  }
}
