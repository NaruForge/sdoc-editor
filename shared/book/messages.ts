export interface BookMutationRequest {
  requestId: string;
  baseRevision: number;
}

interface BookFileOperationIdentity {
  requestId: string;
  sessionId: string;
  documentId: string;
}

interface BookResultActionIdentity {
  actionRequestId: string;
}

export type BookWebviewMessage =
  | { type: 'bookReady' }
  | { type: 'openBookSource' }
  | { type: 'openDocument'; index: number; nodeId?: string }
  | { type: 'openDiagnostic'; index: number }
  | ({ type: 'addDocument' } & BookMutationRequest)
  | ({ type: 'removeDocument'; index: number } & BookMutationRequest)
  | ({ type: 'moveDocument'; from: number; to: number } & BookMutationRequest)
  | ({ type: 'updateMeta'; key: 'title' | 'author' | 'version'; value: string } & BookMutationRequest)
  | ({ type: 'savePublishProfile'; profile: unknown } & BookMutationRequest)
  | ({
    type: 'prepareBookExport';
    format: 'html' | 'pdf';
    settingsFingerprint: string;
  } & BookMutationRequest & Omit<BookFileOperationIdentity, 'requestId'>)
  | ({ type: 'fileOperationExecute'; planId: string } & BookFileOperationIdentity)
  | ({ type: 'fileOperationCancel'; planId?: string } & BookFileOperationIdentity)
  | ({ type: 'fileOperationRetry'; previousRequestId: string } & BookFileOperationIdentity)
  | ({
    type: 'fileOperationResultAction';
    action: 'open' | 'reveal' | 'copy';
    artifactId: string;
  } & BookFileOperationIdentity & BookResultActionIdentity)
  | ({
    type: 'fileOperationResultAction';
    action: 'repeat';
  } & BookFileOperationIdentity & BookResultActionIdentity)
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
const isFileOperationIdentity = (value: Record<string, unknown>): boolean =>
  [value.requestId, value.sessionId, value.documentId].every((item) =>
    typeof item === 'string' && item.length > 0 && item.length <= 512);
const isBoundedFileOperationId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512;

/** Session-local idempotency guard for result actions; oldest IDs are evicted at a fixed bound. */
export class BookResultActionRequestDeduper {
  private readonly handled = new Set<string>();

  constructor(private readonly limit = 512) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Result action dedupe limit must be positive.');
  }

  claim(actionRequestId: string): boolean {
    if (this.handled.has(actionRequestId)) return false;
    while (this.handled.size >= this.limit) {
      const oldest = this.handled.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.handled.delete(oldest);
    }
    this.handled.add(actionRequestId);
    return true;
  }
}

export function isBookWebviewMessage(value: unknown): value is BookWebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'bookReady':
    case 'openBookSource':
      return true;
    case 'openDocument':
      return isIndex(value.index)
        && (value.nodeId === undefined || (typeof value.nodeId === 'string' && value.nodeId.length <= 256));
    case 'openDiagnostic':
      return isIndex(value.index);
    case 'removeDocument':
      return isIndex(value.index) && isMutationRequest(value);
    case 'moveDocument':
      return isIndex(value.from) && isIndex(value.to) && isMutationRequest(value);
    case 'updateMeta':
      return ['title', 'author', 'version'].includes(String(value.key))
        && typeof value.value === 'string'
        && isMutationRequest(value);
    case 'savePublishProfile':
      return isRecord(value.profile) && isMutationRequest(value);
    case 'prepareBookExport':
      return (value.format === 'html' || value.format === 'pdf')
        && typeof value.settingsFingerprint === 'string'
        && /^sha256:[0-9a-f]{64}$/.test(value.settingsFingerprint)
        && isFileOperationIdentity(value)
        && isMutationRequest(value);
    case 'fileOperationExecute':
      return isFileOperationIdentity(value)
        && typeof value.planId === 'string' && value.planId.length > 0;
    case 'fileOperationCancel':
      return isFileOperationIdentity(value)
        && (value.planId === undefined || (typeof value.planId === 'string' && value.planId.length > 0));
    case 'fileOperationRetry':
      return isFileOperationIdentity(value)
        && typeof value.previousRequestId === 'string' && value.previousRequestId.length > 0;
    case 'fileOperationResultAction':
      if (!isFileOperationIdentity(value)
        || !isBoundedFileOperationId(value.actionRequestId)
        || value.actionRequestId === value.requestId) return false;
      if (value.action === 'repeat') return value.artifactId === undefined;
      return ['open', 'reveal', 'copy'].includes(String(value.action))
        && typeof value.artifactId === 'string' && value.artifactId.length > 0;
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
