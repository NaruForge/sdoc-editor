import type { DocumentSettingKey, DocumentSettingSource } from '../types';

export type FileOperationKind = 'export' | 'import';

export type FileExportFormat = 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides';
export type FileImportFormat = 'html' | 'markdown';
export type FileOperationFormat = FileExportFormat | FileImportFormat;
export type FileOperationPhase =
  | 'idle'
  | 'preflighting'
  | 'awaiting-confirmation'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** Opaque, session-scoped identifiers. Consumers must not parse these values. */
export type FileOperationRequestId = string;
export type FileOperationPlanId = string;
export type FileOperationArtifactId = string;

export type FileOperationIntent =
  | { kind: 'export'; format: FileExportFormat }
  | { kind: 'import'; format: FileImportFormat };

export interface FileOperationPlanSourceView {
  displayName: string;
  sizeBytes: number;
  /** Current document revision when the source is an open editor buffer. */
  revision?: number;
}

export interface FileOperationPlanDestinationView {
  displayName: string;
  exists: boolean;
  /** Host-verified portable scope; never inferred from displayName in the webview. */
  scope?: 'document' | 'workspace' | 'book';
  /** Portable path relative to the verified scope root. */
  relativePath?: string;
}

export type SettingsValueSource = DocumentSettingSource;

export interface FileOperationEffectiveSettingsView {
  fingerprint: string;
  items: readonly {
    key: DocumentSettingKey;
    value: string;
    source: SettingsValueSource;
  }[];
}

export interface FileOperationDiagramView {
  failurePolicy: 'fail' | 'source-fallback';
  fallbackCount: number;
}

export interface FileOperationOutlineItemView {
  level: number;
  title: string;
}

export interface FileOperationImportPreview {
  outline: readonly FileOperationOutlineItemView[];
  topLevelBlockCount: number;
  replacement: 'body-only';
  preserved: readonly ['metadata', 'settings'];
}

/**
 * A deliberately limited, path-free view of a host-owned immutable plan.
 * `planId` is the only capability the editor sends back for execution.
 */
export interface FileOperationPlanView {
  planId: FileOperationPlanId;
  intent: FileOperationIntent;
  source: FileOperationPlanSourceView;
  destination?: FileOperationPlanDestinationView;
  importPreview?: FileOperationImportPreview;
  effectiveSettings?: FileOperationEffectiveSettingsView;
  diagram?: FileOperationDiagramView;
  warnings: readonly string[];
  requiresConfirmation: boolean;
}

export interface FileOperationArtifactView {
  artifactId: FileOperationArtifactId;
  displayName: string;
  sizeBytes: number;
}

export type FileOperationResultAction = 'open' | 'reveal' | 'copy' | 'repeat' | 'undo';

export type FileOperationResultActionView =
  | { action: 'repeat' }
  | {
    action: Exclude<FileOperationResultAction, 'repeat'>;
    artifactId: FileOperationArtifactId;
  };

export interface FileOperationResult {
  outcome: 'completed' | 'fallback';
  artifact?: FileOperationArtifactView;
  warnings: readonly string[];
  availableActions: readonly FileOperationResultActionView[];
}

export interface FileOperationError {
  code: string;
  message: string;
  retryable: boolean;
}

export type FileOperationState =
  | { phase: 'idle' }
  | {
    phase: 'preflighting';
    requestId: FileOperationRequestId;
    intent: FileOperationIntent;
    stage: string;
  }
  | {
    phase: 'awaiting-confirmation';
    requestId: FileOperationRequestId;
    intent: FileOperationIntent;
    plan: FileOperationPlanView;
  }
  | {
    phase: 'running';
    requestId: FileOperationRequestId;
    kind: FileOperationKind;
    format: string;
    stage: string;
    /** Present for preflight-based operations; omitted by the legacy direct-start flow. */
    intent?: FileOperationIntent;
    planId?: FileOperationPlanId;
  }
  | {
    phase: 'succeeded';
    requestId: FileOperationRequestId;
    result: 'completed' | 'fallback';
    intent?: FileOperationIntent;
    details?: FileOperationResult;
  }
  | {
    phase: 'failed';
    requestId: FileOperationRequestId;
    error: FileOperationError;
    intent?: FileOperationIntent;
  }
  | {
    phase: 'cancelled';
    requestId: FileOperationRequestId;
    intent?: FileOperationIntent;
  };

export const FILE_OPERATION_IDLE_STATE: FileOperationState = { phase: 'idle' };

export interface FileOperationControllerState {
  sessionId: string;
  operationState: FileOperationState;
}

interface FileOperationEventIdentity {
  sessionId: string;
  requestId: FileOperationRequestId;
}

export type FileOperationEvent =
  | (FileOperationEventIdentity & {
    type: 'prepare';
    intent: FileOperationIntent;
    stage: string;
  })
  | (FileOperationEventIdentity & {
    type: 'preflight';
    plan: FileOperationPlanView;
  })
  | (FileOperationEventIdentity & {
    type: 'execute';
    planId: FileOperationPlanId;
    stage: string;
  })
  | (FileOperationEventIdentity & {
    type: 'cancel';
  })
  | (FileOperationEventIdentity & {
    type: 'retry';
    previousRequestId: FileOperationRequestId;
    stage: string;
  })
  | (FileOperationEventIdentity & {
    type: 'start';
    kind: FileOperationKind;
    format: string;
    stage: string;
  })
  | (FileOperationEventIdentity & {
    type: 'progress';
    stage: string;
  })
  | (FileOperationEventIdentity & {
    type: 'succeeded';
    result: 'completed' | 'fallback';
    details?: FileOperationResult;
  })
  | (FileOperationEventIdentity & {
    type: 'failed';
    error: FileOperationError;
  })
  | (FileOperationEventIdentity & {
    type: 'result-action-failed';
    error: FileOperationError;
  })
  | (FileOperationEventIdentity & {
    type: 'cancelled';
  })
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

export function isFileOperationActive(state: FileOperationState): boolean {
  return state.phase === 'preflighting'
    || state.phase === 'awaiting-confirmation'
    || state.phase === 'running';
}

function getIntent(state: FileOperationState): FileOperationIntent | undefined {
  return state.phase === 'idle' ? undefined : state.intent;
}

function hasMatchingRequest(
  state: FileOperationControllerState,
  event: FileOperationEventIdentity,
): boolean {
  return state.sessionId === event.sessionId
    && state.operationState.phase !== 'idle'
    && state.operationState.requestId === event.requestId;
}

function withIntent<T extends object>(
  value: T,
  intent: FileOperationIntent | undefined,
): T & { intent?: FileOperationIntent } {
  return intent === undefined ? value : { ...value, intent };
}

function intentsEqual(left: FileOperationIntent, right: FileOperationIntent): boolean {
  return left.kind === right.kind && left.format === right.format;
}

/**
 * Attempts to begin the legacy direct-start flow without dispatching it. New
 * consumers should dispatch `prepare`; this wrapper remains for compatibility.
 */
export function tryStartFileOperation(
  state: FileOperationControllerState,
  request: FileOperationStart,
): FileOperationStartResult {
  if (state.sessionId !== request.sessionId || isFileOperationActive(state.operationState)) {
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
 * Pure session/request/plan-correlated reducer. Stale host results and stale
 * plan capabilities are ignored, and retry derives its intent from the prior
 * terminal state instead of accepting a replacement from the caller.
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
  if (event.type === 'prepare') {
    if (state.sessionId !== event.sessionId || isFileOperationActive(state.operationState)) {
      return state;
    }
    return {
      ...state,
      operationState: {
        phase: 'preflighting',
        requestId: event.requestId,
        intent: event.intent,
        stage: event.stage,
      },
    };
  }
  if (event.type === 'retry') {
    const intent = getIntent(state.operationState);
    if (state.sessionId !== event.sessionId
      || (state.operationState.phase !== 'failed' && state.operationState.phase !== 'cancelled')
      || state.operationState.requestId !== event.previousRequestId
      || intent === undefined) {
      return state;
    }
    return {
      ...state,
      operationState: {
        phase: 'preflighting',
        requestId: event.requestId,
        intent,
        stage: event.stage,
      },
    };
  }
  if (!hasMatchingRequest(state, event)) return state;

  if (event.type === 'result-action-failed') {
    if (state.operationState.phase !== 'succeeded' || !state.operationState.details) return state;
    const warnings = state.operationState.details.warnings.includes(event.error.message)
      ? state.operationState.details.warnings
      : [...state.operationState.details.warnings, event.error.message];
    return {
      ...state,
      operationState: {
        ...state.operationState,
        details: { ...state.operationState.details, warnings },
      },
    };
  }

  if (event.type === 'preflight') {
    if (state.operationState.phase !== 'preflighting'
      || !intentsEqual(state.operationState.intent, event.plan.intent)) return state;
    return {
      ...state,
      operationState: {
        phase: 'awaiting-confirmation',
        requestId: event.requestId,
        intent: state.operationState.intent,
        plan: event.plan,
      },
    };
  }
  if (event.type === 'execute') {
    if (state.operationState.phase !== 'awaiting-confirmation'
      || state.operationState.plan.planId !== event.planId) return state;
    return {
      ...state,
      operationState: {
        phase: 'running',
        requestId: event.requestId,
        kind: state.operationState.intent.kind,
        format: state.operationState.intent.format,
        intent: state.operationState.intent,
        planId: event.planId,
        stage: event.stage,
      },
    };
  }
  if (event.type === 'progress') {
    if (state.operationState.phase !== 'running') return state;
    return {
      ...state,
      operationState: { ...state.operationState, stage: event.stage },
    };
  }
  if (event.type === 'cancel' || event.type === 'cancelled') {
    if (!isFileOperationActive(state.operationState)) return state;
    return {
      ...state,
      operationState: withIntent({
        phase: 'cancelled' as const,
        requestId: event.requestId,
      }, getIntent(state.operationState)),
    };
  }
  if (event.type === 'succeeded') {
    if (!isFileOperationActive(state.operationState)
      || (event.details !== undefined && event.details.outcome !== event.result)) return state;
    const operationState = withIntent({
      phase: 'succeeded' as const,
      requestId: event.requestId,
      result: event.result,
      ...(event.details === undefined ? {} : { details: event.details }),
    }, getIntent(state.operationState));
    return { ...state, operationState };
  }
  if (event.type === 'failed') {
    if (!isFileOperationActive(state.operationState)) return state;
    return {
      ...state,
      operationState: withIntent({
        phase: 'failed' as const,
        requestId: event.requestId,
        error: event.error,
      }, getIntent(state.operationState)),
    };
  }
  return state;
}
