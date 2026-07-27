import type { DocumentMutationErrorCode } from '@shared/persistence/DocumentSyncCoordinator';

const EXTERNAL_CHANGE_ERROR = 'modified outside Structured Doc Editor';

export function classifyTauriSaveError(message: string): DocumentMutationErrorCode {
  return message.includes(EXTERNAL_CHANGE_ERROR) ? 'EXTERNAL_CHANGE' : 'WRITE_FAILED';
}
