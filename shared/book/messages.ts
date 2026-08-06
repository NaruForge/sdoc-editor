export interface BookMutationRequest {
  requestId: string;
  baseRevision: number;
}

export type BookWebviewMessage =
  | { type: 'openDocument'; index: number }
  | ({ type: 'addDocument' } & BookMutationRequest)
  | ({ type: 'removeDocument'; index: number } & BookMutationRequest)
  | ({ type: 'moveDocument'; from: number; to: number } & BookMutationRequest)
  | ({ type: 'updateMeta'; key: 'title' | 'author' | 'version'; value: string } & BookMutationRequest)
  | { type: 'exportProject'; format: 'html' | 'pdf' }
  | { type: 'refreshBook' };

export type BookMutationErrorCode =
  | 'stale-revision'
  | 'invalid-manifest'
  | 'invalid-request'
  | 'limit-exceeded'
  | 'apply-failed'
  | 'operation-failed';

export type BookMutationResult =
  | { type: 'bookMutationResult'; requestId: string; status: 'applied' | 'cancelled'; revision: number }
  | {
    type: 'bookMutationResult';
    requestId: string;
    status: 'rejected';
    revision: number;
    error: { code: BookMutationErrorCode; message: string };
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIndex = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
const isMutationRequest = (value: Record<string, unknown>): boolean =>
  typeof value.requestId === 'string'
  && value.requestId.length > 0
  && isIndex(value.baseRevision);

export function isBookWebviewMessage(value: unknown): value is BookWebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'openDocument':
      return isIndex(value.index);
    case 'removeDocument':
      return isIndex(value.index) && isMutationRequest(value);
    case 'moveDocument':
      return isIndex(value.from) && isIndex(value.to) && isMutationRequest(value);
    case 'updateMeta':
      return ['title', 'author', 'version'].includes(String(value.key))
        && typeof value.value === 'string'
        && isMutationRequest(value);
    case 'exportProject':
      return value.format === 'html' || value.format === 'pdf';
    case 'addDocument':
      return isMutationRequest(value);
    case 'refreshBook':
      return true;
    default:
      return false;
  }
}

export function isBookMutationResult(value: unknown): value is BookMutationResult {
  if (!isRecord(value)
    || value.type !== 'bookMutationResult'
    || typeof value.requestId !== 'string'
    || value.requestId.length === 0
    || !isIndex(value.revision)) return false;
  if (value.status === 'applied' || value.status === 'cancelled') return true;
  if (value.status !== 'rejected' || !isRecord(value.error)) return false;
  return [
    'stale-revision',
    'invalid-manifest',
    'invalid-request',
    'limit-exceeded',
    'apply-failed',
    'operation-failed',
  ].includes(String(value.error.code)) && typeof value.error.message === 'string';
}
