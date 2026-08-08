import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import '@tiptap/extension-color';
import '@tiptap/extension-highlight';
import '@tiptap/extension-subscript';
import '@tiptap/extension-superscript';
import '@tiptap/extension-table';
import '@tiptap/extension-task-list';
import '@tiptap/extension-text-align';
import '@tiptap/extension-underline';
import { ActivityBar, type ActivityDestination } from '@shared/editor/components/ActivityBar';
import { BookEditorWorkspace } from '@shared/editor/components/BookEditorWorkspace';
import { DiagramDialog } from '@shared/editor/components/DiagramDialog';
import { DesignPanel } from '@shared/editor/components/DesignPanel';
import { DocumentSettingsPanel } from '@shared/editor/components/DocumentSettingsPanel';
import { DocumentHeader } from '@shared/editor/components/DocumentHeader';
import {
  FilesPanel,
  type FileExportFormat,
  type FileImportFormat,
  type FileFormatCapability,
} from '@shared/editor/components/FilesPanel';
import { ImageContextMenu } from '@shared/editor/components/ImageContextMenu';
import { InvalidDocumentNotice } from '@shared/editor/components/InvalidDocumentNotice';
import { ModalDialog } from '@shared/editor/components/ModalDialog';
import { ResponsiveSidePanel } from '@shared/editor/components/ResponsiveSidePanel';
import { SidePanelBody } from '@shared/editor/components/SidePanelBody';
import { TableContextMenu } from '@shared/editor/components/TableContextMenu';
import { TemplatePanel } from '@shared/editor/components/TemplatePanel';
import { Toolbar } from '@shared/editor/components/Toolbar';
import { EditorProvider, useEditorContext } from '@shared/editor/context/EditorContext';
import {
  DiagramRenderError,
  type HostDiagramRenderer,
} from '@shared/editor/diagram';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '@shared/editor/extensionRuntime';
import { CustomTable } from '@shared/editor/extensions/CustomTable';
import { ExternalChangePrompt } from '@shared/editor/externalChanges';
import {
  FILE_OPERATION_IDLE_STATE,
  isFileOperationActive,
  type FileOperationState,
} from '@shared/editor/fileOperations';
import {
    createBookWorkspaceReadyState,
    beginBookResultAction,
    BOOK_RESULT_ACTION_IDLE_STATE,
    type BookFileOperationAdapter,
    type BookResultActionState,
    type BookWorkspaceCallbacks,
} from '@shared/editor/bookWorkspace';
import { createEditorTranslator } from '@shared/editor/i18n';
import { createDefaultSdocBookPublishProfile } from '@shared/book/publishProfile';
import type { BookCompositionResult } from '@shared/book/types';
import { createTemplateSessionState, templateSessionReducer } from '@shared/editor/templateSession';
import type { ManagedTemplateDescriptor } from '@shared/types/messages';
import '@shared/editor/styles/fonts.css';
import '@shared/editor/styles/editor.css';
import '@shared/editor/styles/bookEditor.css';
import './harness.css';

type Theme = 'light' | 'dark' | 'hc';
type Locale = 'ko' | 'en';
type FileFixtureState = 'idle' | 'running' | 'failed' | 'succeeded-export' | 'succeeded-import';
type Scene = 'editor' | 'settings' | 'templates' | 'files' | 'book' | 'diagram-error' | 'external-change' | 'invalid-document' | 'interactions';

const TEMPLATE_FIXTURES: readonly ManagedTemplateDescriptor[] = [
  {
    id: 'builtin:technical-report',
    name: 'Technical report',
    description: 'A structured report with findings, figures, and references.',
    category: 'Report',
    source: 'builtin',
    sourceLabel: 'Built-in',
    titleNodeId: 'report-title',
    preview: {
      templateId: 'builtin:technical-report',
      outline: [
        { id: 'report-title', level: 1, text: 'Technical report', numbered: false, isTitle: true },
        { id: 'summary', level: 2, text: 'Executive summary', numbered: true, isTitle: false },
        { id: 'findings', level: 2, text: 'Findings', numbered: true, isTitle: false },
      ],
      counts: {
        headings: 3,
        paragraphs: 8,
        tables: 2,
        figures: 1,
        equations: 0,
        diagrams: 1,
        codeBlocks: 0,
      },
      settingsKeys: ['captionStyle', 'headingNumbering'],
      truncated: false,
    },
  },
  {
    id: 'workspace:product-brief',
    name: 'Product brief',
    description: 'Team brief for product goals, decisions, and delivery milestones.',
    category: 'Planning',
    source: 'workspace',
    sourceLabel: 'Workspace',
    preview: {
      templateId: 'workspace:product-brief',
      outline: [
        { level: 1, text: 'Product brief', numbered: false, isTitle: true },
        { level: 2, text: 'Goals and non-goals', numbered: true, isTitle: false },
      ],
      counts: {
        headings: 2,
        paragraphs: 6,
        tables: 1,
        figures: 0,
        equations: 0,
        diagrams: 0,
        codeBlocks: 0,
      },
      settingsKeys: [],
      truncated: false,
    },
  },
  {
    id: 'user:11111111-1111-4111-8111-111111111111',
    name: 'My weekly review',
    description: 'A personal review with highlights, risks, and next actions.',
    category: 'Personal',
    source: 'user',
    sourceLabel: 'My templates',
  },
];

const exportFixtures = (locale: Locale): readonly FileFormatCapability<FileExportFormat>[] => [
  { format: 'html', available: true },
  { format: 'pdf', available: true },
  { format: 'markdown', available: true },
  { format: 'adoc', available: true },
  {
    format: 'slides',
    available: false,
    unavailableReason: locale === 'ko'
      ? '이 호스트에서는 슬라이드 내보내기를 사용할 수 없습니다.'
      : 'Slides export is unavailable in this host.',
  },
];

const IMPORT_FIXTURES: readonly FileFormatCapability<FileImportFormat>[] = [
  { format: 'markdown', available: true },
  { format: 'html', available: true },
];

const DIAGRAM_ERROR_RENDERER: HostDiagramRenderer = async () => {
  throw new DiagramRenderError(
    'The renderer could not reach the configured service. Check the endpoint and try again.',
    true,
  );
};

function queryValue<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = new URLSearchParams(window.location.search).get(name);
  return allowed.includes(value as T) ? value as T : fallback;
}

function createEditorMock(tableActive: boolean): Editor {
  const active = new Set<string>(tableActive ? ['table'] : []);
  const chain = new Proxy({}, {
    get: (_target, property) => property === 'run' ? () => true : () => chain,
  });
  return {
    chain: () => chain,
    isActive: (nameOrAttrs?: string | Record<string, unknown>) =>
      typeof nameOrAttrs === 'string' ? active.has(nameOrAttrs) : false,
    getAttributes: () => ({}),
    can: () => ({ chain: () => chain }),
    on: () => undefined,
    off: () => undefined,
    commands: { focus: () => true },
  } as unknown as Editor;
}

function ActualTable({ columns, locale }: { columns: number; locale: Locale }) {
  const headers = Array.from({ length: columns }, (_, index) =>
    locale === 'ko' ? `열 ${index + 1}` : `Column ${index + 1}`);
  const text = locale === 'ko'
    ? '좁은 화면에서도 읽을 수 있는 긴 셀 내용'
    : 'Long cell content remains readable at narrow widths';
  const runtime = useMemo(() => ({
    ...NOOP_EDITOR_EXTENSION_RUNTIME,
    translate: createEditorTranslator(locale),
  }), [locale]);
  const editor = useEditor({
    extensions: [
      StarterKit,
      CustomTable.configure({ runtime }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    editable: false,
    editorProps: {
      attributes: {
        'aria-label': locale === 'ko' ? '품질 검증 표 문서' : 'Quality fixture table document',
      },
    },
    content: {
      type: 'doc',
      content: [{
        type: 'table',
        attrs: {
          caption: locale === 'ko'
            ? `표 1. ${columns}열 품질 검증`
            : `Table 1. ${columns}-column quality fixture`,
        },
        content: [
          {
            type: 'tableRow',
            content: headers.map((header) => ({
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: header }] }],
            })),
          },
          ...[1, 2, 3].map((row) => ({
            type: 'tableRow',
            content: headers.map((_header, column) => ({
              type: 'tableCell',
              content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: `${text} ${row}.${column + 1}` }],
              }],
            })),
          })),
        ],
      }],
    },
  }, [columns, locale]);

  return (
    <section className="fixture-table-region" aria-label={locale === 'ko' ? '표 실제 구현' : 'Real table implementation'}>
      <EditorContent editor={editor} data-testid="actual-table-editor" />
    </section>
  );
}

function PanelFixture({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(true);
  const returnFocusRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={returnFocusRef}
        type="button"
        data-testid="panel-return-target"
        onClick={() => setOpen((value) => !value)}
      >Background action</button>
      {open && <ResponsiveSidePanel
        title={locale === 'ko' ? '문서 설정' : 'Document settings'}
        closeLabel={locale === 'ko' ? '문서 패널 닫기' : 'Close document panel'}
        onClose={() => setOpen(false)}
        returnFocusRef={returnFocusRef}
      >
        <button type="button">First panel action</button>
        <button type="button">Last panel action</button>
      </ResponsiveSidePanel>}
    </>
  );
}

function EditorBackdrop({
  editor,
  locale,
  returnFocusRef,
  showNumbering = true,
  showDecoration = true,
}: {
  editor: Editor;
  locale: Locale;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
  showNumbering?: boolean;
  showDecoration?: boolean;
}) {
  return (
    <div className="editor-content-area">
      <Toolbar
        editor={editor}
        onInsertDrawio={() => undefined}
        onInsertImage={() => undefined}
        onInsertLink={() => undefined}
        onInsertMath={() => undefined}
        onInsertDiagram={() => undefined}
        onInsertCrossRef={() => undefined}
      />
      <div className="editor-scroll-area">
        <div
          className="fixture-canvas"
          data-effective-numbering={showNumbering ? 'show' : 'hide'}
          data-effective-decoration={showDecoration ? 'show' : 'hide'}
        >
          <DocumentHeader
            author={locale === 'ko' ? '제품 문서 팀' : 'Product documentation team'}
            version="1.4"
            created="2026-07-28T01:23:00.000Z"
            modified="2026-07-28T04:56:00.000Z"
            onAuthorChange={() => undefined}
            onVersionChange={() => undefined}
          />
          <h1 className="fixture-title">
            {locale === 'ko'
              ? '상용 품질을 위한 구조화 문서'
              : 'Structured documents built for production'}
          </h1>
          <p className="fixture-lede">
            {locale === 'ko'
              ? '공유 편집기 구성 요소를 실제 호스트 레이아웃에서 검증하는 고정 장면입니다.'
              : 'A fixed scene exercising shared editor components in the production host layout.'}
          </p>
          <button ref={returnFocusRef} type="button" data-testid="scene-return-target">
            {locale === 'ko' ? '문서로 돌아가기' : 'Return to document'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SharedPanelScene({
  editor,
  locale,
  scene,
  fileFixtureState = 'idle',
}: {
  editor: Editor;
  locale: Locale;
  scene: 'settings' | 'templates' | 'files';
  fileFixtureState?: FileFixtureState;
}) {
  const {
    state: designState,
    dispatch: dispatchEditorState,
  } = useEditorContext();
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  const [publishTab, setPublishTab] = useState<'export' | 'import'>('export');
  const [fileOperationState, setFileOperationState] = useState<FileOperationState>(
    () => {
      if (fileFixtureState === 'running') return {
        phase: 'running', requestId: 'fixture-operation', kind: 'export', format: 'html',
        intent: { kind: 'export', format: 'html' }, planId: 'fixture-plan',
        stage: locale === 'ko' ? '불변 스냅샷을 렌더링하는 중…' : 'Rendering immutable snapshot…',
      };
      if (fileFixtureState === 'failed') return {
        phase: 'failed', requestId: 'fixture-operation',
        intent: { kind: 'export', format: 'html' },
        error: {
          code: 'STALE_TARGET', retryable: true,
          message: locale === 'ko' ? '대상이 preflight 후 변경되었습니다.' : 'The destination changed after preflight.',
        },
      };
      if (fileFixtureState === 'succeeded-import') return {
        phase: 'succeeded', requestId: 'fixture-operation', result: 'completed',
        intent: { kind: 'import', format: 'markdown' },
        details: {
          outcome: 'completed', warnings: [],
          availableActions: [{ action: 'undo', artifactId: 'checkpoint-1' }, { action: 'repeat' }],
        },
      };
      if (fileFixtureState === 'succeeded-export') return {
        phase: 'succeeded', requestId: 'fixture-operation', result: 'completed',
        intent: { kind: 'export', format: 'html' },
        details: {
          outcome: 'completed', warnings: [],
          artifact: { artifactId: 'artifact-1', displayName: 'quality-report.html', sizeBytes: 4096 },
          availableActions: [
            { action: 'open', artifactId: 'artifact-1' },
            { action: 'reveal', artifactId: 'artifact-1' },
            { action: 'copy', artifactId: 'artifact-1' },
            { action: 'repeat' },
          ],
        },
      };
      return FILE_OPERATION_IDLE_STATE;
    },
  );
  const [templateSession, dispatchTemplateSession] = useReducer(
    templateSessionReducer,
    undefined,
    () => ({
      ...createTemplateSessionState(),
      catalog: { phase: 'ready' as const, requestId: 'fixture-catalog' },
      templates: TEMPLATE_FIXTURES,
      diagnostics: [{
        id: 'workspace-readable-diagnostic',
        code: 'read-failed' as const,
        source: 'workspace' as const,
        severity: 'warning' as const,
        targetLabel: 'legacy-report.sdoc',
        detail: 'One workspace template could not be read.',
        recovery: 'retry' as const,
      }],
      personalRootScope: 'remote' as const,
    }),
  );
  const title = scene === 'settings'
    ? (locale === 'ko' ? '디자인' : 'Design')
    : scene === 'templates'
      ? (locale === 'ko' ? '템플릿' : 'Templates')
      : (locale === 'ko' ? '파일' : 'Files');
  const destination: ActivityDestination = scene === 'settings'
    ? 'design' : scene === 'templates' ? 'templates' : 'publish';
  const selection = scene === 'settings'
    ? { destination: 'design' as const }
    : scene === 'templates'
      ? { destination: 'templates' as const }
      : { destination: 'publish' as const, tab: publishTab };
  const finishFixtureAction = (operation: 'apply' | 'save' | 'update' | 'duplicate' | 'delete' | 'open-folder', templateId?: string, visibleIndex?: number) => {
    const requestId = `fixture-${operation}`;
    dispatchTemplateSession({ type: 'action-started', requestId, operation, templateId, visibleIndex });
    queueMicrotask(() => dispatchTemplateSession(
      operation === 'open-folder'
        ? {
          type: 'action-failed', requestId,
          error: { code: 'operation-failed', message: 'The template action could not be completed.' },
        }
        : { type: 'action-completed', requestId, templateId },
    ));
  };

  return (
    <div
      className="host-frame editor-body-layout scene-surface"
      data-scene={scene}
      data-pdf-scale={designState.docSettings?.pdfScale ?? 'unset'}
      style={{ height: '100vh', position: 'relative' }}
    >
      <ActivityBar
        activeDestination={open ? destination : null}
        onDestinationClick={(clicked) => {
          returnFocusRef.current = document.getElementById(`activity-destination-${clicked}`) as HTMLButtonElement | null;
          setOpen((current) => clicked === destination ? !current : true);
        }}
        showTemplates
      />
      {open && (
        <ResponsiveSidePanel
          title={title}
          closeLabel={locale === 'ko' ? `${title} 패널 닫기` : `Close ${title.toLowerCase()} panel`}
          onClose={() => setOpen(false)}
          returnFocusRef={returnFocusRef}
        >
          <SidePanelBody
            selection={selection}
            onSelectionChange={(nextSelection) => {
              if (nextSelection.destination === 'publish') {
                setPublishTab(nextSelection.tab);
              }
            }}
          >
          {scene === 'settings' && (
            <DesignPanel
              showNumbering={designState.settings.headingNumbering}
              onToggleNumbering={() => undefined}
              showDecoration={designState.settings.headingDecoration}
              onToggleDecoration={() => undefined}
              uiLanguagePreference="auto"
              onUiLanguagePreferenceChange={() => undefined}
              onUpdateDocSettings={(settings) => dispatchEditorState({
                type: 'SET_DOC_SETTINGS',
                payload: settings,
              })}
              adapter={{
                settingsSnapshot: designState.settingsSnapshot,
                viewPreferences: designState.viewPreferences,
                onViewPreferencesChange: (preferences) => dispatchEditorState({
                  type: 'SET_VIEW_PREFERENCES',
                  payload: preferences,
                }),
                settingsSyncState: { status: 'saved' },
              }}
            />
          )}
          {scene === 'templates' && (
            <TemplatePanel
              session={templateSession}
              dispatch={dispatchTemplateSession}
              onApply={(templateId) => finishFixtureAction('apply', templateId)}
              onRefresh={() => {
                const requestId = 'fixture-refresh';
                dispatchTemplateSession({ type: 'catalog-requested', requestId });
                queueMicrotask(() => dispatchTemplateSession({
                  type: 'catalog-succeeded', requestId, templates: TEMPLATE_FIXTURES,
                  diagnostics: templateSession.diagnostics,
                  personalRootScope: templateSession.personalRootScope,
                }));
              }}
              onSaveCurrent={() => finishFixtureAction('save', 'user:fixture-new')}
              onEdit={(template) => finishFixtureAction('update', template.id)}
              onDuplicate={() => finishFixtureAction('duplicate', 'user:fixture-copy')}
              onDelete={(template, visibleIndex) => finishFixtureAction('delete', template.id, visibleIndex)}
              onOpenPersonalFolder={() => finishFixtureAction('open-folder')}
            />
          )}
          {scene === 'files' && (
            <>
            {publishTab === 'export' && (
              <DocumentSettingsPanel
                exportMode="export"
                onUpdateSettings={(settings) => dispatchEditorState({
                  type: 'SET_DOC_SETTINGS',
                  payload: settings,
                })}
              />
            )}
            <FilesPanel
              exportFormats={exportFixtures(locale)}
              importFormats={IMPORT_FIXTURES}
              operationState={fileOperationState}
              onStart={(kind, format) => setFileOperationState({
                phase: 'awaiting-confirmation', requestId: 'fixture-operation',
                intent: kind === 'export'
                  ? { kind, format: format as FileExportFormat }
                  : { kind, format: format as FileImportFormat },
                plan: kind === 'export' ? {
                  planId: 'fixture-plan',
                  intent: { kind, format: format as FileExportFormat },
                  source: { displayName: 'quality-report.sdoc', sizeBytes: 4096, revision: 7 },
                  destination: {
                    displayName: `quality-report.${format}`,
                    exists: true,
                    scope: 'workspace',
                    relativePath: `./dist/quality-report.${format}`,
                  },
                  effectiveSettings: {
                    fingerprint: `sha256:${'a'.repeat(64)}`,
                    items: [
                      { key: 'headingNumbering', value: 'true', source: 'document' },
                      { key: 'selfContained', value: 'images-only', source: 'built-in' },
                    ],
                  },
                  diagram: { failurePolicy: 'source-fallback', fallbackCount: 1 },
                  warnings: ['The existing destination will be replaced.'],
                  requiresConfirmation: true,
                } : {
                  planId: 'fixture-plan',
                  intent: { kind, format: format as FileImportFormat },
                  source: { displayName: `source.${format}`, sizeBytes: 1024 },
                  importPreview: {
                    outline: [{
                      level: 1,
                      title: locale === 'ko' ? '가져온 개요' : 'Imported overview',
                    }],
                    topLevelBlockCount: 4,
                    replacement: 'body-only',
                    preserved: ['metadata', 'settings'],
                  },
                  warnings: [],
                  requiresConfirmation: true,
                },
              })}
              onConfirm={() => setFileOperationState((current) => {
                if (current.phase !== 'awaiting-confirmation') return current;
                return {
                  phase: 'running', requestId: current.requestId,
                  kind: current.intent.kind,
                  format: current.intent.format,
                  intent: current.intent,
                  planId: current.plan.planId,
                  stage: current.intent.kind === 'import'
                    ? (locale === 'ko' ? '본문을 편집기 버퍼에 적용하는 중…' : 'Applying body to editor buffer…')
                    : (locale === 'ko' ? '불변 스냅샷을 렌더링하는 중…' : 'Rendering immutable snapshot…'),
                };
              })}
              onCancel={() => setFileOperationState(FILE_OPERATION_IDLE_STATE)}
              onRetry={() => undefined}
              onResultAction={() => undefined}
              onViewJson={() => undefined}
            />
            </>
          )}
          </SidePanelBody>
        </ResponsiveSidePanel>
      )}
      <EditorBackdrop
        editor={editor}
        locale={locale}
        returnFocusRef={returnFocusRef}
        showNumbering={designState.settings.headingNumbering}
        showDecoration={designState.settings.headingDecoration}
      />
    </div>
  );
}

function BookScene({ locale, operation }: { locale: Locale; operation: FileFixtureState }) {
  const [chapterPaths, setChapterPaths] = useState(['./intro.sdoc', './reference.sdoc']);
  const [operationState, setOperationState] = useState<FileOperationState>(() => operation === 'succeeded-export'
    ? {
      phase: 'succeeded', requestId: 'book-fixture-result', result: 'fallback',
      intent: { kind: 'export', format: 'pdf' },
      details: {
        outcome: 'fallback',
        artifact: { artifactId: 'artifact-1', displayName: 'system-guide.html', sizeBytes: 4096 },
        warnings: [locale === 'ko'
          ? 'PDF를 사용할 수 없어 HTML 대체 파일을 만들었습니다.'
          : 'PDF is unavailable; an HTML fallback was created.'],
        availableActions: [
          { action: 'open', artifactId: 'artifact-1' },
          { action: 'reveal', artifactId: 'artifact-1' },
          { action: 'copy', artifactId: 'artifact-1' },
          { action: 'repeat' },
        ],
      },
    }
    : FILE_OPERATION_IDLE_STATE);
  const [resultActionState, setResultActionState] = useState<BookResultActionState>(
    BOOK_RESULT_ACTION_IDLE_STATE,
  );
  const publish = useMemo(() => createDefaultSdocBookPublishProfile(), []);
  const composition = useMemo<BookCompositionResult>(() => {
    const documents = chapterPaths.map((chapterPath, index) => ({
      path: chapterPath,
      label: chapterPath.includes('intro')
        ? (locale === 'ko' ? '소개' : 'Introduction')
        : (locale === 'ko' ? '참조' : 'Reference'),
      status: 'ok' as const,
      meta: { settings: index === 0 ? { captionStyle: 'ieee' as const } : {} },
      doc: {
        type: 'doc',
        content: [{
          type: 'heading', attrs: { level: index + 1, id: `chapter-${index}` },
          content: [{ type: 'text', text: index === 0
            ? (locale === 'ko' ? '시스템 소개' : 'System introduction')
            : (locale === 'ko' ? 'API 참조' : 'API reference') }],
        }],
      },
    }));
    return {
      doc: {
        type: 'doc',
        content: documents.flatMap((document) => document.doc.content ?? []),
      },
      meta: { title: locale === 'ko' ? '시스템 가이드' : 'System guide' },
      documents,
      diagnostics: [{
        severity: 'warning',
        code: 'REFERENCE_BROKEN',
        message: locale === 'ko' ? '참조 대상을 확인하세요.' : 'Check the reference target.',
        documentPath: chapterPaths[1],
      }],
      counterResetPaths: [],
    };
  }, [chapterPaths, locale]);
  const state = useMemo(() => createBookWorkspaceReadyState({
    book: {
      sdocBook: '1.1',
      title: locale === 'ko' ? '시스템 가이드' : 'System guide',
      author: locale === 'ko' ? '문서 팀' : 'Documentation team',
      version: '1.0',
      publish,
      documents: chapterPaths.map((chapterPath) => ({ path: chapterPath })),
    },
    composition,
    diagnostics: composition.diagnostics,
    generation: 1,
    revision: chapterPaths.length,
    locale,
  }), [chapterPaths, composition, locale, publish]);
  const callbacks = useMemo<BookWorkspaceCallbacks>(() => ({
    onAddDocument: () => setChapterPaths((current) => [...current, `./chapter-${current.length + 1}.sdoc`]),
    onOpenDocument: () => undefined,
    onMoveDocument: (from, to) => setChapterPaths((current) => {
      const next = [...current];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      return next;
    }),
    onRemoveDocument: (index) => setChapterPaths((current) => current.filter((_entry, candidate) => candidate !== index)),
    onUpdateMeta: () => undefined,
    onRefresh: () => undefined,
    onOpenSource: () => undefined,
    onOpenDiagnostic: () => undefined,
    onSavePublishProfile: () => undefined,
    onExport: (format) => setOperationState({
      phase: 'awaiting-confirmation', requestId: 'book-fixture-request',
      intent: { kind: 'export', format },
      plan: {
        planId: 'book-fixture-plan', intent: { kind: 'export', format },
        source: { displayName: 'system-guide.sdocbook', sizeBytes: 8192, revision: 2 },
        destination: {
          displayName: `system-guide.${format}`, exists: true,
          scope: 'book', relativePath: `./dist/system-guide.${format}`,
        },
        effectiveSettings: {
          fingerprint: `sha256:${'b'.repeat(64)}`,
          items: [
            { key: 'headingNumbering', value: 'true', source: 'book-profile' },
            { key: 'headingDecoration', value: 'true', source: 'book-profile' },
            { key: 'headingH1Color', value: '#2563EB', source: 'book-profile' },
          ],
        },
        diagram: { failurePolicy: 'source-fallback', fallbackCount: 1 },
        warnings: ['The existing destination will be replaced.'],
        requiresConfirmation: true,
      },
    }),
  }), []);
  const fileOperations = useMemo<BookFileOperationAdapter>(() => ({
    prepare: () => undefined,
    execute: (requestId, planId) => setOperationState({
      phase: 'running', requestId, kind: 'export', format: 'html',
      intent: { kind: 'export', format: 'html' }, planId,
      stage: locale === 'ko' ? '불변 Book 스냅샷을 쓰는 중…' : 'Writing immutable Book snapshot…',
    }),
    cancel: (requestId) => setOperationState({
      phase: 'cancelled', requestId, intent: { kind: 'export', format: 'html' },
    }),
    retry: () => undefined,
    resultAction: (requestId, action) => setResultActionState((current) => beginBookResultAction(
      current, requestId, `fixture-action-${action}`, action,
    )),
  }), [locale]);
  const runtime = useMemo(() => ({
    ...NOOP_EDITOR_EXTENSION_RUNTIME,
    translate: createEditorTranslator(locale),
  }), [locale]);

  return <div className="host-frame scene-surface book-fixture" data-scene="book">
    <BookEditorWorkspace
      state={state}
      callbacks={callbacks}
      previewRuntime={runtime}
      operationState={operationState}
      fileOperations={fileOperations}
      resultActionState={resultActionState}
      pending={isFileOperationActive(operationState)}
    />
  </div>;
}

function DiagramErrorScene({ editor, locale }: {
  editor: Editor;
  locale: Locale;
}) {
  const [open, setOpen] = useState(true);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div
      className="host-frame editor-body-layout scene-surface"
      data-scene="diagram-error"
      style={{ height: '100vh', position: 'relative' }}
    >
      <ActivityBar
        activeDestination={null}
        onDestinationClick={() => undefined}
      />
      <EditorBackdrop editor={editor} locale={locale} />
      <button
        ref={openerRef}
        type="button"
        data-testid="diagram-dialog-opener"
        style={{
          position: 'absolute',
          right: '8px',
          bottom: '8px',
          opacity: open ? 0 : 1,
          pointerEvents: open ? 'none' : 'auto',
        }}
        onClick={() => setOpen(true)}
      >
        {locale === 'ko' ? '다이어그램 대화상자 열기' : 'Open diagram dialog'}
      </button>
      {open && (
        <DiagramDialog
          initialCode={'@startuml\nAlice -> Bob: Create report\nBob --> Alice: Renderer unavailable\n@enduml'}
          initialLanguage="plantuml"
          pos={null}
          renderDiagram={DIAGRAM_ERROR_RENDERER}
          rendererSettings={{
            consent: 'granted',
            endpoint: 'https://kroki.io',
            allowPrivateNetwork: false,
          }}
          onConfirm={() => undefined}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function InteractionScene({ editor, locale }: { editor: Editor; locale: Locale }) {
  const [menu, setMenu] = useState<'table' | 'image' | null>(null);
  const [lastAction, setLastAction] = useState('none');
  const tableTriggerRef = useRef<HTMLButtonElement | null>(null);
  const imageTriggerRef = useRef<HTMLButtonElement | null>(null);

  const completeAction = (action: string): void => {
    setLastAction(action);
    setMenu(null);
  };

  return (
    <div className="host-frame interaction-scene" data-scene="interactions">
      <button
        ref={tableTriggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenu('table');
        }}
      >
        {locale === 'ko' ? '표 메뉴 열기' : 'Open table menu'}
      </button>
      <button
        ref={imageTriggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenu('image');
        }}
      >
        {locale === 'ko' ? '이미지 메뉴 열기' : 'Open image menu'}
      </button>
      {menu === 'table' && (
        <TableContextMenu
          editor={editor}
          position={{ x: 24, y: 64 }}
          onClose={() => setMenu(null)}
          onOpenProperties={() => completeAction('table-properties')}
          returnFocusRef={tableTriggerRef}
        />
      )}
      {menu === 'image' && (
        <ImageContextMenu
          position={{ x: 220, y: 64 }}
          onClose={() => setMenu(null)}
          onOpenProperties={() => completeAction('image-properties')}
          onReplaceImage={() => completeAction('image-replace')}
          onCopyPath={() => completeAction('image-copy-path')}
          onDelete={() => completeAction('image-delete')}
          isDrawio={false}
          returnFocusRef={imageTriggerRef}
        />
      )}
      <output data-testid="interaction-action">{lastAction}</output>
    </div>
  );
}

function ExternalChangeScene({ locale }: { locale: Locale }) {
  const t = createEditorTranslator(locale);
  const fallbackFocusRef = useRef<HTMLButtonElement | null>(null);
  const pendingRef = useRef<{
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null>(null);
  const [visible, setVisible] = useState(true);
  const [attempts, setAttempts] = useState(0);

  const runResolution = () => new Promise<void>((resolve, reject) => {
    pendingRef.current = { resolve, reject };
    setAttempts((current) => current + 1);
  }).then(() => {
    pendingRef.current = null;
    setVisible(false);
  }, (error: unknown) => {
    pendingRef.current = null;
    throw error;
  });

  return (
    <div
      className="host-frame scene-surface external-change-scene"
      data-scene="external-change"
      style={{ minHeight: '100vh', position: 'relative' }}
    >
      <button ref={fallbackFocusRef} type="button" data-testid="external-change-fallback">
        {locale === 'ko' ? '편집기로 돌아가기' : 'Return to editor'}
      </button>
      {visible && (
        <ExternalChangePrompt
          isDirty
          onCompare={() => undefined}
          onKeepMine={runResolution}
          onReload={runResolution}
          fallbackFocusRef={fallbackFocusRef}
          labels={{
            message: t('externalChange.message'),
            compare: t('externalChange.compare'),
            keepMine: t('externalChange.keepMine'),
            reload: t('externalChange.reload'),
            keepTitle: t('externalChange.keepMineTitle'),
            reloadTitle: t('externalChange.reloadTitle'),
            keepConfirm: t('externalChange.confirmKeepMine'),
            reloadConfirm: t('externalChange.confirmReload'),
            cancel: t('common.cancel'),
            keepRunning: t('externalChange.keepMineRunning'),
            reloadRunning: t('externalChange.reloadRunning'),
            failure: t('externalChange.resolutionFailed'),
            retry: t('externalChange.retry'),
          }}
        />
      )}
      <output data-testid="external-change-attempts">{attempts}</output>
      <button
        type="button"
        hidden
        data-testid="external-change-resolve"
        onClick={() => pendingRef.current?.resolve()}
      >
        Resolve operation
      </button>
      <button
        type="button"
        hidden
        data-testid="external-change-reject"
        onClick={() => pendingRef.current?.reject(new Error('fixture write failure'))}
      >
        Reject operation
      </button>
    </div>
  );
}

function InvalidDocumentScene({ locale }: { locale: Locale }) {
  const t = createEditorTranslator(locale);
  const [invalid, setInvalid] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const labels = {
    title: t('invalidDocument.title'),
    initial: t('invalidDocument.initialExplanation'),
    external: t('invalidDocument.externalExplanation'),
    open: t('invalidDocument.openJsonSource'),
    retry: t('invalidDocument.retryValidation'),
    recover: t('invalidDocument.recoverLocalDraft'),
    running: t('invalidDocument.recoveryRunning'),
  };

  return (
    <div className="host-frame scene-surface" data-scene="invalid-document">
      <button ref={fallbackRef} type="button" data-testid="invalid-recovery-fallback">
        {locale === 'ko' ? '문서로 돌아가기' : 'Return to document'}
      </button>
      {invalid && (
        <InvalidDocumentNotice
          variant="external"
          diagnostics={[{ path: '/', message: 'invalid JSON' }]}
          labels={labels}
          onOpenSource={() => undefined}
          onRetry={() => undefined}
          canRecover
          recoveryPending={pending}
          recoveryError={error}
          onRecover={() => setConfirming(true)}
        />
      )}
      {confirming && (
        <ModalDialog
          size="md"
          role="alertdialog"
          titleId="fixture-invalid-recovery-title"
          descriptionId="fixture-invalid-recovery-description"
          initialFocusRef={cancelRef}
          fallbackFocusRef={fallbackRef}
          onCancel={() => setConfirming(false)}
        >
          <div className="modal-body">
            <h2 id="fixture-invalid-recovery-title">{t('invalidDocument.recoveryConfirmTitle')}</h2>
            <p id="fixture-invalid-recovery-description">{t('invalidDocument.recoveryConfirmBody')}</p>
          </div>
          <div className="modal-footer">
            <button ref={cancelRef} type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" onClick={() => {
              setConfirming(false);
              setPending(true);
              setError(null);
            }}>
              {t('invalidDocument.recoveryConfirmAction')}
            </button>
          </div>
        </ModalDialog>
      )}
      <button type="button" hidden data-testid="invalid-recovery-resolve" onClick={() => {
        setPending(false);
        setInvalid(false);
      }}>Resolve</button>
      <button type="button" hidden data-testid="invalid-recovery-reject" onClick={() => {
        setPending(false);
        setError(t('invalidDocument.recoveryFailed'));
      }}>Reject</button>
    </div>
  );
}

function useSceneReady(scene: Scene): boolean {
  const [ready, setReady] = useState(scene !== 'diagram-error');

  useEffect(() => {
    if (scene !== 'diagram-error') return undefined;
    const sync = () => {
      if (document.querySelector('.diagram-error')) setReady(true);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scene]);

  return ready;
}

function App() {
  const theme = queryValue('theme', ['light', 'dark', 'hc'] as const, 'light');
  const locale = queryValue('locale', ['ko', 'en'] as const, 'en');
  const scene = queryValue(
    'scene',
    ['editor', 'settings', 'templates', 'files', 'book', 'diagram-error', 'external-change', 'invalid-document', 'interactions'] as const,
    'editor',
  );
  const params = new URLSearchParams(window.location.search);
  const fileFixtureState = queryValue(
    'operation',
    ['idle', 'running', 'failed', 'succeeded-export', 'succeeded-import'] as const,
    'idle',
  );
  const columns = Number(params.get('columns') ?? '8');
  const showPanel = params.get('panel') === '1';
  const editor = useMemo(() => createEditorMock(true), []);
  const ready = useSceneReady(scene);
  const title = locale === 'ko' ? '제품 수준 문서 편집 경험' : 'A production-quality editing experience';

  document.documentElement.lang = locale;
  document.documentElement.dataset.host = 'vscode';
  document.documentElement.dataset.fixtureTheme = theme;
  document.documentElement.dataset.theme = theme === 'hc' ? 'dark' : theme;

  return (
    <EditorProvider initialLocale={locale}>
      <main
        className="quality-harness"
        data-host="vscode"
        data-theme={theme}
        data-ready={ready ? 'true' : 'false'}
      >
        {(scene === 'settings' || scene === 'templates' || scene === 'files') && (
          <SharedPanelScene
            editor={editor}
            locale={locale}
            scene={scene}
            fileFixtureState={fileFixtureState}
          />
        )}
        {scene === 'diagram-error' && (
          <DiagramErrorScene editor={editor} locale={locale} />
        )}
        {scene === 'book' && (
          <BookScene locale={locale} operation={fileFixtureState} />
        )}
        {scene === 'external-change' && (
          <ExternalChangeScene locale={locale} />
        )}
        {scene === 'invalid-document' && (
          <InvalidDocumentScene locale={locale} />
        )}
        {scene === 'interactions' && (
          <InteractionScene editor={editor} locale={locale} />
        )}
        {scene === 'editor' && (
        <div className="host-frame">
          <Toolbar
            editor={editor}
            onInsertDrawio={() => undefined}
            onInsertImage={() => undefined}
            onInsertLink={() => undefined}
            onInsertMath={() => undefined}
            onInsertDiagram={() => undefined}
            onInsertCrossRef={() => undefined}
          />
          <div className="fixture-canvas">
            <DocumentHeader
              author=""
              version=""
              created="2026-07-28T01:23:00.000Z"
              modified="2026-07-28T04:56:00.000Z"
              onAuthorChange={() => undefined}
              onVersionChange={() => undefined}
            />
            <h1 className="fixture-title">{title}</h1>
            <p className="fixture-lede">
              {locale === 'ko'
                ? '반응형 도구 모음, 메타데이터, 표와 테마 대비를 하나의 결정론적 장면에서 검증합니다.'
                : 'This deterministic scene verifies the responsive toolbar, metadata, tables, and theme contrast.'}
            </p>
            <ActualTable columns={Number.isFinite(columns) ? Math.min(Math.max(columns, 3), 15) : 8} locale={locale} />
          </div>
          {showPanel && <PanelFixture locale={locale} />}
          <span className="host-badge" aria-hidden="true">vscode · {theme} · {locale}</span>
        </div>
        )}
      </main>
    </EditorProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
