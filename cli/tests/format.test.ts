import { describe, expect, it } from 'vitest';
import { detectJsonFormat, encodeJson } from '../src/format.js';

describe('JSON formatting preservation', () => {
  it('preserves BOM, CRLF, indentation, and final newline', () => {
    const source = Buffer.from('\uFEFF{\r\n    "a": 1\r\n}\r\n', 'utf8');
    const encoded = encodeJson({ a: 2 }, detectJsonFormat(source));
    expect(Buffer.from(encoded).toString('utf8')).toBe('\uFEFF{\r\n    "a": 2\r\n}\r\n');
  });

  it('keeps compact JSON compact', () => {
    const source = Buffer.from('{"a":1}', 'utf8');
    expect(Buffer.from(encodeJson({ a: 2 }, detectJsonFormat(source))).toString('utf8')).toBe('{"a":2}');
  });
});
