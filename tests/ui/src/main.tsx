import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { DiagramDialog } from '@shared/editor/components/DiagramDialog';
import { DocumentSettingsPanel } from '@shared/editor/components/DocumentSettingsPanel';
import { DocumentHeader } from '@shared/editor/components/DocumentHeader';
import {
  FilesPanel,
  type FileExportFormat,
  type FileImportFormat,
  type FileFormatCapability,
} from '@shared/editor/components/FilesPanel';
import { ResponsiveSidePanel } from '@shared/editor/components/ResponsiveSidePanel';
import { TemplatePanel } from '@shared/editor/components/TemplatePanel';
import { Toolbar } from '@shared/editor/components/Toolbar';
import { EditorProvider } from '@shared/editor/context/EditorContext';
import {
  DiagramRenderError,
  type HostDiagramRenderer,
} from '@shared/editor/diagram';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '@shared/editor/extensionRuntime';
import { CustomTable } from '@shared/editor/extensions/CustomTable';
import { ExternalChangePrompt } from '@shared/editor/externalChanges';
import { FILE_OPERATION_IDLE_STATE } from '@shared/editor/fileOperations';
import { createEditorTranslator } from '@shared/editor/i18n';
import type { ManagedTemplateDescriptor } from '@shared/types/messages';
import '../../../tauri-app/src/styles/tauri-theme.css';
import '@shared/editor/styles/editor.css';
import './harness.css';

type Host = 'vscode' | 'tauri';
type Theme = 'light' | 'dark' | 'hc';
type Locale = 'ko' | 'en';
type Scene = 'editor' | 'settings' | 'templates' | 'files' | 'diagram-error' | 'external-change';

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

const EXPORT_FIXTURES: readonly FileFormatCapability<FileExportFormat>[] = [
  { format: 'html', available: true },
  { format: 'pdf', available: true },
  { format: 'markdown', available: true },
  { format: 'adoc', available: true },
  {
    format: 'slides',
    available: false,
    unavailableReason: 'Slides export requires the desktop presentation runtime.',
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
      <button ref={returnFocusRef} type="button" data-testid="panel-return-target">Background action</button>
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
}: {
  editor: Editor;
  locale: Locale;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
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
        <div className="fixture-canvas">
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
  host,
  locale,
  scene,
}: {
  editor: Editor;
  host: Host;
  locale: Locale;
  scene: Exclude<Scene, 'editor' | 'diagram-error' | 'external-change'>;
}) {
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  const title = scene === 'settings'
    ? (locale === 'ko' ? '문서 설정' : 'Document settings')
    : scene === 'templates'
      ? (locale === 'ko' ? '템플릿' : 'Templates')
      : (locale === 'ko' ? '파일' : 'Files');
  const destination: ActivityDestination = scene === 'settings' ? 'design' : 'publish';

  return (
    <div
      className="host-frame editor-body-layout scene-surface"
      data-scene={scene}
      style={{ height: '100vh', position: 'relative' }}
    >
      <ActivityBar
        activeDestination={destination}
        onDestinationClick={() => undefined}
        showWorkspace={host === 'tauri'}
      />
      {open && (
        <ResponsiveSidePanel
          title={title}
          closeLabel={locale === 'ko' ? `${title} 패널 닫기` : `Close ${title.toLowerCase()} panel`}
          onClose={() => setOpen(false)}
          returnFocusRef={returnFocusRef}
        >
          {scene === 'settings' && (
            <DocumentSettingsPanel onUpdateSettings={() => undefined} />
          )}
          {scene === 'templates' && (
            <TemplatePanel
              templates={TEMPLATE_FIXTURES}
              diagnostics={[{
                id: 'workspace-readable-diagnostic',
                code: 'read-failed',
                source: 'workspace',
                severity: 'warning',
                targetLabel: 'legacy-report.sdoc',
                detail: 'One workspace template could not be read.',
                recovery: 'retry',
              }]}
              isApplying={false}
              isManaging={false}
              personalRootScope={host === 'vscode' ? 'remote' : 'local'}
              onApply={() => undefined}
              onRefresh={() => undefined}
              onSaveCurrent={() => undefined}
              onEdit={() => undefined}
              onDuplicate={() => undefined}
              onDelete={() => undefined}
              onOpenPersonalFolder={() => undefined}
            />
          )}
          {scene === 'files' && (
            <FilesPanel
              exportFormats={EXPORT_FIXTURES}
              importFormats={IMPORT_FIXTURES}
              operationState={FILE_OPERATION_IDLE_STATE}
              onStart={() => undefined}
              onViewJson={() => undefined}
            />
          )}
        </ResponsiveSidePanel>
      )}
      <EditorBackdrop editor={editor} locale={locale} returnFocusRef={returnFocusRef} />
    </div>
  );
}

function DiagramErrorScene({ editor, host, locale }: {
  editor: Editor;
  host: Host;
  locale: Locale;
}) {
  return (
    <div
      className="host-frame editor-body-layout scene-surface"
      data-scene="diagram-error"
      style={{ height: '100vh', position: 'relative' }}
    >
      <ActivityBar
        activeDestination={null}
        onDestinationClick={() => undefined}
        showWorkspace={host === 'tauri'}
      />
      <EditorBackdrop editor={editor} locale={locale} />
      <DiagramDialog
        initialCode={'@startuml\nAlice -> Bob: Create report\nBob --> Alice: Renderer unavailable\n@enduml'}
        initialLanguage="plantuml"
        pos={null}
        renderDiagram={DIAGRAM_ERROR_RENDERER}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
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
  const host = queryValue('host', ['vscode', 'tauri'] as const, 'vscode');
  const theme = queryValue('theme', ['light', 'dark', 'hc'] as const, 'light');
  const locale = queryValue('locale', ['ko', 'en'] as const, 'en');
  const scene = queryValue(
    'scene',
    ['editor', 'settings', 'templates', 'files', 'diagram-error', 'external-change'] as const,
    'editor',
  );
  const params = new URLSearchParams(window.location.search);
  const columns = Number(params.get('columns') ?? '8');
  const showPanel = params.get('panel') === '1';
  const editor = useMemo(() => createEditorMock(true), []);
  const ready = useSceneReady(scene);
  const title = locale === 'ko' ? '제품 수준 문서 편집 경험' : 'A production-quality editing experience';

  document.documentElement.lang = locale;
  document.documentElement.dataset.theme = theme === 'hc' ? 'dark' : theme;

  return (
    <EditorProvider initialLocale={locale}>
      <main
        className="quality-harness"
        data-host={host}
        data-theme={theme}
        data-ready={ready ? 'true' : 'false'}
      >
        {(scene === 'settings' || scene === 'templates' || scene === 'files') && (
          <SharedPanelScene editor={editor} host={host} locale={locale} scene={scene} />
        )}
        {scene === 'diagram-error' && (
          <DiagramErrorScene editor={editor} host={host} locale={locale} />
        )}
        {scene === 'external-change' && (
          <ExternalChangeScene locale={locale} />
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
          <span className="host-badge" aria-hidden="true">{host} · {theme} · {locale}</span>
        </div>
        )}
      </main>
    </EditorProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
