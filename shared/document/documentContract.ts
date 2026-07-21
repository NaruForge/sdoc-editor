import Ajv, { type ErrorObject } from 'ajv';
import schema from '../../sdoc.schema.json';
import type { DocumentSettings, SdocEnvelope, SdocMeta, TiptapNode } from '../types';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateEnvelope = ajv.compile<SdocEnvelope>(schema);
const validateDoc = ajv.compile<TiptapNode>({ $ref: `${schema.$id}#/definitions/docNode` });
const validateSettingsSchema = ajv.compile<Partial<DocumentSettings>>({
  $ref: `${schema.$id}#/definitions/documentSettings`,
});

export interface ContractDiagnostic {
  path: string;
  message: string;
}

export type DocumentContractResult =
  | { ok: true; envelope: SdocEnvelope; legacy: boolean }
  | { ok: false; kind: 'malformed' | 'unsupported-version'; diagnostics: ContractDiagnostic[] };

const diagnostics = (errors: ErrorObject[] | null | undefined): ContractDiagnostic[] =>
  (errors ?? []).map((error) => ({
    path: error.instancePath || '/',
    message: error.message ?? 'invalid value',
  }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateDocumentSettings(value: unknown): value is Partial<DocumentSettings> {
  return validateSettingsSchema(value);
}

export function parseDocumentContract(value: unknown): DocumentContractResult {
  if (isRecord(value) && typeof value.sdoc === 'string' && value.sdoc !== '1.0') {
    return {
      ok: false,
      kind: 'unsupported-version',
      diagnostics: [{ path: '/sdoc', message: `unsupported document version ${value.sdoc}` }],
    };
  }

  if (validateEnvelope(value)) {
    return { ok: true, envelope: value, legacy: false };
  }

  if (validateDoc(value)) {
    const now = new Date().toISOString();
    return {
      ok: true,
      legacy: true,
      envelope: {
        sdoc: '1.0',
        meta: { title: '', author: '', version: '0.1', created: now, modified: now },
        doc: value,
      },
    };
  }

  return { ok: false, kind: 'malformed', diagnostics: diagnostics(validateEnvelope.errors) };
}

export function assertPersistedDocument(value: unknown): asserts value is SdocEnvelope {
  if (!validateEnvelope(value)) {
    const detail = diagnostics(validateEnvelope.errors)
      .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
      .join('; ');
    throw new Error(`Document violates sdoc.schema.json: ${detail}`);
  }
}

export function preserveMeta(value: unknown): SdocMeta {
  if (!isRecord(value)) return {};
  const meta: SdocMeta = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'title' || key === 'author' || key === 'version'
      || key === 'created' || key === 'modified') {
      if (typeof entry === 'string') meta[key] = entry;
    } else if (key === 'settings') {
      if (validateDocumentSettings(entry)) meta.settings = entry;
    } else {
      meta[key] = entry;
    }
  }
  return meta;
}
