import React, { useMemo, useState } from 'react';
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
import { DocumentHeader } from '@shared/editor/components/DocumentHeader';
import { ResponsiveSidePanel } from '@shared/editor/components/ResponsiveSidePanel';
import { Toolbar } from '@shared/editor/components/Toolbar';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '@shared/editor/extensionRuntime';
import { CustomTable } from '@shared/editor/extensions/CustomTable';
import { createEditorTranslator, EditorI18nProvider } from '@shared/editor/i18n';
import '../../../tauri-app/src/styles/tauri-theme.css';
import '@shared/editor/styles/editor.css';
import './harness.css';

type Host = 'vscode' | 'tauri';
type Theme = 'light' | 'dark' | 'hc';
type Locale = 'ko' | 'en';

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
  if (!open) return <button type="button" data-testid="panel-return-target">Background action</button>;
  return (
    <>
      <button type="button" data-testid="panel-background-action">Background action</button>
      <ResponsiveSidePanel
        title={locale === 'ko' ? '문서 설정' : 'Document settings'}
        closeLabel={locale === 'ko' ? '문서 패널 닫기' : 'Close document panel'}
        onClose={() => setOpen(false)}
      >
        <button type="button">First panel action</button>
        <button type="button">Last panel action</button>
      </ResponsiveSidePanel>
    </>
  );
}

function App() {
  const host = queryValue('host', ['vscode', 'tauri'] as const, 'vscode');
  const theme = queryValue('theme', ['light', 'dark', 'hc'] as const, 'light');
  const locale = queryValue('locale', ['ko', 'en'] as const, 'en');
  const params = new URLSearchParams(window.location.search);
  const columns = Number(params.get('columns') ?? '8');
  const showPanel = params.get('panel') === '1';
  const editor = useMemo(() => createEditorMock(true), []);
  const title = locale === 'ko' ? '제품 수준 문서 편집 경험' : 'A production-quality editing experience';

  document.documentElement.lang = locale;
  document.documentElement.dataset.theme = theme === 'hc' ? 'dark' : theme;

  return (
    <EditorI18nProvider locale={locale}>
      <main className="quality-harness" data-host={host} data-theme={theme}>
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
      </main>
    </EditorI18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
