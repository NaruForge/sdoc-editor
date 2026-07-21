import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(resolve(root, 'sdoc.schema.json'), 'utf8'));
const outputPath = resolve(root, 'shared/document/generated/documentValidators.js');
const declarationPath = resolve(root, 'shared/document/generated/documentValidators.d.ts');

const ajv = new Ajv({ allErrors: true, strict: false, code: { source: true, esm: true } });
addFormats(ajv);
ajv.addSchema(schema);

const generated = `${standaloneCode(ajv, {
  validateEnvelope: schema.$id,
  validateDoc: `${schema.$id}#/definitions/docNode`,
  validateSettingsSchema: `${schema.$id}#/definitions/documentSettings`,
})}\n`;
const declaration = `import type { ErrorObject } from 'ajv';\nimport type { DocumentSettings, SdocEnvelope, TiptapNode } from '../../types';\n\ninterface DocumentValidator<T> {\n  (value: unknown): value is T;\n  errors?: ErrorObject[] | null;\n}\n\nexport const validateEnvelope: DocumentValidator<SdocEnvelope>;\nexport const validateDoc: DocumentValidator<TiptapNode>;\nexport const validateSettingsSchema: DocumentValidator<Partial<DocumentSettings>>;\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  const currentDeclaration = readFileSync(declarationPath, 'utf8');
  if (current !== generated || currentDeclaration !== declaration) {
    console.error('Generated document validators are stale. Run npm run validators:generate.');
    process.exit(1);
  }
  console.log('Generated document validators are current.');
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated);
  writeFileSync(declarationPath, declaration);
  console.log('Generated CSP-safe document validators.');
}
