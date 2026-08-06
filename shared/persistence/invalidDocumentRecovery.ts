export interface InvalidDocumentRecoveryState {
  writeBlocked: boolean;
  hasLoadedValidDocument: boolean;
  sessionId: string;
  documentId: string;
  revision: number;
}

export interface InvalidDocumentRecoveryRequestIdentity {
  sessionId: string;
  documentId: string;
  baseRevision: number;
}

export function canRecoverInvalidDocument(
  state: InvalidDocumentRecoveryState,
  request: InvalidDocumentRecoveryRequestIdentity,
): boolean {
  return state.writeBlocked
    && state.hasLoadedValidDocument
    && request.sessionId === state.sessionId
    && request.documentId === state.documentId
    && request.baseRevision === state.revision;
}
