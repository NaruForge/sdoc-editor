import * as operationsCore from '../../shared/document/operations/index.js';

export interface Diagnostic {
  code: string;
  message: string;
  path?: string | Array<string | number>;
}

export type FailureCategory = 'argument' | 'document' | 'conflict';

export interface CoreFailure {
  ok: false;
  category: FailureCategory;
  diagnostics: Diagnostic[];
}

export interface CoreSuccess {
  ok: true;
  [key: string]: unknown;
}

export type CoreResult = CoreSuccess | CoreFailure;

interface CoreApi {
  computeRevision(bytes: Uint8Array | string): `sha256:${string}`;
  inspectDocumentBytes(bytes: Uint8Array, options?: Record<string, unknown>): CoreResult;
  validateDocumentBytes(bytes: Uint8Array, options?: Record<string, unknown>): CoreResult;
  applyOperationRequest(
    bytes: Uint8Array,
    request: unknown,
    options?: Record<string, unknown>,
  ): CoreResult;
}

const core = operationsCore as unknown as CoreApi;

export function inspect(bytes: Uint8Array, targetId?: string): CoreResult {
  return core.inspectDocumentBytes(bytes, targetId ? { target: { kind: 'id', id: targetId } } : undefined);
}

export function validate(bytes: Uint8Array): CoreResult {
  return core.validateDocumentBytes(bytes);
}

export function apply(
  bytes: Uint8Array,
  request: unknown,
  options: { upgradeLegacy: boolean; clock: () => string; currentDocumentId?: string },
): CoreResult {
  return core.applyOperationRequest(bytes, request, options);
}

export function revisionOf(bytes: Uint8Array): `sha256:${string}` {
  return core.computeRevision(bytes);
}
