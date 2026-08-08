import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  BookEditorWorkspace,
  bookKeyboardAction,
} from '../shared/editor/components/BookEditorWorkspace';
import {
  createBookWorkspaceReadyState,
  createBookWorkspaceInvalidState,
  isBookWorkspaceHostMessage,
  scopeBookPreviewCss,
  beginBookResultAction,
  BOOK_RESULT_ACTION_IDLE_STATE,
  reduceBookFileOperationHostMessage,
  reduceBookResultActionHostMessage,
  type BookWorkspaceCallbacks,
  type BookFileOperationAdapter,
} from '../shared/editor/bookWorkspace';
import {
  BookResultActionRequestDeduper,
  createDefaultSdocBookPublishProfile,
  isBookWebviewMessage,
} from '../shared/book';
import type { BookCompositionResult, SdocBookV1_0, SdocBookV1_1 } from '../shared/book';
import type { EditorExtensionRuntime } from '../shared/editor/extensionRuntime';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '../shared/editor/extensionRuntime';
import { createFileOperationControllerState, fileOperationReducer } from '../shared/editor/fileOperations';

const legacyBook: SdocBookV1_0 = {
  sdocBook: '1.0',
  title: 'System Guide',
  documents: [{ path: './intro.sdoc' }, { path: './missing.sdoc' }],
};

const composition: BookCompositionResult = {
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'intro', level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Welcome' }] },
    ],
  },
  meta: { title: 'System Guide' },
  documents: [
    {
      path: './intro.sdoc', label: 'Introduction', status: 'ok',
      meta: { settings: { captionStyle: 'ieee' } },
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { id: 'intro', level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
          { type: 'heading', attrs: { id: 'scope', level: 2 }, content: [{ type: 'text', text: 'Scope' }] },
        ],
      },
    },
    { path: './missing.sdoc', label: 'Missing', status: 'missing' },
  ],
  diagnostics: [{
    severity: 'error', code: 'DOCUMENT_MISSING', message: 'Missing chapter', documentPath: './missing.sdoc',
  }],
  counterResetPaths: [],
};

const callbacks: BookWorkspaceCallbacks = {
  onAddDocument: vi.fn(),
  onOpenDocument: vi.fn(),
  onMoveDocument: vi.fn(),
  onRemoveDocument: vi.fn(),
  onUpdateMeta: vi.fn(),
  onRefresh: vi.fn(),
  onOpenSource: vi.fn(),
  onOpenDiagnostic: vi.fn(),
  onSavePublishProfile: vi.fn(),
  onExport: vi.fn(),
};

const runtime: EditorExtensionRuntime = NOOP_EDITOR_EXTENSION_RUNTIME;
const fileOperations: BookFileOperationAdapter = {
  prepare: vi.fn(), execute: vi.fn(), cancel: vi.fn(), retry: vi.fn(), resultAction: vi.fn(),
};

describe('Book React workspace contract', () => {
  it('keeps 1.0 previewable and editable while export fails closed', () => {
    const state = createBookWorkspaceReadyState({
      book: legacyBook,
      composition,
      diagnostics: composition.diagnostics,
      generation: 1,
      revision: 7,
      locale: 'en',
    });

    expect(state.preview).toEqual(composition.doc);
    expect(state.canExport).toBe(false);
    expect(state.exportBlockedReason).toBe('publish-profile-required');
    expect(state.publishProfile).toBeUndefined();
    expect(state.outline.map((item) => [item.documentIndex, item.level, item.title])).toEqual([
      [0, 1, 'Introduction'],
      [0, 2, 'Scope'],
    ]);
    expect(state.settings.entries.captionStyle.source).toBe('built-in');
  });

  it('resolves a 1.1 profile through the portable Book settings context', () => {
    const publish = createDefaultSdocBookPublishProfile();
    publish.settings.captionStyle = 'korean';
    const book: SdocBookV1_1 = { ...legacyBook, sdocBook: '1.1', publish };
    const state = createBookWorkspaceReadyState({
      book,
      composition: { ...composition, diagnostics: [] },
      diagnostics: [],
      generation: 2,
      revision: 8,
      locale: 'ko',
    });

    expect(state.canExport).toBe(true);
    expect(state.settings.values.captionStyle).toBe('korean');
    expect(state.settings.entries.captionStyle.source).toBe('book-profile');
    expect(state.settings.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CHAPTER_SETTING_OVERRIDDEN',
      documentPath: './intro.sdoc',
    }));
    expect(state.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CHAPTER_SETTING_OVERRIDDEN',
      documentPath: './intro.sdoc',
    }));
    expect(state.settings.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('renders accessible recovery, diagnostics, outline, and explicit profile creation controls', () => {
    const ready = createBookWorkspaceReadyState({
      book: legacyBook,
      composition,
      diagnostics: composition.diagnostics,
      generation: 1,
      revision: 7,
      locale: 'en',
    });
    const readyMarkup = renderToStaticMarkup(
      <BookEditorWorkspace state={ready} callbacks={callbacks} previewRuntime={runtime} />,
    );
    expect(readyMarkup).toContain('Book outline');
    expect(readyMarkup).toContain('Create publish profile');
    expect(readyMarkup).toContain('Export requires a saved publish profile');
    expect(readyMarkup).toContain('aria-label="Open diagnostic: Missing chapter"');

    const invalid = createBookWorkspaceInvalidState({
      diagnostics: [{ severity: 'error', code: 'BOOK_INVALID', message: 'Invalid JSON' }],
      generation: 2,
      revision: 8,
      locale: 'en',
    });
    const invalidMarkup = renderToStaticMarkup(
      <BookEditorWorkspace state={invalid} callbacks={callbacks} previewRuntime={runtime} />,
    );
    expect(invalidMarkup).toContain('Open source');
    expect(invalidMarkup).toContain('Retry');
    expect(invalidMarkup).toContain('role="alert"');
  });

  it('maps keyboard structural actions without stealing unmodified arrow keys', () => {
    expect(bookKeyboardAction({ key: 'ArrowUp', altKey: true }, 2, 4)).toEqual({ type: 'move', to: 1 });
    expect(bookKeyboardAction({ key: 'ArrowDown', altKey: true }, 2, 4)).toEqual({ type: 'move', to: 3 });
    expect(bookKeyboardAction({ key: 'Delete', altKey: false }, 2, 4)).toEqual({ type: 'remove' });
    expect(bookKeyboardAction({ key: 'Enter', altKey: false }, 2, 4)).toEqual({ type: 'open' });
    expect(bookKeyboardAction({ key: 'ArrowUp', altKey: false }, 2, 4)).toBeNull();
    expect(bookKeyboardAction({ key: 'ArrowDown', altKey: true }, 3, 4)).toBeNull();
  });

  it('renders the common preflight confirmation without exposing a host path', () => {
    const publish = createDefaultSdocBookPublishProfile();
    const book: SdocBookV1_1 = { ...legacyBook, sdocBook: '1.1', publish };
    const state = createBookWorkspaceReadyState({
      book,
      composition: { ...composition, diagnostics: [] },
      diagnostics: [], generation: 3, revision: 9, locale: 'en',
    });
    const markup = renderToStaticMarkup(<BookEditorWorkspace
      state={state}
      callbacks={callbacks}
      previewRuntime={runtime}
      fileOperations={fileOperations}
      operationState={{
        phase: 'awaiting-confirmation', requestId: 'export-1',
        intent: { kind: 'export', format: 'html' },
        plan: {
          planId: 'opaque-plan', intent: { kind: 'export', format: 'html' },
          source: { displayName: 'guide.sdocbook', sizeBytes: 42, revision: 9 },
          destination: {
            displayName: 'guide.html', exists: true,
            scope: 'book', relativePath: './dist/guide.html',
          },
          effectiveSettings: {
            fingerprint: `sha256:${'b'.repeat(64)}`,
            items: [{ key: 'headingNumbering', value: 'true', source: 'book-profile' }],
          },
          diagram: { failurePolicy: 'source-fallback', fallbackCount: 1 },
          warnings: ['The existing destination will be replaced.'],
          requiresConfirmation: true,
        },
      }}
    />);
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Confirm export');
    expect(markup).toContain('guide.html');
    expect(markup).toContain('Book folder');
    expect(markup).toContain('./dist/guide.html');
    expect(markup).toContain('Effective publish settings');
    expect(markup).toContain('Heading numbering');
    expect(markup).toContain('Book profile');
    expect(markup).toContain('Keep diagram source when rendering is unavailable.');
    expect(markup.indexOf('Cancel')).toBeLessThan(markup.indexOf('Export file'));
    expect(markup).not.toContain('C:\\Users');
  });

  it('renders all thirteen portable profile settings with described invalid drafts', () => {
    const publish = createDefaultSdocBookPublishProfile();
    publish.pdf.scale = 250;
    const book: SdocBookV1_1 = { ...legacyBook, sdocBook: '1.1', publish };
    const state = createBookWorkspaceReadyState({
      book, composition: { ...composition, diagnostics: [] }, diagnostics: [],
      generation: 4, revision: 10, locale: 'ko',
    });
    const markup = renderToStaticMarkup(
      <BookEditorWorkspace state={state} callbacks={callbacks} previewRuntime={runtime} />,
    );
    for (const label of [
      '제목 번호 표시', '제목 시작 번호', '제목 장식',
      'H1 번호 색상', 'H2 번호 색상', 'H3 번호 색상',
      'H4 번호 색상', 'H5 번호 색상', 'H6 번호 색상',
      '캡션 스타일', '캡션 번호 방식', '수식 번호 방식', '상호 참조에 캡션 포함',
    ]) expect(markup).toContain(label);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="book-profile-error-pdf-scale"');
    expect(markup).toContain('PDF 배율은 10에서 200 사이여야 합니다.');
  });

  it('scopes safe preview CSS and rejects rules that can escape or load resources', () => {
    expect(scopeBookPreviewCss('h1, .lead { color: #123; }')).toBe(
      '.book-preview-editor h1, .book-preview-editor .lead { color: #123; }',
    );
    expect(scopeBookPreviewCss('@import "https://example.com/x.css"; h1{color:red}')).toBe('');
    expect(scopeBookPreviewCss('body { background: url(https://example.com/x); }')).toBe('');
    expect(scopeBookPreviewCss('h1 { color:red } </style><script>alert(1)</script>')).toBe('');
  });

  it('projects profile heading styling and scoped custom CSS into the composed preview', () => {
    const publish = createDefaultSdocBookPublishProfile();
    publish.settings.headingDecoration = false;
    publish.settings.headingH1Color = '#abcd';
    const book: SdocBookV1_1 = { ...legacyBook, sdocBook: '1.1', publish };
    const state = createBookWorkspaceReadyState({
      book, composition: { ...composition, diagnostics: [] }, diagnostics: [],
      generation: 5, revision: 11, locale: 'en',
      previewCustomCss: '.book-preview-editor h1 { letter-spacing: 0.1em; }',
    });
    const markup = renderToStaticMarkup(
      <BookEditorWorkspace state={state} callbacks={callbacks} previewRuntime={runtime} />,
    );
    expect(markup).toContain('--heading-h1-color:#abcd');
    expect(markup).not.toContain('show-heading-decoration');
    expect(markup).toContain('.book-preview-editor h1 { letter-spacing: 0.1em; }');
  });

  it('renders complete fallback result details and artifact actions', () => {
    const book: SdocBookV1_1 = {
      ...legacyBook, sdocBook: '1.1', publish: createDefaultSdocBookPublishProfile(),
    };
    const state = createBookWorkspaceReadyState({
      book, composition: { ...composition, diagnostics: [] }, diagnostics: [],
      generation: 6, revision: 12, locale: 'en',
    });
    const markup = renderToStaticMarkup(<BookEditorWorkspace
      state={state}
      callbacks={callbacks}
      previewRuntime={runtime}
      fileOperations={fileOperations}
      operationState={{
        phase: 'succeeded', requestId: 'export-result', result: 'fallback',
        intent: { kind: 'export', format: 'pdf' },
        details: {
          outcome: 'fallback',
          artifact: { artifactId: 'artifact-1', displayName: 'guide.html', sizeBytes: 4096 },
          warnings: ['PDF is unavailable; an HTML fallback was created.'],
          availableActions: [
            { action: 'open', artifactId: 'artifact-1' },
            { action: 'reveal', artifactId: 'artifact-1' },
            { action: 'copy', artifactId: 'artifact-1' },
            { action: 'repeat' },
          ],
        },
      }}
      resultActionState={beginBookResultAction(
        BOOK_RESULT_ACTION_IDLE_STATE,
        'export-result', 'action-open-1', 'open',
      )}
    />);
    expect(markup).toContain('Export completed with fallback.');
    expect(markup).toContain('guide.html');
    expect(markup).toContain('4,096 bytes');
    expect(markup).toContain('PDF is unavailable; an HTML fallback was created.');
    for (const action of ['Open', 'Reveal', 'Copy path', 'Repeat']) {
      expect(markup).toContain(action);
    }
    expect(markup).toContain('Opening result…');
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('narrows the React workspace and export adapter messages at the host boundary', () => {
    const hostState = createBookWorkspaceReadyState({
      book: legacyBook,
      composition,
      diagnostics: composition.diagnostics,
      generation: 1,
      revision: 7,
      locale: 'en',
    });
    expect(isBookWorkspaceHostMessage({
      type: 'bookWorkspaceState', sessionId: 'session-a', documentId: 'book-a', state: hostState,
    })).toBe(true);
    expect(isBookWorkspaceHostMessage({
      type: 'bookWorkspaceState', sessionId: 'session-a', documentId: 'book-a',
      state: { ...hostState, preview: { content: [] } },
    })).toBe(false);
    expect(isBookWebviewMessage({ type: 'bookReady' })).toBe(true);
    expect(isBookWebviewMessage({ type: 'openBookSource' })).toBe(true);
    expect(isBookWebviewMessage({ type: 'openDocument', index: 0, nodeId: 'intro' })).toBe(true);
    expect(isBookWebviewMessage({
      type: 'savePublishProfile',
      requestId: 'profile-1',
      baseRevision: 4,
      profile: createDefaultSdocBookPublishProfile(),
    })).toBe(true);
    expect(isBookWebviewMessage({
      type: 'prepareBookExport',
      requestId: 'export-1',
      baseRevision: 4,
      format: 'html',
      settingsFingerprint: `sha256:${'a'.repeat(64)}`,
      sessionId: 'session-a', documentId: 'book-a',
    })).toBe(true);
    expect(isBookWebviewMessage({
      type: 'prepareBookExport',
      requestId: 'export-1',
      baseRevision: 4,
      format: 'html',
      settingsFingerprint: 'host-path',
      sessionId: 'session-a', documentId: 'book-a',
    })).toBe(false);
    expect(isBookWebviewMessage({
      type: 'fileOperationExecute', requestId: 'export-1', planId: 'opaque-plan',
      sessionId: 'session-a', documentId: 'book-a',
    })).toBe(true);
    expect(isBookWebviewMessage({
      type: 'fileOperationExecute', requestId: 'export-1', planId: 'opaque-plan',
    })).toBe(false);
    expect(isBookWebviewMessage({
      type: 'fileOperationResultAction', requestId: 'export-1', action: 'open',
      actionRequestId: 'action-open-1', artifactId: 'artifact-1',
      sessionId: 'session-a', documentId: 'book-a',
    })).toBe(true);
    expect(isBookWebviewMessage({
      type: 'fileOperationResultAction', requestId: 'export-1', action: 'open',
      actionRequestId: 'export-1', artifactId: 'artifact-1',
      sessionId: 'session-a', documentId: 'book-a',
    })).toBe(false);
    expect(isBookWebviewMessage({
      type: 'fileOperationResultAction', requestId: 'export-1', action: 'repeat', artifactId: 'x',
      actionRequestId: 'action-repeat-1',
      sessionId: 'session-a', documentId: 'book-a',
    })).toBe(false);
    expect(isBookWebviewMessage({
      type: 'fileOperationResultAction', requestId: 'export-1', action: 'repeat',
      actionRequestId: 'action-repeat-1',
      sessionId: 'session-a', documentId: 'book-a',
    })).toBe(true);
  });

  it('deduplicates action requests and keeps the first Repeat preflight authoritative', () => {
    const deduper = new BookResultActionRequestDeduper(2);
    expect(deduper.claim('action-repeat-1')).toBe(true);
    expect(deduper.claim('action-repeat-1')).toBe(false);
    expect(deduper.claim('action-repeat-2')).toBe(true);

    const identity = { sessionId: 'session-a', documentId: 'book-a' };
    const resultController = {
      sessionId: identity.sessionId,
      operationState: {
        phase: 'succeeded' as const,
        requestId: 'export-1', result: 'completed' as const,
        intent: { kind: 'export' as const, format: 'html' as const },
        details: { outcome: 'completed' as const, warnings: [], availableActions: [{ action: 'repeat' as const }] },
      },
    };
    const firstAction = beginBookResultAction(
      BOOK_RESULT_ACTION_IDLE_STATE, 'export-1', 'action-repeat-1', 'repeat',
    );
    const duplicateClick = beginBookResultAction(
      firstAction, 'export-1', 'action-repeat-2', 'repeat',
    );
    expect(duplicateClick).toBe(firstAction);

    const firstPreflight = reduceBookFileOperationHostMessage(resultController, {
      type: 'fileOperationStatus', ...identity,
      state: {
        phase: 'preflighting', requestId: 'action-repeat-1',
        intent: { kind: 'export', format: 'html' }, stage: 'Preparing fresh Book snapshot…',
      },
    }, identity);
    expect(firstPreflight.operationState).toMatchObject({
      phase: 'preflighting', requestId: 'action-repeat-1',
    });

    const staleBusy = reduceBookResultActionHostMessage(firstAction, {
      type: 'fileOperationResultActionStatus', ...identity,
      requestId: 'export-1', actionRequestId: 'action-repeat-2', action: 'repeat',
      status: 'failed', error: { code: 'FILE_OPERATION_BUSY', message: 'Busy', retryable: false },
    }, identity);
    expect(staleBusy).toBe(firstAction);
    expect(firstPreflight.operationState).toMatchObject({
      phase: 'preflighting', requestId: 'action-repeat-1',
    });
  });

  it.each(['open', 'reveal', 'copy'] as const)(
    'correlates %s completion, failure, retry, and stale sideband statuses',
    (action) => {
    const identity = { sessionId: 'session-a', documentId: 'book-a' };
    const firstActionId = `action-${action}-1`;
    const retryActionId = `action-${action}-2`;
    const pending = beginBookResultAction(
      BOOK_RESULT_ACTION_IDLE_STATE, 'export-1', firstActionId, action,
    );
    expect(beginBookResultAction(pending, 'export-1', retryActionId, action)).toBe(pending);
    expect(reduceBookResultActionHostMessage(pending, {
      type: 'fileOperationResultActionStatus', ...identity,
      requestId: 'export-1', actionRequestId: 'stale-action', action, status: 'completed',
    }, identity)).toBe(pending);
    expect(reduceBookResultActionHostMessage(pending, {
      type: 'fileOperationResultActionStatus', sessionId: 'session-b', documentId: 'book-a',
      requestId: 'export-1', actionRequestId: firstActionId, action, status: 'completed',
    }, identity)).toBe(pending);

    const failed = reduceBookResultActionHostMessage(pending, {
      type: 'fileOperationResultActionStatus', ...identity,
      requestId: 'export-1', actionRequestId: firstActionId, action,
      status: 'failed', error: { code: 'RESULT_ACTION_FAILED', message: `${action} failed.`, retryable: true },
    }, identity);
    expect(failed.pending).toBeUndefined();
    expect(failed).toMatchObject({
      feedback: { actionRequestId: firstActionId, action, status: 'failed' },
    });
    const retry = beginBookResultAction(failed, 'export-1', retryActionId, action);
    expect(retry.pending).toMatchObject({ actionRequestId: retryActionId, action });
    const completed = reduceBookResultActionHostMessage(retry, {
      type: 'fileOperationResultActionStatus', ...identity,
      requestId: 'export-1', actionRequestId: retryActionId, action, status: 'completed',
    }, identity);
    expect(completed.pending).toBeUndefined();
    expect(completed).toMatchObject({
      feedback: { actionRequestId: retryActionId, action, status: 'completed' },
    });
    },
  );

  it('uses the common reducer to ignore stale Book sessions and request results', () => {
    const identity = { sessionId: 'session-a', documentId: 'book-a' };
    const preparing = fileOperationReducer(createFileOperationControllerState('session-a'), {
      type: 'prepare', ...identity, requestId: 'request-a',
      intent: { kind: 'export', format: 'html' }, stage: 'preparing',
    });
    const plan = {
      planId: 'plan-a', intent: { kind: 'export' as const, format: 'html' as const },
      source: { displayName: 'book.sdocbook', sizeBytes: 1 },
      destination: { displayName: 'book.html', exists: false },
      warnings: [], requiresConfirmation: true,
    };
    const staleSession = reduceBookFileOperationHostMessage(preparing, {
      type: 'fileOperationPreflight', requestId: 'request-a',
      sessionId: 'session-b', documentId: 'book-a', plan,
    }, identity);
    expect(staleSession).toBe(preparing);
    const staleRequest = reduceBookFileOperationHostMessage(preparing, {
      type: 'fileOperationPreflight', requestId: 'request-b', ...identity, plan,
    }, identity);
    expect(staleRequest).toBe(preparing);
    const accepted = reduceBookFileOperationHostMessage(preparing, {
      type: 'fileOperationPreflight', requestId: 'request-a', ...identity, plan,
    }, identity);
    expect(accepted.operationState.phase).toBe('awaiting-confirmation');
  });
});
