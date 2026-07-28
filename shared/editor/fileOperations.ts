export type FileOperationKind = 'export' | 'import';

export interface FileOperationError {
  code: string;
  message: string;
  retryable: boolean;
}

export type FileOperationState =
  | { phase: 'idle' }
  | {
    phase: 'running';
    requestId: string;
    kind: FileOperationKind;
    format: string;
    stage: string;
  }
  | {
    phase: 'succeeded';
    requestId: string;
    result: 'completed' | 'fallback';
  }
  | {
    phase: 'failed';
    requestId: string;
    error: FileOperationError;
  }
  | {
    phase: 'cancelled';
    requestId: string;
  };

export const FILE_OPERATION_IDLE_STATE: FileOperationState = { phase: 'idle' };

export interface FileOperationControllerState {
  sessionId: string;
  operationState: FileOperationState;
}

export type FileOperationEvent =
  | {
    type: 'start';
    sessionId: string;
    requestId: string;
    kind: FileOperationKind;
    format: string;
    stage: string;
  }
  | {
    type: 'progress';
    sessionId: string;
    requestId: string;
    stage: string;
  }
  | {
    type: 'succeeded';
    sessionId: string;
    requestId: string;
    result: 'completed' | 'fallback';
  }
  | {
    type: 'failed';
    sessionId: string;
    requestId: string;
    error: FileOperationError;
  }
  | {
    type: 'cancelled';
    sessionId: string;
    requestId: string;
  }
  | {
    type: 'session-changed';
    sessionId: string;
  }
  | {
    type: 'reset';
    sessionId: string;
  };

export interface FileOperationStart {
  sessionId: string;
  requestId: string;
  kind: FileOperationKind;
  format: string;
  stage: string;
}

export type FileOperationStartResult =
  | { accepted: true; state: FileOperationControllerState }
  | { accepted: false; state: FileOperationControllerState };

const MAX_ERROR_CODE_LENGTH = 80;
const MAX_ERROR_MESSAGE_LENGTH = 500;

function sanitizeDisplayText(value: string, fallback: string, maxLength: number): string {
  const sanitized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (sanitized || fallback).slice(0, maxLength);
}

function redactHostPaths(value: string): string {
  return value
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n]*/g, '[path]')
    .replace(
      /(^|[\s(])\/(?:Users|home|tmp|var|etc|mnt|opt|private)\/[^\s,;)]+/gi,
      '$1[path]',
    );
}

/**
 * Creates the UI-safe error carried by operation state. Callers should pass a
 * user-facing message, never a raw exception, filesystem path, or host log.
 */
export function createFileOperationError(
  code: string,
  message: string,
  retryable = false,
): FileOperationError {
  return {
    code: sanitizeDisplayText(code, 'UNKNOWN', MAX_ERROR_CODE_LENGTH),
    message: sanitizeDisplayText(
      redactHostPaths(message),
      'The file operation could not be completed.',
      MAX_ERROR_MESSAGE_LENGTH,
    ),
    retryable,
  };
}

export function createFileOperationControllerState(
  sessionId: string,
): FileOperationControllerState {
  return {
    sessionId,
    operationState: FILE_OPERATION_IDLE_STATE,
  };
}

export function isFileOperationRunning(state: FileOperationState): boolean {
  return state.phase === 'running';
}

function matchesRunningRequest(
  state: FileOperationControllerState,
  event: { sessionId: string; requestId: string },
): state is FileOperationControllerState & {
  operationState: Extract<FileOperationState, { phase: 'running' }>;
} {
  return state.sessionId === event.sessionId
    && state.operationState.phase === 'running'
    && state.operationState.requestId === event.requestId;
}

/**
 * Attempts to begin an operation without dispatching it. Hosts should invoke
 * their callback only when `accepted` is true.
 */
export function tryStartFileOperation(
  state: FileOperationControllerState,
  request: FileOperationStart,
): FileOperationStartResult {
  if (state.sessionId !== request.sessionId || isFileOperationRunning(state.operationState)) {
    return { accepted: false, state };
  }
  return {
    accepted: true,
    state: {
      ...state,
      operationState: {
        phase: 'running',
        requestId: request.requestId,
        kind: request.kind,
        format: request.format,
        stage: request.stage,
      },
    },
  };
}

/**
 * Pure request-correlated reducer. Results from an older request or document
 * session are returned unchanged, so they cannot overwrite current UI state.
 */
export function fileOperationReducer(
  state: FileOperationControllerState,
  event: FileOperationEvent,
): FileOperationControllerState {
  if (event.type === 'session-changed') {
    if (event.sessionId === state.sessionId) return state;
    return createFileOperationControllerState(event.sessionId);
  }
  if (event.type === 'reset') {
    if (event.sessionId !== state.sessionId) return state;
    return { ...state, operationState: FILE_OPERATION_IDLE_STATE };
  }
  if (event.type === 'start') {
    return tryStartFileOperation(state, event).state;
  }
  if (!matchesRunningRequest(state, event)) return state;

  if (event.type === 'progress') {
    return {
      ...state,
      operationState: { ...state.operationState, stage: event.stage },
    };
  }
  if (event.type === 'succeeded') {
    return {
      ...state,
      operationState: {
        phase: 'succeeded',
        requestId: event.requestId,
        result: event.result,
      },
    };
  }
  if (event.type === 'failed') {
    return {
      ...state,
      operationState: {
        phase: 'failed',
        requestId: event.requestId,
        error: event.error,
      },
    };
  }
  return {
    ...state,
    operationState: {
      phase: 'cancelled',
      requestId: event.requestId,
    },
  };
}
