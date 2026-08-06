import type { ErrorObject } from 'ajv';
import type { DocumentSettings, SdocEnvelope, SdocMeta, TiptapNode } from '../types';
import { migrateAttributes } from './migrations';
import {
  validateDoc,
  validateEnvelope,
  validateSettingsSchema,
} from './generated/documentValidators.js';
import { MAX_DOCUMENT_BYTES } from '../resourceLimits';

export interface ContractDiagnostic {
  path: string;
  message: string;
}

export type DocumentContractResult =
  | { ok: true; envelope: SdocEnvelope; legacy: boolean }
  | { ok: false; kind: 'malformed' | 'unsupported-version'; diagnostics: ContractDiagnostic[] };

export type DocumentTextContractResult =
  | { ok: true; envelope: SdocEnvelope; legacy: boolean; uninitialized: boolean }
  | {
      ok: false;
      kind: 'invalid-json' | 'malformed' | 'unsupported-version' | 'too-large';
      diagnostics: ContractDiagnostic[];
    };

const MAX_CONTRACT_DIAGNOSTICS = 100;
const MAX_DIAGNOSTIC_PATH_LENGTH = 1_000;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 2_000;

const contractDiagnostic = (path: string, message: string): ContractDiagnostic => ({
  path: (path || '/').slice(0, MAX_DIAGNOSTIC_PATH_LENGTH),
  message: (message || 'invalid value').slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
});

const diagnostics = (errors: ErrorObject[] | null | undefined): ContractDiagnostic[] =>
  (errors ?? [])
    .slice(0, MAX_CONTRACT_DIAGNOSTICS)
    .map((error) => contractDiagnostic(
      error.instancePath || '/',
      error.message ?? 'invalid value',
    ));

const malformedDiagnostics = (errors: ErrorObject[] | null | undefined): ContractDiagnostic[] => {
  const result = diagnostics(errors);
  return result.length > 0
    ? result
    : [contractDiagnostic('/', 'document does not match the Structured Doc contract')];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_DOCUMENT_TREE_DEPTH = 128;
const MAX_DOCUMENT_TREE_NODES = 100_000;

type NodeInspection = 'valid' | 'invalid' | 'too-complex';

const inspectTiptapNode = (value: unknown): NodeInspection => {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodeCount = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_DOCUMENT_TREE_DEPTH || ++nodeCount > MAX_DOCUMENT_TREE_NODES) {
      return 'too-complex';
    }
    if (!isRecord(current.value) || typeof current.value.type !== 'string') return 'invalid';
    if (current.value.attrs !== undefined && !isRecord(current.value.attrs)) return 'invalid';
    if (current.value.text !== undefined && typeof current.value.text !== 'string') return 'invalid';
    if (current.value.content !== undefined) {
      if (!Array.isArray(current.value.content)) return 'invalid';
      for (let index = current.value.content.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value.content[index], depth: current.depth + 1 });
      }
    }
  }
  return 'valid';
};

const isInspectedTiptapNode = (
  value: unknown,
  inspection: NodeInspection,
): value is TiptapNode => inspection === 'valid' && isRecord(value);

const complexityFailure = (): DocumentContractResult => ({
  ok: false,
  kind: 'malformed',
  diagnostics: [contractDiagnostic(
    '/doc',
    `document tree exceeds ${MAX_DOCUMENT_TREE_DEPTH} levels or ${MAX_DOCUMENT_TREE_NODES} nodes`,
  )],
});

export function validateDocumentSettings(value: unknown): value is Partial<DocumentSettings> {
  return validateSettingsSchema(value);
}

export function readDocumentSettings(value: unknown): Partial<DocumentSettings> | undefined {
  if (!isRecord(value) || !isRecord(value.meta)) return undefined;
  return validateDocumentSettings(value.meta.settings) ? value.meta.settings : undefined;
}

export function parseDocumentContract(value: unknown): DocumentContractResult {
  if (isRecord(value) && typeof value.sdoc === 'string' && value.sdoc !== '1.0') {
    return {
      ok: false,
      kind: 'unsupported-version',
      diagnostics: [contractDiagnostic('/sdoc', 'unsupported document version')],
    };
  }

  const envelopeDocInspection = isRecord(value) && value.doc !== undefined
    ? inspectTiptapNode(value.doc)
    : 'invalid';
  if (envelopeDocInspection === 'too-complex') return complexityFailure();

  if (isRecord(value) && value.sdoc === '1.0'
    && isInspectedTiptapNode(value.doc, envelopeDocInspection)) {
    const migrated: unknown = {
      ...value,
      meta: value.meta === undefined ? {} : value.meta,
      doc: migrateAttributes(value.doc),
    };
    if (validateEnvelope(migrated)) return { ok: true, envelope: migrated, legacy: false };
    return {
      ok: false,
      kind: 'malformed',
      diagnostics: malformedDiagnostics(validateEnvelope.errors),
    };
  }

  const legacyInspection = inspectTiptapNode(value);
  if (legacyInspection === 'too-complex') return complexityFailure();
  if (isInspectedTiptapNode(value, legacyInspection)) {
    const migrated = migrateAttributes(value);
    if (!validateDoc(migrated)) {
      return { ok: false, kind: 'malformed', diagnostics: malformedDiagnostics(validateDoc.errors) };
    }
    const now = new Date().toISOString();
    return {
      ok: true,
      legacy: true,
      envelope: {
        sdoc: '1.0',
        meta: { title: '', author: '', version: '0.1', created: now, modified: now },
        doc: migrated,
      },
    };
  }

  validateEnvelope(value);
  return { ok: false, kind: 'malformed', diagnostics: malformedDiagnostics(validateEnvelope.errors) };
}

export function parseDocumentTextContract(
  text: string,
  options: { maximumBytes?: number } = {},
): DocumentTextContractResult {
  const maximumBytes = options.maximumBytes ?? MAX_DOCUMENT_BYTES;
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maximumBytes) {
    return {
      ok: false,
      kind: 'too-large',
      diagnostics: [contractDiagnostic('/', `document exceeds ${maximumBytes} bytes`)],
    };
  }
  if (!text.trim()) {
    return {
      ok: true,
      legacy: false,
      uninitialized: true,
      envelope: { sdoc: '1.0', meta: {}, doc: { type: 'doc', content: [] } },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      ok: false,
      kind: 'invalid-json',
      diagnostics: [contractDiagnostic(
        '/',
        error instanceof Error ? error.message : 'invalid JSON',
      )],
    };
  }
  const contract = parseDocumentContract(parsed);
  return contract.ok
    ? { ...contract, uninitialized: false }
    : contract;
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
