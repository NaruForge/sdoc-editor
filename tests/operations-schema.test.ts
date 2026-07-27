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
  'update-block-attrs.json',
] as const;

const parseJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

describe('public operation contract', () => {
  it('validates all nine published examples against draft-07 schemas', async () => {
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
});

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return errors?.map((error) => `${error.instancePath} ${error.message ?? ''}`.trim()).join('; ')
    ?? 'unknown validation error';
}
