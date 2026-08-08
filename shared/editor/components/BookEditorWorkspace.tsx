import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import {
  createDefaultSdocBookPublishProfile,
} from '../../book/publishProfile';
import type { SdocBookPublishProfileV1 } from '../../book/types';
import type { DocumentSettingKey, DocumentSettingSource } from '../../types';
import {
  BOOK_RESULT_ACTION_IDLE_STATE,
  type BookFileOperationAdapter,
  type BookResultActionState,
  type BookWorkspaceCallbacks,
  type BookWorkspaceReadyState,
  type BookWorkspaceState,
} from '../bookWorkspace';
import {
  isFileOperationActive,
  type FileOperationResultAction,
  type FileOperationState,
} from '../fileOperations';
import type { EditorExtensionRuntime } from '../extensionRuntime';
import { createBookPreviewExtensions } from '../bookPreviewExtensions';

interface BookKeyboardEventLike {
  key: string;
  altKey: boolean;
}

export type BookKeyboardAction =
  | { type: 'move'; to: number }
  | { type: 'remove' }
  | { type: 'open' };

export function bookKeyboardAction(
  event: BookKeyboardEventLike,
  index: number,
  count: number,
): BookKeyboardAction | null {
  if (event.altKey && event.key === 'ArrowUp' && index > 0) return { type: 'move', to: index - 1 };
  if (event.altKey && event.key === 'ArrowDown' && index < count - 1) return { type: 'move', to: index + 1 };
  if (!event.altKey && event.key === 'Delete') return { type: 'remove' };
  if (!event.altKey && event.key === 'Enter') return { type: 'open' };
  return null;
}

interface BookEditorWorkspaceProps {
  state: BookWorkspaceState;
  callbacks: BookWorkspaceCallbacks;
  previewRuntime: EditorExtensionRuntime;
  pending?: boolean;
  operationState?: FileOperationState;
  fileOperations?: BookFileOperationAdapter;
  resultActionState?: BookResultActionState;
}

const STRINGS = {
  en: {
    invalidTitle: 'This Book source is invalid',
    invalidBody: 'Fix the manifest source, then retry validation.',
    openSource: 'Open source',
    retry: 'Retry',
    untitled: 'Untitled book',
    title: 'Title',
    author: 'Author',
    version: 'Version',
    documents: 'Book chapters',
    outline: 'Book outline',
    preview: 'Composed read-only preview',
    diagnostics: 'Diagnostics',
    noDocuments: 'No chapters are in this Book.',
    noOutline: 'No headings are available.',
    noDiagnostics: 'No diagnostics.',
    add: 'Add chapter',
    refresh: 'Retry validation',
    moveUp: 'Move up',
    moveDown: 'Move down',
    remove: 'Remove',
    profile: 'Publish profile',
    profileRequired: 'Export requires a saved publish profile. Preview and Book editing remain available.',
    diagnosticsBlocked: 'Export is blocked until Book errors are fixed.',
    createProfile: 'Create publish profile',
    saveProfile: 'Save publish profile',
    captionStyle: 'Caption style',
    headingNumbering: 'Number headings in output',
    htmlEmbedding: 'HTML embedding',
    pdfScale: 'PDF scale',
    diagramFailure: 'Diagram failure',
    sourceFallback: 'Keep source fallback',
    fail: 'Block export',
    cssPath: 'Book-relative CSS',
    outputDir: 'Book-relative output directory',
    fingerprint: 'Effective settings fingerprint',
    exportHtml: 'Export HTML',
    exportPdf: 'Export PDF',
    openChapter: (label: string) => `Open ${label}`,
    openDiagnostic: (message: string) => `Open diagnostic: ${message}`,
    operation: 'Export operation',
    confirmExport: 'Confirm export',
    cancelExport: 'Cancel',
    retryExport: 'Retry export',
    openResult: 'Open',
    revealResult: 'Reveal',
    copyResult: 'Copy path',
    repeatExport: 'Repeat',
    exportFile: 'Export file',
    source: 'Source',
    destination: 'Destination',
    destinationScope: 'Destination scope',
    destinationDocument: 'Document folder',
    destinationWorkspace: 'Workspace',
    destinationBook: 'Book folder',
    relativePath: 'Relative path',
    effectiveSettings: 'Effective publish settings',
    operationHeadingNumbering: 'Heading numbering',
    sourceDocument: 'Stored in document',
    sourceBook: 'Book profile',
    sourceHost: 'Host setting',
    sourceBuiltIn: 'Product default',
    sourceTemporary: 'Temporary view',
    diagramPolicy: 'Diagram fallback',
    diagramPolicyFail: 'Block export when a diagram cannot be rendered.',
    diagramPolicyFallback: 'Keep diagram source when rendering is unavailable.',
    diagramFallbackNone: 'No diagram fallbacks are required.',
    diagramFallbackOne: '1 diagram fallback',
    diagramFallbackCount: (count: number) => `${count} diagram fallbacks`,
    headingStartNumber: 'Heading start number',
    headingDecoration: 'Heading decoration',
    headingH1Color: 'H1 number color',
    headingH2Color: 'H2 number color',
    headingH3Color: 'H3 number color',
    headingH4Color: 'H4 number color',
    headingH5Color: 'H5 number color',
    headingH6Color: 'H6 number color',
    captionNumbering: 'Caption numbering',
    equationNumbering: 'Equation numbering',
    crossRefIncludeCaption: 'Include caption in cross-references',
    sequential: 'Sequential',
    hierarchical: 'Hierarchical',
    fieldColorError: 'Use a 3, 4, 6, or 8 digit hex color.',
    fieldStartError: 'Heading start number must be a whole number of zero or greater.',
    fieldScaleError: 'PDF scale must be from 10 through 200.',
    fieldCssError: 'CSS must be a safe Book-relative .css path.',
    fieldOutputError: 'Output directory must be a safe Book-relative path.',
    movedChapter: (label: string, position: number) => `${label} moved to position ${position}.`,
    removedChapter: (label: string) => `${label} removed from the Book.`,
    operationInProgress: 'Book operation in progress.',
    completed: 'Export completed.',
    completedWithFallback: 'Export completed with fallback.',
    cancelled: 'Export cancelled.',
    bytes: (count: number) => `${count.toLocaleString('en-US')} bytes`,
    actionPending: (action: FileOperationResultAction) => action === 'open'
      ? 'Opening result…'
      : action === 'reveal' ? 'Revealing result…'
        : action === 'copy' ? 'Copying path…'
          : action === 'repeat' ? 'Preparing a new export…' : 'Restoring previous content…',
    actionCompleted: (action: FileOperationResultAction) => action === 'open'
      ? 'Result opened.'
      : action === 'reveal' ? 'Result revealed.'
        : action === 'copy' ? 'Path copied.'
          : action === 'repeat' ? 'New export preflight started.' : 'Previous content restored.',
  },
  ko: {
    invalidTitle: 'Book 원본이 유효하지 않습니다',
    invalidBody: '매니페스트 원본을 수정한 후 유효성 검사를 다시 실행하세요.',
    openSource: '원본 열기',
    retry: '다시 시도',
    untitled: '제목 없는 책',
    title: '제목',
    author: '작성자',
    version: '버전',
    documents: 'Book 장',
    outline: 'Book 개요',
    preview: '합본 읽기 전용 미리보기',
    diagnostics: '진단',
    noDocuments: 'Book에 장이 없습니다.',
    noOutline: '표시할 제목이 없습니다.',
    noDiagnostics: '진단이 없습니다.',
    add: '장 추가',
    refresh: '유효성 다시 검사',
    moveUp: '위로 이동',
    moveDown: '아래로 이동',
    remove: '제거',
    profile: 'Publish 프로필',
    profileRequired: '내보내려면 publish 프로필을 저장해야 합니다. 미리보기와 Book 편집은 계속 사용할 수 있습니다.',
    diagnosticsBlocked: 'Book 오류를 해결할 때까지 내보내기가 차단됩니다.',
    createProfile: 'Publish 프로필 만들기',
    saveProfile: 'Publish 프로필 저장',
    captionStyle: '캡션 스타일',
    headingNumbering: '제목 번호 표시',
    htmlEmbedding: 'HTML 포함 방식',
    pdfScale: 'PDF 배율',
    diagramFailure: '다이어그램 실패',
    sourceFallback: '원본 fallback 유지',
    fail: '내보내기 차단',
    cssPath: 'Book 기준 CSS 경로',
    outputDir: 'Book 기준 출력 폴더',
    fingerprint: '유효 설정 fingerprint',
    exportHtml: 'HTML 내보내기',
    exportPdf: 'PDF 내보내기',
    openChapter: (label: string) => `${label} 열기`,
    openDiagnostic: (message: string) => `진단 열기: ${message}`,
    operation: '내보내기 작업',
    confirmExport: '내보내기 확인',
    cancelExport: '취소',
    retryExport: '내보내기 다시 시도',
    openResult: '열기',
    revealResult: '파일 위치 열기',
    copyResult: '경로 복사',
    repeatExport: '반복',
    exportFile: '파일 내보내기',
    source: '원본',
    destination: '대상',
    destinationScope: '대상 범위',
    destinationDocument: '문서 폴더',
    destinationWorkspace: '워크스페이스',
    destinationBook: 'Book 폴더',
    relativePath: '상대 경로',
    effectiveSettings: '실제 적용 Publish 설정',
    operationHeadingNumbering: '제목 번호 매기기',
    sourceDocument: '문서에 저장됨',
    sourceBook: 'Book 프로필',
    sourceHost: '호스트 설정',
    sourceBuiltIn: '제품 기본값',
    sourceTemporary: '임시 보기',
    diagramPolicy: '다이어그램 대체 방식',
    diagramPolicyFail: '다이어그램을 렌더링할 수 없으면 내보내기를 차단합니다.',
    diagramPolicyFallback: '렌더링할 수 없으면 다이어그램 원본을 유지합니다.',
    diagramFallbackNone: '대체할 다이어그램이 없습니다.',
    diagramFallbackOne: '다이어그램 대체 1개',
    diagramFallbackCount: (count: number) => `다이어그램 대체 ${count}개`,
    headingStartNumber: '제목 시작 번호',
    headingDecoration: '제목 장식',
    headingH1Color: 'H1 번호 색상',
    headingH2Color: 'H2 번호 색상',
    headingH3Color: 'H3 번호 색상',
    headingH4Color: 'H4 번호 색상',
    headingH5Color: 'H5 번호 색상',
    headingH6Color: 'H6 번호 색상',
    captionNumbering: '캡션 번호 방식',
    equationNumbering: '수식 번호 방식',
    crossRefIncludeCaption: '상호 참조에 캡션 포함',
    sequential: '순차',
    hierarchical: '계층',
    fieldColorError: '3, 4, 6 또는 8자리 16진수 색상을 입력하세요.',
    fieldStartError: '제목 시작 번호는 0 이상의 정수여야 합니다.',
    fieldScaleError: 'PDF 배율은 10에서 200 사이여야 합니다.',
    fieldCssError: 'Book 내부의 안전한 .css 상대 경로를 입력하세요.',
    fieldOutputError: 'Book 내부의 안전한 상대 출력 경로를 입력하세요.',
    movedChapter: (label: string, position: number) => `${label} 장을 ${position}번째 위치로 이동했습니다.`,
    removedChapter: (label: string) => `${label} 장을 Book에서 제거했습니다.`,
    operationInProgress: 'Book 작업을 처리하고 있습니다.',
    completed: '내보내기를 완료했습니다.',
    completedWithFallback: '대체 결과로 내보내기를 완료했습니다.',
    cancelled: '내보내기를 취소했습니다.',
    bytes: (count: number) => `${count.toLocaleString('ko-KR')}바이트`,
    actionPending: (action: FileOperationResultAction) => action === 'open'
      ? '결과를 여는 중…'
      : action === 'reveal' ? '결과 위치를 여는 중…'
        : action === 'copy' ? '경로를 복사하는 중…'
          : action === 'repeat' ? '새 내보내기를 준비하는 중…' : '이전 내용을 복원하는 중…',
    actionCompleted: (action: FileOperationResultAction) => action === 'open'
      ? '결과를 열었습니다.'
      : action === 'reveal' ? '결과 위치를 열었습니다.'
        : action === 'copy' ? '경로를 복사했습니다.'
          : action === 'repeat' ? '새 내보내기 사전 검사를 시작했습니다.' : '이전 내용을 복원했습니다.',
  },
} as const;

function cloneProfile(profile: SdocBookPublishProfileV1): SdocBookPublishProfileV1 {
  return {
    profileVersion: '1',
    settings: { ...profile.settings },
    theme: { ...profile.theme },
    html: { ...profile.html },
    pdf: { ...profile.pdf },
    diagrams: { ...profile.diagrams },
    ...(profile.outputDir !== undefined ? { outputDir: profile.outputDir } : {}),
  };
}

const PUBLISH_SETTING_KEYS = [
  'headingNumbering', 'headingStartNumber', 'headingDecoration',
  'headingH1Color', 'headingH2Color', 'headingH3Color',
  'headingH4Color', 'headingH5Color', 'headingH6Color',
  'captionStyle', 'captionNumbering', 'equationNumbering', 'crossRefIncludeCaption',
] as const satisfies readonly (keyof SdocBookPublishProfileV1['settings'])[];

function BookPreflightDialog({
  state,
  adapter,
  readyState,
}: {
  state: Extract<FileOperationState, { phase: 'awaiting-confirmation' }>;
  adapter: BookFileOperationAdapter;
  readyState: BookWorkspaceReadyState;
}) {
  const strings = STRINGS[readyState.locale];
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const settingLabels: Partial<Record<DocumentSettingKey, string>> = {
    headingNumbering: strings.operationHeadingNumbering,
    headingStartNumber: strings.headingStartNumber,
    headingDecoration: strings.headingDecoration,
    headingH1Color: strings.headingH1Color,
    headingH2Color: strings.headingH2Color,
    headingH3Color: strings.headingH3Color,
    headingH4Color: strings.headingH4Color,
    headingH5Color: strings.headingH5Color,
    headingH6Color: strings.headingH6Color,
    captionStyle: strings.captionStyle,
    captionNumbering: strings.captionNumbering,
    equationNumbering: strings.equationNumbering,
    crossRefIncludeCaption: strings.crossRefIncludeCaption,
  };
  const sourceLabels: Record<DocumentSettingSource, string> = {
    document: strings.sourceDocument,
    'book-profile': strings.sourceBook,
    host: strings.sourceHost,
    'built-in': strings.sourceBuiltIn,
    'temporary-view': strings.sourceTemporary,
  };
  const destinationScopeLabels = {
    document: strings.destinationDocument,
    workspace: strings.destinationWorkspace,
    book: strings.destinationBook,
  } as const;
  useEffect(() => { cancelRef.current?.focus(); }, []);
  const cancel = () => adapter.cancel(state.requestId, state.plan.planId);
  return <div className="book-operation-overlay" role="presentation">
    <section
      className="book-operation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="book-operation-dialog-title"
      aria-describedby="book-operation-dialog-summary"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        } else if (event.key === 'Tab') {
          if (event.shiftKey && document.activeElement === cancelRef.current) {
            event.preventDefault();
            confirmRef.current?.focus();
          } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
            event.preventDefault();
            cancelRef.current?.focus();
          }
        }
      }}
    >
      <h2 id="book-operation-dialog-title">{strings.confirmExport}</h2>
      <p id="book-operation-dialog-summary">{state.plan.intent.format.toUpperCase()}</p>
      <dl className="book-operation-summary">
        <div><dt>{strings.source}</dt><dd>{state.plan.source.displayName}</dd></div>
        {state.plan.destination && <>
          <div><dt>{strings.destination}</dt><dd>{state.plan.destination.displayName}</dd></div>
          {state.plan.destination.scope && <div>
            <dt>{strings.destinationScope}</dt>
            <dd>{destinationScopeLabels[state.plan.destination.scope]}</dd>
          </div>}
          {state.plan.destination.relativePath && <div>
            <dt>{strings.relativePath}</dt><dd><code>{state.plan.destination.relativePath}</code></dd>
          </div>}
        </>}
      </dl>
      <section aria-labelledby="book-effective-settings-title">
        <h3 id="book-effective-settings-title">{strings.effectiveSettings}</h3>
        <dl className="book-effective-settings">
          {(state.plan.effectiveSettings?.items ?? PUBLISH_SETTING_KEYS.map((key) => ({
            key,
            value: String(readyState.settings.values[key]),
            source: readyState.settings.entries[key].source,
          }))).map((item) => {
            return <div key={item.key}>
              <dt>{settingLabels[item.key] ?? item.key}</dt>
              <dd>{item.value} · {sourceLabels[item.source]}</dd>
            </div>;
          })}
        </dl>
        {state.plan.effectiveSettings && <code className="book-operation-fingerprint">
          {state.plan.effectiveSettings.fingerprint}
        </code>}
      </section>
      {state.plan.diagram && <section className="book-operation-diagram-summary">
        <h3>{strings.diagramPolicy}</h3>
        <p>{state.plan.diagram.failurePolicy === 'fail'
          ? strings.diagramPolicyFail
          : strings.diagramPolicyFallback}</p>
        <p>{state.plan.diagram.fallbackCount === 0
          ? strings.diagramFallbackNone
          : state.plan.diagram.fallbackCount === 1
            ? strings.diagramFallbackOne
            : strings.diagramFallbackCount(state.plan.diagram.fallbackCount)}</p>
      </section>}
      {state.plan.warnings.length > 0 && <ul className="book-operation-warnings">
        {state.plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>}
      <div className="book-actions book-operation-dialog-actions">
        <button ref={cancelRef} type="button" className="secondary" onClick={cancel}>
          {strings.cancelExport}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={() => adapter.execute(state.requestId, state.plan.planId)}
        >{strings.exportFile}</button>
      </div>
    </section>
  </div>;
}

function BookFileOperationCard({
  state,
  adapter,
  locale,
  resultActionState,
}: {
  state: FileOperationState;
  adapter: BookFileOperationAdapter;
  locale: 'en' | 'ko';
  resultActionState: BookResultActionState;
}) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'awaiting-confirmation') return null;
  const strings = STRINGS[locale];
  const actionPending = resultActionState.pending;
  const actionFeedback = resultActionState.feedback;
  const stage = state.phase === 'preflighting' || state.phase === 'running'
    ? state.stage
    : state.phase === 'failed'
      ? state.error.message
      : state.phase === 'succeeded'
        ? state.result === 'fallback' ? strings.completedWithFallback : strings.completed
        : state.phase === 'cancelled'
          ? strings.cancelled
          : undefined;
  return <section className={`book-operation ${state.phase}`} aria-labelledby="book-operation-title">
    <div className="book-section-heading">
      <div>
        <h2 id="book-operation-title">{strings.operation}</h2>
        <p role="status" aria-live="polite">{stage ?? state.phase}</p>
      </div>
      {(state.phase === 'preflighting' || state.phase === 'running') && <button
        type="button"
        onClick={() => adapter.cancel(state.requestId, state.phase === 'running' ? state.planId : undefined)}
      >{strings.cancelExport}</button>}
    </div>
    {state.phase === 'failed' && state.error.retryable && <button
      type="button"
      onClick={() => adapter.retry(`book-retry-${Date.now().toString(36)}`, state.requestId)}
    >{strings.retryExport}</button>}
    {state.phase === 'succeeded' && state.details && <>
      {state.details.artifact && <p className="book-operation-artifact">
        {state.details.artifact.displayName} · {strings.bytes(state.details.artifact.sizeBytes)}
      </p>}
      {state.details.warnings.length > 0 && <ul className="book-operation-warnings">
        {state.details.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
      </ul>}
      <div
        className="book-actions book-operation-result-actions"
        aria-busy={Boolean(actionPending)}
      >
      {state.details.availableActions.filter((item) => item.action !== 'undo').map((item) => {
        const label = item.action === 'open' ? strings.openResult
          : item.action === 'reveal' ? strings.revealResult
            : item.action === 'copy' ? strings.copyResult
              : strings.repeatExport;
        return <button
          type="button"
          className="secondary"
          key={item.action}
          disabled={Boolean(actionPending)}
          onClick={() => adapter.resultAction(
            state.requestId,
            item.action,
            item.action === 'repeat' ? undefined : item.artifactId,
          )}
        >{label}</button>;
      })}
      </div>
      {actionPending && <p className="book-operation-action-feedback" role="status" aria-live="polite">
        {strings.actionPending(actionPending.action)}
      </p>}
      {actionFeedback && <p
        className={`book-operation-action-feedback ${actionFeedback.status}`}
        role={actionFeedback.status === 'failed' ? 'alert' : 'status'}
        aria-live={actionFeedback.status === 'failed' ? 'assertive' : 'polite'}
      >
        {actionFeedback.status === 'failed'
          ? actionFeedback.error?.message ?? 'The result action failed.'
          : strings.actionCompleted(actionFeedback.action)}
      </p>}
    </>}
  </section>;
}

const isSafeDraftPath = (value: string, extension?: string): boolean => {
  if (!value) return true;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/')
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || normalized.includes(':')) return false;
  return extension ? normalized.toLocaleLowerCase('en-US').endsWith(extension) : true;
};

const isHexColorDraft = (value: string): boolean =>
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

function ProfileFieldError({ id, message }: { id: string; message: string }) {
  return <span id={id} className="book-field-error" role="alert">
    <span aria-hidden="true">⚠</span> {message}
  </span>;
}

function BookPreview({ state, runtime }: {
  state: BookWorkspaceReadyState;
  runtime: EditorExtensionRuntime;
}) {
  const extensions = useMemo(() => createBookPreviewExtensions(runtime), [runtime]);
  const editor = useEditor({
    extensions,
    content: state.preview as JSONContent,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': STRINGS[state.locale].preview,
      },
    },
  }, [extensions]);

  useEffect(() => {
    editor?.commands.setContent(state.preview as JSONContent, { emitUpdate: false });
  }, [editor, state.preview]);

  const headingVariables = Object.fromEntries(([1, 2, 3, 4, 5, 6] as const).map((level) => [
    `--heading-h${level}-color`, state.settings.values[`headingH${level}Color`],
  ])) as React.CSSProperties;
  return <>
    {state.previewCustomCss && <style>{state.previewCustomCss}</style>}
    <EditorContent
      editor={editor}
      style={headingVariables}
      className={`book-preview-editor ${state.settings.values.headingNumbering ? 'show-numbering' : 'hide-numbering'} ${state.settings.values.headingDecoration ? 'show-heading-decoration' : ''}`}
    />
  </>;
}

export const BookEditorWorkspace: React.FC<BookEditorWorkspaceProps> = ({
  state,
  callbacks,
  previewRuntime,
  pending = false,
  operationState,
  fileOperations,
  resultActionState = BOOK_RESULT_ACTION_IDLE_STATE,
}) => {
  const strings = STRINGS[state.locale];
  const initialProfile = state.status === 'ready' && state.publishProfile
    ? state.publishProfile
    : createDefaultSdocBookPublishProfile();
  const [profile, setProfile] = useState<SdocBookPublishProfileV1>(() => cloneProfile(initialProfile));
  const [numberDrafts, setNumberDrafts] = useState(() => ({
    headingStartNumber: String(initialProfile.settings.headingStartNumber),
    pdfScale: String(initialProfile.pdf.scale),
  }));
  const persistedProfile = state.status === 'ready' ? state.publishProfile : undefined;
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const operationWasActiveRef = useRef(false);
  const chapterRowRefs = useRef(new Map<string, HTMLLIElement>());
  const pendingChapterFocusRef = useRef<string | undefined>(undefined);
  const [chapterAnnouncement, setChapterAnnouncement] = useState('');

  useEffect(() => {
    setProfile(cloneProfile(
      persistedProfile
        ? persistedProfile
        : createDefaultSdocBookPublishProfile(),
    ));
    const nextProfile = persistedProfile
      ? persistedProfile
      : createDefaultSdocBookPublishProfile();
    setNumberDrafts({
      headingStartNumber: String(nextProfile.settings.headingStartNumber),
      pdfScale: String(nextProfile.pdf.scale),
    });
  }, [state.revision, persistedProfile]);

  useEffect(() => {
    const active = operationState ? isFileOperationActive(operationState) : false;
    if (operationWasActiveRef.current && !active) exportTriggerRef.current?.focus();
    operationWasActiveRef.current = active;
  }, [operationState]);

  useEffect(() => {
    const target = pendingChapterFocusRef.current;
    if (!target) return;
    pendingChapterFocusRef.current = undefined;
    chapterRowRefs.current.get(target)?.focus();
  }, [state]);

  if (state.status === 'invalid') {
    return <main className="book-workspace book-workspace-invalid" aria-busy={pending}>
      <section className="book-invalid-notice" role="alert" aria-labelledby="book-invalid-title">
        <h1 id="book-invalid-title">{strings.invalidTitle}</h1>
        <p>{strings.invalidBody}</p>
        <ul className="book-diagnostics-list">
          {state.diagnostics.map((diagnostic) => <li key={`${diagnostic.index}-${diagnostic.code}`}>
            <code>{diagnostic.code}</code> {diagnostic.message}
          </li>)}
        </ul>
        <div className="book-actions">
          <button type="button" onClick={callbacks.onOpenSource}>{strings.openSource}</button>
          <button type="button" onClick={callbacks.onRefresh}>{strings.retry}</button>
        </div>
      </section>
    </main>;
  }

  const parsedStartNumber = Number(numberDrafts.headingStartNumber);
  const startNumberValid = /^\d+$/.test(numberDrafts.headingStartNumber)
    && Number.isSafeInteger(parsedStartNumber);
  const colorValidity = ([1, 2, 3, 4, 5, 6] as const).map((level) =>
    isHexColorDraft(profile.settings[`headingH${level}Color`]));
  const parsedPdfScale = Number(numberDrafts.pdfScale);
  const pdfScaleValid = numberDrafts.pdfScale.trim().length > 0
    && Number.isFinite(parsedPdfScale)
    && parsedPdfScale >= 10 && parsedPdfScale <= 200;
  const cssPathValid = isSafeDraftPath(profile.theme.cssPath ?? '', '.css');
  const outputDirValid = isSafeDraftPath(profile.outputDir ?? '');
  const profileValid = startNumberValid
    && colorValidity.every(Boolean)
    && pdfScaleValid
    && cssPathValid
    && outputDirValid;
  const moveChapter = (index: number, to: number): void => {
    const chapter = state.documents[index];
    if (!chapter) return;
    pendingChapterFocusRef.current = chapter.path;
    setChapterAnnouncement(strings.movedChapter(chapter.label, to + 1));
    callbacks.onMoveDocument(index, to);
  };
  const removeChapter = (index: number): void => {
    const chapter = state.documents[index];
    if (!chapter) return;
    pendingChapterFocusRef.current = state.documents[index + 1]?.path
      ?? state.documents[index - 1]?.path;
    setChapterAnnouncement(strings.removedChapter(chapter.label));
    callbacks.onRemoveDocument(index);
  };

  const preflight = operationState?.phase === 'awaiting-confirmation'
    ? operationState
    : undefined;

  return <main className="book-workspace" aria-busy={pending}>
    {preflight && fileOperations && <BookPreflightDialog
      state={preflight}
      adapter={fileOperations}
      readyState={state}
    />}
    <div
      className="book-workspace-background"
      inert={Boolean(preflight)}
      aria-hidden={preflight ? true : undefined}
    >
    <header className="book-header">
      <div>
        <p className="book-eyebrow">.sdocbook {state.bookVersion}</p>
        <h1>{state.title || strings.untitled}</h1>
      </div>
      <div className="book-actions" role="toolbar" aria-label={strings.documents}>
        <button type="button" onClick={callbacks.onAddDocument} disabled={pending}>{strings.add}</button>
        <button type="button" className="secondary" onClick={callbacks.onRefresh} disabled={pending}>{strings.refresh}</button>
        <button type="button" className="secondary" onClick={(event) => {
          exportTriggerRef.current = event.currentTarget;
          callbacks.onExport('html');
        }} disabled={pending || !state.canExport}>{strings.exportHtml}</button>
        <button type="button" className="secondary" onClick={(event) => {
          exportTriggerRef.current = event.currentTarget;
          callbacks.onExport('pdf');
        }} disabled={pending || !state.canExport}>{strings.exportPdf}</button>
      </div>
    </header>

    {operationState && fileOperations && <BookFileOperationCard
      state={operationState}
      adapter={fileOperations}
      locale={state.locale}
      resultActionState={resultActionState}
    />}

    <section className="book-meta" aria-label="Book metadata">
      {(['title', 'author', 'version'] as const).map((key) => <label key={`${state.revision}-${key}`}>
        <span>{strings[key]}</span>
        <input
          defaultValue={state[key]}
          disabled={pending}
          onBlur={(event) => callbacks.onUpdateMeta(key, event.currentTarget.value)}
        />
      </label>)}
    </section>

    <section className={`book-profile ${state.exportBlockedReason ? 'blocked' : ''}`} aria-labelledby="book-profile-title">
      <div className="book-section-heading">
        <div>
          <h2 id="book-profile-title">{strings.profile}</h2>
          {state.exportBlockedReason && <p role="status">
            {state.exportBlockedReason === 'publish-profile-required'
              ? strings.profileRequired : strings.diagnosticsBlocked}
          </p>}
        </div>
        <button
          type="button"
          disabled={pending || !profileValid}
          onClick={() => {
            const next = cloneProfile(profile);
            next.settings.headingStartNumber = parsedStartNumber;
            next.pdf.scale = parsedPdfScale;
            callbacks.onSavePublishProfile(next);
          }}
        >{state.bookVersion === '1.0' ? strings.createProfile : strings.saveProfile}</button>
      </div>
      <div className="book-profile-grid">
        <label><span>{strings.captionStyle}</span><select
          value={profile.settings.captionStyle}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, captionStyle: event.currentTarget.value as SdocBookPublishProfileV1['settings']['captionStyle'] },
          }))}
        >{['ieee', 'iso', 'modern', 'korean'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="book-checkbox"><input
          type="checkbox"
          checked={profile.settings.headingNumbering}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, headingNumbering: event.currentTarget.checked },
          }))}
        /><span>{strings.headingNumbering}</span></label>
        <label><span>{strings.headingStartNumber}</span><input
          type="number" min={0} step={1}
          value={numberDrafts.headingStartNumber}
          aria-invalid={!startNumberValid}
          aria-describedby={!startNumberValid ? 'book-profile-error-heading-start' : undefined}
          onChange={(event) => setNumberDrafts((current) => ({
            ...current, headingStartNumber: event.currentTarget.value,
          }))}
        />{!startNumberValid && <ProfileFieldError
          id="book-profile-error-heading-start" message={strings.fieldStartError}
        />}</label>
        <label className="book-checkbox"><input
          type="checkbox"
          checked={profile.settings.headingDecoration}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, headingDecoration: event.currentTarget.checked },
          }))}
        /><span>{strings.headingDecoration}</span></label>
        {([1, 2, 3, 4, 5, 6] as const).map((level, index) => {
          const key = `headingH${level}Color` as const;
          const errorId = `book-profile-error-heading-h${level}-color`;
          return <label key={key}><span>{strings[key]}</span><input
            value={profile.settings[key]}
            spellCheck={false}
            aria-invalid={!colorValidity[index]}
            aria-describedby={!colorValidity[index] ? errorId : undefined}
            onChange={(event) => setProfile((current) => ({
              ...current,
              settings: { ...current.settings, [key]: event.currentTarget.value },
            }))}
          />{!colorValidity[index] && <ProfileFieldError id={errorId} message={strings.fieldColorError} />}</label>;
        })}
        <label><span>{strings.captionNumbering}</span><select
          value={profile.settings.captionNumbering}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, captionNumbering: event.currentTarget.value as 'sequential' | 'hierarchical' },
          }))}
        ><option value="sequential">{strings.sequential}</option><option value="hierarchical">{strings.hierarchical}</option></select></label>
        <label><span>{strings.equationNumbering}</span><select
          value={profile.settings.equationNumbering}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, equationNumbering: event.currentTarget.value as 'sequential' | 'hierarchical' },
          }))}
        ><option value="sequential">{strings.sequential}</option><option value="hierarchical">{strings.hierarchical}</option></select></label>
        <label className="book-checkbox"><input
          type="checkbox"
          checked={profile.settings.crossRefIncludeCaption}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, crossRefIncludeCaption: event.currentTarget.checked },
          }))}
        /><span>{strings.crossRefIncludeCaption}</span></label>
        <label><span>{strings.htmlEmbedding}</span><select
          value={profile.html.selfContained}
          onChange={(event) => setProfile((current) => ({
            ...current,
            html: { selfContained: event.currentTarget.value as SdocBookPublishProfileV1['html']['selfContained'] },
          }))}
        >{['none', 'images-only', 'full'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>{strings.pdfScale}</span><input
          type="number" min={10} max={200}
          value={numberDrafts.pdfScale}
          aria-invalid={!pdfScaleValid}
          aria-describedby={!pdfScaleValid ? 'book-profile-error-pdf-scale' : undefined}
          onChange={(event) => setNumberDrafts((current) => ({
            ...current, pdfScale: event.currentTarget.value,
          }))}
        />{!pdfScaleValid && <ProfileFieldError
          id="book-profile-error-pdf-scale" message={strings.fieldScaleError}
        />}</label>
        <label><span>{strings.diagramFailure}</span><select
          value={profile.diagrams.failurePolicy}
          onChange={(event) => setProfile((current) => ({
            ...current,
            diagrams: { failurePolicy: event.currentTarget.value as SdocBookPublishProfileV1['diagrams']['failurePolicy'] },
          }))}
        ><option value="source-fallback">{strings.sourceFallback}</option><option value="fail">{strings.fail}</option></select></label>
        <label><span>{strings.cssPath}</span><input
          value={profile.theme.cssPath ?? ''}
          aria-invalid={!cssPathValid}
          aria-describedby={!cssPathValid ? 'book-profile-error-css-path' : undefined}
          placeholder="./styles/book.css"
          onChange={(event) => setProfile((current) => ({
            ...current,
            theme: { id: 'default-v1', ...(event.currentTarget.value ? { cssPath: event.currentTarget.value } : {}) },
          }))}
        />{!cssPathValid && <ProfileFieldError
          id="book-profile-error-css-path" message={strings.fieldCssError}
        />}</label>
        <label><span>{strings.outputDir}</span><input
          value={profile.outputDir ?? ''}
          aria-invalid={!outputDirValid}
          aria-describedby={!outputDirValid ? 'book-profile-error-output-dir' : undefined}
          placeholder="./dist"
          onChange={(event) => setProfile((current) => ({
            ...current,
            ...(event.currentTarget.value ? { outputDir: event.currentTarget.value } : { outputDir: undefined }),
          }))}
        />{!outputDirValid && <ProfileFieldError
          id="book-profile-error-output-dir" message={strings.fieldOutputError}
        />}</label>
      </div>
      <p className="book-fingerprint"><span>{strings.fingerprint}</span> <code>{state.settings.fingerprint}</code></p>
    </section>

    <div className="book-content-grid">
      <aside className="book-sidebar">
        <section aria-labelledby="book-documents-heading">
          <h2 id="book-documents-heading">{strings.documents}</h2>
          {state.documents.length === 0 ? <p>{strings.noDocuments}</p> : <ol className="book-document-list">
            {state.documents.map((document) => <li
              key={document.path}
              ref={(element) => {
                if (element) chapterRowRefs.current.set(document.path, element);
                else chapterRowRefs.current.delete(document.path);
              }}
              className={`book-document-row ${document.status}`}
              tabIndex={0}
              aria-label={strings.openChapter(document.label)}
              aria-keyshortcuts="Enter Delete Alt+ArrowUp Alt+ArrowDown"
              onKeyDown={(event) => {
                const action = bookKeyboardAction(event, document.index, state.documents.length);
                if (!action) return;
                event.preventDefault();
                if (action.type === 'open') callbacks.onOpenDocument(document.index);
                else if (action.type === 'remove') removeChapter(document.index);
                else moveChapter(document.index, action.to);
              }}
            >
              <button type="button" className="book-document-open" onClick={() => callbacks.onOpenDocument(document.index)}>
                <span>{document.label}</span><code>{document.path}</code>
              </button>
              <span className={`book-status ${document.status}`}>{document.status}</span>
              <span className="book-row-actions">
                <button type="button" aria-label={`${strings.moveUp}: ${document.label}`} disabled={pending || document.index === 0} onClick={() => moveChapter(document.index, document.index - 1)}>↑</button>
                <button type="button" aria-label={`${strings.moveDown}: ${document.label}`} disabled={pending || document.index === state.documents.length - 1} onClick={() => moveChapter(document.index, document.index + 1)}>↓</button>
                <button type="button" aria-label={`${strings.remove}: ${document.label}`} disabled={pending} onClick={() => removeChapter(document.index)}>×</button>
              </span>
            </li>)}
          </ol>}
        </section>
        <section aria-labelledby="book-outline-heading">
          <h2 id="book-outline-heading">{strings.outline}</h2>
          {state.outline.length === 0 ? <p>{strings.noOutline}</p> : <ol className="book-outline-list">
            {state.outline.map((item, index) => <li key={`${item.documentPath}-${item.nodeId ?? index}`} style={{ '--book-outline-level': item.level } as React.CSSProperties}>
              <button type="button" onClick={() => callbacks.onOpenDocument(item.documentIndex, item.nodeId)}>{item.title}</button>
            </li>)}
          </ol>}
        </section>
        <section aria-labelledby="book-diagnostics-heading">
          <h2 id="book-diagnostics-heading">{strings.diagnostics}</h2>
          {state.diagnostics.length === 0 ? <p>{strings.noDiagnostics}</p> : <ul className="book-diagnostics-list">
            {state.diagnostics.map((diagnostic) => <li key={`${diagnostic.index}-${diagnostic.code}`} className={diagnostic.severity}>
              <button type="button" aria-label={strings.openDiagnostic(diagnostic.message)} onClick={() => callbacks.onOpenDiagnostic(diagnostic.index)}>
                <code>{diagnostic.code}</code><span>{diagnostic.message}</span>
              </button>
            </li>)}
          </ul>}
        </section>
      </aside>
      <section className="book-preview" aria-labelledby="book-preview-heading">
        <h2 id="book-preview-heading">{strings.preview}</h2>
        <BookPreview state={state} runtime={previewRuntime} />
      </section>
    </div>
    <p className="sr-only" role="status" aria-live="polite">
      {chapterAnnouncement || (pending ? strings.operationInProgress : '')}
    </p>
    </div>
  </main>;
};
