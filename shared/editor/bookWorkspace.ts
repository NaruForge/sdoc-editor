import {
  type BookCompositionResult,
  type BookDiagnostic,
  type BookDiagnosticSeverity,
  type SdocBook,
  type SdocBookPublishProfileV1,
} from '../book/types';
import { diagnosticsForDocument, hasBookErrors } from '../book/diagnostics';
import { getSdocBookPublishDocumentSettings } from '../book/publishProfile';
import { resolveDocumentSettingsSnapshot } from '../settingsResolver';
import type { ResolvedDocumentSettingsSnapshot, TiptapNode } from '../types';
import type {
  FileOperationArtifactId,
  FileOperationError,
  FileOperationPlanId,
  FileOperationRequestId,
  FileOperationResultAction,
} from './fileOperations';
import {
  fileOperationReducer,
  type FileOperationControllerState,
} from './fileOperations';
import type {
  FileOperationPreflightMessage,
  FileOperationResultActionStatusMessage,
  FileOperationStatusMessage,
} from '../types/messages';
import type { EditorLocale } from './i18n/locale';

export interface BookWorkspaceDocumentView {
  index: number;
  path: string;
  label: string;
  status: 'ok' | 'missing' | 'invalid';
  diagnostics: readonly BookWorkspaceDiagnosticView[];
}

export interface BookWorkspaceOutlineItem {
  documentIndex: number;
  documentPath: string;
  nodeId?: string;
  level: number;
  title: string;
}

export interface BookWorkspaceDiagnosticView {
  index: number;
  severity: BookDiagnosticSeverity;
  code: string;
  message: string;
  documentPath?: string;
  nodeId?: string;
}

export type BookExportBlockedReason = 'publish-profile-required' | 'diagnostics';

interface BookWorkspaceStateBase {
  generation: number;
  revision: number;
  locale: EditorLocale;
  diagnostics: readonly BookWorkspaceDiagnosticView[];
}

export interface BookWorkspaceReadyState extends BookWorkspaceStateBase {
  status: 'ready';
  bookVersion: SdocBook['sdocBook'];
  title: string;
  author: string;
  version: string;
  documents: readonly BookWorkspaceDocumentView[];
  outline: readonly BookWorkspaceOutlineItem[];
  preview: TiptapNode;
  /** Host-read, resource-free CSS scoped to the preview root. */
  previewCustomCss?: string;
  publishProfile?: SdocBookPublishProfileV1;
  settings: ResolvedDocumentSettingsSnapshot;
  canExport: boolean;
  exportBlockedReason?: BookExportBlockedReason;
}

export interface BookWorkspaceInvalidState extends BookWorkspaceStateBase {
  status: 'invalid';
}

export type BookWorkspaceState = BookWorkspaceReadyState | BookWorkspaceInvalidState;

export interface CreateBookWorkspaceReadyStateOptions {
  book: SdocBook;
  composition: BookCompositionResult;
  diagnostics: readonly BookDiagnostic[];
  generation: number;
  revision: number;
  locale: EditorLocale;
  previewCustomCss?: string;
}

export interface CreateBookWorkspaceInvalidStateOptions {
  diagnostics: readonly BookDiagnostic[];
  generation: number;
  revision: number;
  locale: EditorLocale;
}

const textContent = (node: TiptapNode): string => {
  if (node.type === 'text') return node.text ?? '';
  return node.content?.map(textContent).join('') ?? '';
};

/**
 * Restricts Book custom CSS to flat, resource-free rules under the preview
 * root. Unsupported at-rules, nested rules and active resource syntax fail
 * closed so profile CSS cannot style product chrome or initiate requests.
 */
export function scopeBookPreviewCss(input: string): string {
  if (!input.trim()) return '';
  if (/@(?:import|font-face|keyframes|supports|media|layer|scope|container|page)\b/i.test(input)
    || /(?:url|image-set|expression)\s*\(/i.test(input)
    || /(?:javascript\s*:|behavior\s*:|-moz-binding|<\/?style|<script)/i.test(input)) return '';
  const rules: string[] = [];
  let cursor = 0;
  const matcher = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = matcher.exec(input); match; match = matcher.exec(input)) {
    if (input.slice(cursor, match.index).trim()) return '';
    cursor = matcher.lastIndex;
    const declarations = match[2].trim();
    if (!declarations || /[{}]/.test(declarations)) return '';
    const selectors = match[1].split(',').map((selector) => selector.trim()).filter(Boolean);
    if (selectors.length === 0 || selectors.some((selector) => selector.startsWith('@'))) return '';
    const scoped = selectors.map((selector) => {
      const documentSelector = selector.replace(/^(?:(?:html|:root)\s+)?body(?=\s|$)/i, '').trim();
      return documentSelector
        ? `.book-preview-editor ${documentSelector}`
        : '.book-preview-editor';
    });
    rules.push(`${scoped.join(', ')} { ${declarations} }`);
  }
  if (input.slice(cursor).trim()) return '';
  return rules.join('\n');
}

function collectOutline(
  node: TiptapNode,
  documentIndex: number,
  documentPath: string,
  outline: BookWorkspaceOutlineItem[],
): void {
  if (node.type === 'heading') {
    const level = typeof node.attrs?.level === 'number'
      ? Math.min(6, Math.max(1, Math.trunc(node.attrs.level)))
      : 1;
    const title = textContent(node).trim();
    if (title) {
      const nodeId = typeof node.attrs?.id === 'string' && node.attrs.id
        ? node.attrs.id
        : undefined;
      outline.push({ documentIndex, documentPath, level, title, ...(nodeId ? { nodeId } : {}) });
    }
  }
  node.content?.forEach((child) => collectOutline(child, documentIndex, documentPath, outline));
}

const projectDiagnostic = (diagnostic: BookDiagnostic, index: number): BookWorkspaceDiagnosticView => ({
  index,
  severity: diagnostic.severity,
  code: diagnostic.code,
  message: diagnostic.message,
  ...(diagnostic.documentPath ? { documentPath: diagnostic.documentPath } : {}),
  ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
});

export function createBookWorkspaceReadyState(
  options: CreateBookWorkspaceReadyStateOptions,
): BookWorkspaceReadyState {
  const { book, composition, diagnostics, generation, revision, locale } = options;
  const publishSettings = book.sdocBook === '1.1'
    ? getSdocBookPublishDocumentSettings(book.publish)
    : undefined;
  const settings = resolveDocumentSettingsSnapshot({
    context: 'book',
    bookProfileSettings: publishSettings,
    chapterSettings: composition.documents.map((document) => ({
      documentPath: document.path,
      settings: document.meta?.settings,
    })),
  });
  const projectedDiagnostics: BookWorkspaceDiagnosticView[] = [
    ...diagnostics.map(projectDiagnostic),
    ...settings.diagnostics.map((diagnostic, offset) => ({
      index: diagnostics.length + offset,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.documentPath ? { documentPath: diagnostic.documentPath } : {}),
    })),
  ];
  const documents = composition.documents.map((document, index): BookWorkspaceDocumentView => ({
    index,
    path: document.path,
    label: document.label,
    status: document.status,
    diagnostics: diagnosticsForDocument(diagnostics, document.path).map((diagnostic) =>
      projectDiagnostic(diagnostic, diagnostics.indexOf(diagnostic))),
  }));
  const outline: BookWorkspaceOutlineItem[] = [];
  composition.documents.forEach((document, index) => {
    if (document.doc) collectOutline(document.doc, index, document.path, outline);
  });
  const profileRequired = book.sdocBook === '1.0';
  const blockingDiagnostics = hasBookErrors(diagnostics);

  return {
    status: 'ready',
    generation,
    revision,
    locale,
    bookVersion: book.sdocBook,
    title: book.title ?? '',
    author: book.author ?? '',
    version: book.version ?? '',
    documents,
    outline,
    preview: composition.doc,
    ...(options.previewCustomCss ? { previewCustomCss: options.previewCustomCss } : {}),
    diagnostics: projectedDiagnostics,
    ...(book.sdocBook === '1.1' ? { publishProfile: book.publish } : {}),
    settings,
    canExport: !profileRequired && !blockingDiagnostics,
    ...(profileRequired
      ? { exportBlockedReason: 'publish-profile-required' as const }
      : blockingDiagnostics
        ? { exportBlockedReason: 'diagnostics' as const }
        : {}),
  };
}

export function createBookWorkspaceInvalidState(
  options: CreateBookWorkspaceInvalidStateOptions,
): BookWorkspaceInvalidState {
  return {
    status: 'invalid',
    generation: options.generation,
    revision: options.revision,
    locale: options.locale,
    diagnostics: options.diagnostics.map(projectDiagnostic),
  };
}

export type BookExportFormat = 'html' | 'pdf';

export interface BookExportPrepareRequest {
  requestId: FileOperationRequestId;
  baseRevision: number;
  format: BookExportFormat;
  settingsFingerprint: ResolvedDocumentSettingsSnapshot['fingerprint'];
}

/**
 * Stable webview-side seam for the common immutable file-operation executor.
 * The initial VS Code adapter may service prepare directly; later adapters can
 * forward the remaining lifecycle without changing the Book workspace.
 */
export interface BookFileOperationAdapter {
  prepare(request: BookExportPrepareRequest): void;
  execute(requestId: FileOperationRequestId, planId: FileOperationPlanId): void;
  cancel(requestId: FileOperationRequestId, planId?: FileOperationPlanId): void;
  retry(requestId: FileOperationRequestId, previousRequestId: FileOperationRequestId): void;
  resultAction(
    requestId: FileOperationRequestId,
    action: FileOperationResultAction,
    artifactId?: FileOperationArtifactId,
  ): void;
}

export interface BookPendingResultAction {
  resultRequestId: FileOperationRequestId;
  actionRequestId: FileOperationRequestId;
  action: FileOperationResultAction;
}

export interface BookResultActionFeedback {
  resultRequestId: FileOperationRequestId;
  actionRequestId: FileOperationRequestId;
  action: FileOperationResultAction;
  status: 'completed' | 'failed';
  error?: FileOperationError;
}

export interface BookResultActionState {
  pending?: BookPendingResultAction;
  feedback?: BookResultActionFeedback;
}

export const BOOK_RESULT_ACTION_IDLE_STATE: BookResultActionState = Object.freeze({});

/** Starts at most one result action and never reuses the operation request capability. */
export function beginBookResultAction(
  state: BookResultActionState,
  resultRequestId: FileOperationRequestId,
  actionRequestId: FileOperationRequestId,
  action: FileOperationResultAction,
): BookResultActionState {
  if (state.pending || !resultRequestId || !actionRequestId || resultRequestId === actionRequestId) {
    return state;
  }
  return {
    pending: { resultRequestId, actionRequestId, action },
  };
}

/** Applies only the exact sideband response for the currently pending Book result action. */
export function reduceBookResultActionHostMessage(
  state: BookResultActionState,
  message: FileOperationResultActionStatusMessage,
  identity: BookFileOperationIdentity,
): BookResultActionState {
  const pending = state.pending;
  if (!pending
    || message.sessionId !== identity.sessionId
    || message.documentId !== identity.documentId
    || message.requestId !== pending.resultRequestId
    || message.actionRequestId !== pending.actionRequestId
    || message.action !== pending.action) return state;
  return {
    feedback: {
      resultRequestId: pending.resultRequestId,
      actionRequestId: pending.actionRequestId,
      action: pending.action,
      status: message.status,
      ...(message.status === 'failed' && message.error ? { error: message.error } : {}),
    },
  };
}

export interface BookWorkspaceCallbacks {
  onAddDocument(): void;
  onOpenDocument(index: number, nodeId?: string): void;
  onMoveDocument(from: number, to: number): void;
  onRemoveDocument(index: number): void;
  onUpdateMeta(key: 'title' | 'author' | 'version', value: string): void;
  onRefresh(): void;
  onOpenSource(): void;
  onOpenDiagnostic(index: number): void;
  onSavePublishProfile(profile: SdocBookPublishProfileV1): void;
  onExport(format: BookExportFormat): void;
}

export type BookWorkspaceHostMessage = {
  type: 'bookWorkspaceState';
  sessionId: string;
  documentId: string;
  state: BookWorkspaceState;
};

export interface BookFileOperationIdentity {
  sessionId: string;
  documentId: string;
}

/** Reconcile path-free host states through the shared correlated reducer. */
export function reduceBookFileOperationHostMessage(
  controller: FileOperationControllerState,
  message: FileOperationPreflightMessage | FileOperationStatusMessage,
  identity: BookFileOperationIdentity,
): FileOperationControllerState {
  if (message.sessionId !== identity.sessionId
    || message.documentId !== identity.documentId) return controller;
  if (message.type === 'fileOperationPreflight') {
    return fileOperationReducer(controller, {
      type: 'preflight', sessionId: identity.sessionId,
      requestId: message.requestId, plan: message.plan,
    });
  }
  const next = message.state;
  if (next.phase === 'idle') return controller;
  if (next.phase === 'preflighting') {
    return fileOperationReducer(controller, {
      type: 'prepare', sessionId: identity.sessionId,
      requestId: next.requestId, intent: next.intent, stage: next.stage,
    });
  }
  if (next.phase === 'running') {
    if (controller.operationState.phase === 'awaiting-confirmation' && next.planId) {
      return fileOperationReducer(controller, {
        type: 'execute', sessionId: identity.sessionId,
        requestId: next.requestId, planId: next.planId, stage: next.stage,
      });
    }
    return fileOperationReducer(controller, {
      type: 'progress', sessionId: identity.sessionId,
      requestId: next.requestId, stage: next.stage,
    });
  }
  if (next.phase === 'succeeded') return fileOperationReducer(controller, {
    type: 'succeeded', sessionId: identity.sessionId,
    requestId: next.requestId, result: next.result, details: next.details,
  });
  if (next.phase === 'failed') return fileOperationReducer(controller, {
    type: 'failed', sessionId: identity.sessionId,
    requestId: next.requestId, error: next.error,
  });
  if (next.phase === 'cancelled') return fileOperationReducer(controller, {
    type: 'cancelled', sessionId: identity.sessionId, requestId: next.requestId,
  });
  return controller;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

const isDiagnosticView = (value: unknown): boolean => isRecord(value)
  && Number.isInteger(value.index)
  && (value.severity === 'error' || value.severity === 'warning')
  && typeof value.code === 'string'
  && typeof value.message === 'string'
  && isOptionalString(value.documentPath)
  && isOptionalString(value.nodeId);

const isPreviewNode = (value: unknown, budget = { remaining: 100_000 }, depth = 0): boolean => {
  if (!isRecord(value) || typeof value.type !== 'string' || depth > 256 || budget.remaining-- <= 0) return false;
  if (value.content !== undefined) {
    if (!Array.isArray(value.content)
      || value.content.some((child) => !isPreviewNode(child, budget, depth + 1))) return false;
  }
  return value.attrs === undefined || isRecord(value.attrs);
};

const isReadyState = (state: Record<string, unknown>): boolean => {
  if ((state.bookVersion !== '1.0' && state.bookVersion !== '1.1')
    || typeof state.title !== 'string'
    || typeof state.author !== 'string'
    || typeof state.version !== 'string'
    || typeof state.canExport !== 'boolean'
    || !Array.isArray(state.documents)
    || !Array.isArray(state.outline)
    || !isPreviewNode(state.preview)
    || (state.previewCustomCss !== undefined && typeof state.previewCustomCss !== 'string')
    || !isRecord(state.settings)
    || !isRecord(state.settings.values)
    || !isRecord(state.settings.entries)
    || !Array.isArray(state.settings.diagnostics)
    || typeof state.settings.fingerprint !== 'string'
    || !/^sha256:[0-9a-f]{64}$/.test(state.settings.fingerprint)) return false;
  const documentsValid = state.documents.every((document) => isRecord(document)
    && Number.isInteger(document.index)
    && typeof document.path === 'string'
    && typeof document.label === 'string'
    && (document.status === 'ok' || document.status === 'missing' || document.status === 'invalid')
    && Array.isArray(document.diagnostics)
    && document.diagnostics.every(isDiagnosticView));
  const outlineValid = state.outline.every((item) => isRecord(item)
    && Number.isInteger(item.documentIndex)
    && typeof item.documentPath === 'string'
    && isOptionalString(item.nodeId)
    && Number.isInteger(item.level)
    && typeof item.title === 'string');
  return documentsValid && outlineValid;
};

export function isBookWorkspaceHostMessage(value: unknown): value is BookWorkspaceHostMessage {
  if (!isRecord(value)
    || value.type !== 'bookWorkspaceState'
    || typeof value.sessionId !== 'string'
    || typeof value.documentId !== 'string'
    || !isRecord(value.state)) return false;
  const state = value.state;
  const baseValid = (state.status === 'ready' || state.status === 'invalid')
    && Number.isInteger(state.generation)
    && Number.isInteger(state.revision)
    && (state.locale === 'en' || state.locale === 'ko')
    && Array.isArray(state.diagnostics)
    && state.diagnostics.every(isDiagnosticView);
  return baseValid && (state.status === 'invalid' || isReadyState(state));
}
