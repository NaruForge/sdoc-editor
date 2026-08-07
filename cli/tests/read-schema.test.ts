import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { beforeAll, describe, expect, it } from 'vitest';

let validateReadRequest: ValidateFunction;

beforeAll(async () => {
  const schema = JSON.parse(await readFile(
    resolve(import.meta.dirname, '..', '..', 'sdoc.read.schema.json'),
    'utf8',
  )) as object;
  validateReadRequest = new Ajv({ allErrors: true, strict: true }).compile(schema);
});

describe('sdoc.read/1 request schema', () => {
  it.each([
    {
      contract: 'sdoc.read/1',
      projection: 'catalog',
      kind: 'outline',
      limit: 25,
      cursor: 'opaque',
      maxBytes: 4096,
      maxSummaryLength: 80,
      expectedRevision: `sha256:${'1'.repeat(64)}`,
    },
    {
      contract: 'sdoc.read/1',
      projection: 'target',
      target: { kind: 'id', id: 'intro', expectedType: 'heading' },
      maxBytes: 4096,
      maxNodes: 20,
    },
    {
      contract: 'sdoc.read/1',
      projection: 'section',
      targetPath: [0],
      cursor: 'opaque',
      maxNodes: 100,
    },
    {
      contract: 'sdoc.read/1',
      projection: 'document',
      cursor: 'opaque',
      maxBytes: 8192,
      maxNodes: 100,
    },
  ])('validates a representative request union member', (request) => {
    expect(validateReadRequest(request), JSON.stringify(validateReadRequest.errors, undefined, 2))
      .toBe(true);
  });

  it.each([
    { contract: 'sdoc.read/1', projection: 'catalog', maxNodes: 1 },
    { contract: 'sdoc.read/1', projection: 'target' },
    {
      contract: 'sdoc.read/1',
      projection: 'target',
      target: { kind: 'id', id: 'intro' },
      targetPath: [0],
    },
    { contract: 'sdoc.read/1', projection: 'section', targetPath: [0], limit: 1 },
    { contract: 'sdoc.read/1', projection: 'document', targetPath: [0] },
    { contract: 'sdoc.read/1', projection: 'document', maxBytes: 0 },
    { contract: 'sdoc.read/1', projection: 'catalog', limit: 1.5 },
    {
      contract: 'sdoc.read/1',
      projection: 'target',
      targetPath: Array.from({ length: 129 }, () => 0),
    },
    {
      contract: 'sdoc.read/1',
      projection: 'target',
      targetPath: [Number.MAX_SAFE_INTEGER + 1],
    },
    { contract: 'sdoc.read/1', projection: 'document', unknown: true },
  ])('rejects requests outside the strict union', (request) => {
    expect(validateReadRequest(request)).toBe(false);
  });
});
