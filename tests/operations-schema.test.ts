import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import { describe, expect, it } from 'vitest';

interface JsonSchema {
  $id?: string;
  definitions?: Record<string, JsonSchema>;
  properties?: Record<string, JsonSchema>;
  const?: unknown;
  oneOf?: JsonSchema[];
  $ref?: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exampleDirectory = join(root, 'examples', 'operations');
const exampleNames = [
  'delete-block.json',
  'delete-section.json',
  'insert-block.json',
  'insert-section.json',
  'move-block.json',
  'move-section.json',
  'rename-heading.json',
  'replace-block.json',
  'set-document-title.json',
  'update-block-attrs.json',
  'update-document-metadata.json',
  'update-document-settings.json',
] as const;

const parseJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

describe('public operation contract', () => {
  it('validates all twelve published examples against draft-07 schemas', async () => {
    const documentSchema = await parseJson(join(root, 'sdoc.schema.json')) as JsonSchema;
    const operationSchema = await parseJson(join(root, 'sdoc.operations.schema.json')) as JsonSchema;
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addSchema(documentSchema);
    const validate = ajv.compile(operationSchema);

    for (const name of exampleNames) {
      const example = await parseJson(join(exampleDirectory, name));
      const valid = validate(example);
      expect(valid, `${name}: ${formatErrors(validate.errors)}`).toBe(true);
    }
  });

  it('keeps schema discriminators, examples, and the TypeScript operation union in parity', async () => {
    const schema = await parseJson(join(root, 'sdoc.operations.schema.json')) as JsonSchema;
    const source = await readFile(join(root, 'shared', 'document', 'operations', 'types.ts'), 'utf8');
    const schemaNames = Object.values(schema.definitions ?? {})
      .map((definition) => definition.properties?.op?.const)
      .filter((value): value is string => typeof value === 'string')
      .sort();
    const sourceNames = Array.from(source.matchAll(/\{\s*op:\s*'([^']+)'/g), (match) => match[1]).sort();
    const exampleOperationNames = (await Promise.all(exampleNames.map(async (name) => {
      const example = await parseJson(join(exampleDirectory, name)) as {
        operations?: Array<{ op?: unknown }>;
      };
      return example.operations?.[0]?.op;
    }))).sort();

    expect(schemaNames).toEqual(sourceNames);
    expect(exampleOperationNames).toEqual(sourceNames);
  });

  it('rejects unknown request and operation fields', async () => {
    const documentSchema = await parseJson(join(root, 'sdoc.schema.json')) as JsonSchema;
    const operationSchema = await parseJson(join(root, 'sdoc.operations.schema.json')) as JsonSchema;
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addSchema(documentSchema);
    const validate = ajv.compile(operationSchema);
    const request = await parseJson(join(exampleDirectory, 'rename-heading.json')) as {
      operations: Array<Record<string, unknown>>;
      extra?: boolean;
    };

    request.extra = true;
    request.operations[0].extra = true;
    expect(validate(request)).toBe(false);
  });

  it('uses Unicode code-point limits for title, author, and version', async () => {
    const documentSchema = await parseJson(join(root, 'sdoc.schema.json')) as JsonSchema;
    const operationSchema = await parseJson(join(root, 'sdoc.operations.schema.json')) as JsonSchema;
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addSchema(documentSchema);
    const validate = ajv.compile(operationSchema);
    const revision = `sha256:${'0'.repeat(64)}`;
    const boundary = '😀'.repeat(200);

    for (const operation of [
      { op: 'setDocumentTitle', title: boundary },
      { op: 'updateDocumentMetadata', patch: { author: boundary, version: boundary } },
    ]) {
      expect(validate({
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [operation],
      }), formatErrors(validate.errors)).toBe(true);
    }

    for (const operation of [
      { op: 'setDocumentTitle', title: `${boundary}😀` },
      { op: 'setDocumentTitle', title: ` ${'x'.repeat(200)}` },
      { op: 'updateDocumentMetadata', patch: { author: `${boundary}😀` } },
      { op: 'updateDocumentMetadata', patch: { version: `${boundary}😀` } },
    ]) {
      expect(validate({
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [operation],
      }), formatErrors(validate.errors)).toBe(false);
    }
  });

  it('accepts zero or null for the portable heading start number and rejects invalid numbers', async () => {
    const documentSchema = await parseJson(join(root, 'sdoc.schema.json')) as JsonSchema;
    const operationSchema = await parseJson(join(root, 'sdoc.operations.schema.json')) as JsonSchema;
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addSchema(documentSchema);
    const validate = ajv.compile(operationSchema);
    const revision = `sha256:${'0'.repeat(64)}`;

    for (const headingStartNumber of [0, null]) {
      expect(validate({
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [{ op: 'updateDocumentSettings', patch: { headingStartNumber } }],
      }), formatErrors(validate.errors)).toBe(true);
    }

    for (const headingStartNumber of [-1, 0.5]) {
      expect(validate({
        contract: 'sdoc.operations/1',
        expected: { revision },
        operations: [{ op: 'updateDocumentSettings', patch: { headingStartNumber } }],
      }), formatErrors(validate.errors)).toBe(false);
    }
  });
});

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return errors?.map((error) => `${error.instancePath} ${error.message ?? ''}`.trim()).join('; ')
    ?? 'unknown validation error';
}
