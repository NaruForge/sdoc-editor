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
import {
  EditorI18nProvider,
  useEditorI18n,
  type EditorTranslationKey,
} from '../i18n';

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

const RESULT_ACTION_PENDING: Record<FileOperationResultAction, EditorTranslationKey> = {
  open: 'book.actionPending.open',
  reveal: 'book.actionPending.reveal',
  copy: 'book.actionPending.copy',
  repeat: 'book.actionPending.repeat',
  undo: 'book.actionPending.undo',
};

const RESULT_ACTION_COMPLETED: Record<FileOperationResultAction, EditorTranslationKey> = {
  open: 'book.actionCompleted.open',
  reveal: 'book.actionCompleted.reveal',
  copy: 'book.actionCompleted.copy',
  repeat: 'book.actionCompleted.repeat',
  undo: 'book.actionCompleted.undo',
};

const HEADING_COLOR_KEYS = {
  headingH1Color: 'book.headingH1Color',
  headingH2Color: 'book.headingH2Color',
  headingH3Color: 'book.headingH3Color',
  headingH4Color: 'book.headingH4Color',
  headingH5Color: 'book.headingH5Color',
  headingH6Color: 'book.headingH6Color',
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
  const { t } = useEditorI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const settingLabels: Partial<Record<DocumentSettingKey, string>> = {
    headingNumbering: t('book.operationHeadingNumbering'),
    headingStartNumber: t('book.headingStartNumber'),
    headingDecoration: t('book.headingDecoration'),
    headingH1Color: t('book.headingH1Color'),
    headingH2Color: t('book.headingH2Color'),
    headingH3Color: t('book.headingH3Color'),
    headingH4Color: t('book.headingH4Color'),
    headingH5Color: t('book.headingH5Color'),
    headingH6Color: t('book.headingH6Color'),
    captionStyle: t('book.captionStyle'),
    captionNumbering: t('book.captionNumbering'),
    equationNumbering: t('book.equationNumbering'),
    crossRefIncludeCaption: t('book.crossRefIncludeCaption'),
  };
  const sourceLabels: Record<DocumentSettingSource, string> = {
    document: t('book.sourceDocument'),
    'book-profile': t('book.sourceBook'),
    host: t('book.sourceHost'),
    'built-in': t('book.sourceBuiltIn'),
    'temporary-view': t('book.sourceTemporary'),
  };
  const destinationScopeLabels = {
    document: t('book.destinationDocument'),
    workspace: t('book.destinationWorkspace'),
    book: t('book.destinationBook'),
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
      <h2 id="book-operation-dialog-title">{t('book.confirmExport')}</h2>
      <p id="book-operation-dialog-summary">{state.plan.intent.format.toUpperCase()}</p>
      <dl className="book-operation-summary">
        <div><dt>{t('book.source')}</dt><dd>{state.plan.source.displayName}</dd></div>
        {state.plan.destination && <>
          <div><dt>{t('book.destination')}</dt><dd>{state.plan.destination.displayName}</dd></div>
          {state.plan.destination.scope && <div>
            <dt>{t('book.destinationScope')}</dt>
            <dd>{destinationScopeLabels[state.plan.destination.scope]}</dd>
          </div>}
          {state.plan.destination.relativePath && <div>
            <dt>{t('book.relativePath')}</dt><dd><code>{state.plan.destination.relativePath}</code></dd>
          </div>}
        </>}
      </dl>
      <section aria-labelledby="book-effective-settings-title">
        <h3 id="book-effective-settings-title">{t('book.effectiveSettings')}</h3>
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
        <h3>{t('book.diagramPolicy')}</h3>
        <p>{state.plan.diagram.failurePolicy === 'fail'
          ? t('book.diagramPolicyFail')
          : t('book.diagramPolicyFallback')}</p>
        <p>{state.plan.diagram.fallbackCount === 0
          ? t('book.diagramFallbackNone')
          : state.plan.diagram.fallbackCount === 1
            ? t('book.diagramFallbackOne')
            : t('book.diagramFallbackCount', { count: state.plan.diagram.fallbackCount })}</p>
      </section>}
      {state.plan.warnings.length > 0 && <ul className="book-operation-warnings">
        {state.plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>}
      <div className="book-actions book-operation-dialog-actions">
        <button ref={cancelRef} type="button" className="secondary" onClick={cancel}>
          {t('book.cancelExport')}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={() => adapter.execute(state.requestId, state.plan.planId)}
        >{t('book.exportFile')}</button>
      </div>
    </section>
  </div>;
}

function BookFileOperationCard({
  state,
  adapter,
  resultActionState,
}: {
  state: FileOperationState;
  adapter: BookFileOperationAdapter;
  resultActionState: BookResultActionState;
}) {
  const { t, locale } = useEditorI18n();
  if (state.phase === 'idle') return null;
  if (state.phase === 'awaiting-confirmation') return null;
  const actionPending = resultActionState.pending;
  const actionFeedback = resultActionState.feedback;
  const stage = state.phase === 'preflighting' || state.phase === 'running'
    ? state.stage
    : state.phase === 'failed'
      ? state.error.message
      : state.phase === 'succeeded'
        ? state.result === 'fallback' ? t('book.completedWithFallback') : t('book.completed')
        : state.phase === 'cancelled'
          ? t('book.cancelled')
          : undefined;
  return <section className={`book-operation ${state.phase}`} aria-labelledby="book-operation-title">
    <div className="book-section-heading">
      <div>
        <h2 id="book-operation-title">{t('book.operation')}</h2>
        <p role="status" aria-live="polite">{stage ?? state.phase}</p>
      </div>
      {(state.phase === 'preflighting' || state.phase === 'running') && <button
        type="button"
        onClick={() => adapter.cancel(state.requestId, state.phase === 'running' ? state.planId : undefined)}
      >{t('book.cancelExport')}</button>}
    </div>
    {state.phase === 'failed' && state.error.retryable && <button
      type="button"
      onClick={() => adapter.retry(`book-retry-${Date.now().toString(36)}`, state.requestId)}
    >{t('book.retryExport')}</button>}
    {state.phase === 'succeeded' && state.details && <>
      {state.details.artifact && <p className="book-operation-artifact">
        {state.details.artifact.displayName} · {t('book.bytes', {
          count: state.details.artifact.sizeBytes.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
        })}
      </p>}
      {state.details.warnings.length > 0 && <ul className="book-operation-warnings">
        {state.details.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
      </ul>}
      <div
        className="book-actions book-operation-result-actions"
        aria-busy={Boolean(actionPending)}
      >
      {state.details.availableActions.filter((item) => item.action !== 'undo').map((item) => {
        const label = item.action === 'open' ? t('book.openResult')
          : item.action === 'reveal' ? t('book.revealResult')
            : item.action === 'copy' ? t('book.copyResult')
              : t('book.repeatExport');
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
        {t(RESULT_ACTION_PENDING[actionPending.action])}
      </p>}
      {actionFeedback && <p
        className={`book-operation-action-feedback ${actionFeedback.status}`}
        role={actionFeedback.status === 'failed' ? 'alert' : 'status'}
        aria-live={actionFeedback.status === 'failed' ? 'assertive' : 'polite'}
      >
        {actionFeedback.status === 'failed'
          ? actionFeedback.error?.message ?? 'The result action failed.'
          : t(RESULT_ACTION_COMPLETED[actionFeedback.action])}
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
  const { t } = useEditorI18n();
  const extensions = useMemo(() => createBookPreviewExtensions(runtime), [runtime]);
  const editor = useEditor({
    extensions,
    content: state.preview as JSONContent,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': t('book.preview'),
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

const BookEditorWorkspaceView: React.FC<BookEditorWorkspaceProps> = ({
  state,
  callbacks,
  previewRuntime,
  pending = false,
  operationState,
  fileOperations,
  resultActionState = BOOK_RESULT_ACTION_IDLE_STATE,
}) => {
  const { t } = useEditorI18n();
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
        <h1 id="book-invalid-title">{t('book.invalidTitle')}</h1>
        <p>{t('book.invalidBody')}</p>
        <ul className="book-diagnostics-list">
          {state.diagnostics.map((diagnostic) => <li key={`${diagnostic.index}-${diagnostic.code}`}>
            <code>{diagnostic.code}</code> {diagnostic.message}
          </li>)}
        </ul>
        <div className="book-actions">
          <button type="button" onClick={callbacks.onOpenSource}>{t('book.openSource')}</button>
          <button type="button" onClick={callbacks.onRefresh}>{t('book.retry')}</button>
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
    setChapterAnnouncement(t('book.movedChapter', { label: chapter.label, position: to + 1 }));
    callbacks.onMoveDocument(index, to);
  };
  const removeChapter = (index: number): void => {
    const chapter = state.documents[index];
    if (!chapter) return;
    pendingChapterFocusRef.current = state.documents[index + 1]?.path
      ?? state.documents[index - 1]?.path;
    setChapterAnnouncement(t('book.removedChapter', { label: chapter.label }));
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
        <h1>{state.title || t('book.untitled')}</h1>
      </div>
      <div className="book-actions" role="toolbar" aria-label={t('book.documents')}>
        <button type="button" onClick={callbacks.onAddDocument} disabled={pending}>{t('book.add')}</button>
        <button type="button" className="secondary" onClick={callbacks.onRefresh} disabled={pending}>{t('book.refresh')}</button>
        <button type="button" className="secondary" onClick={(event) => {
          exportTriggerRef.current = event.currentTarget;
          callbacks.onExport('html');
        }} disabled={pending || !state.canExport}>{t('book.exportHtml')}</button>
        <button type="button" className="secondary" onClick={(event) => {
          exportTriggerRef.current = event.currentTarget;
          callbacks.onExport('pdf');
        }} disabled={pending || !state.canExport}>{t('book.exportPdf')}</button>
      </div>
    </header>

    {operationState && fileOperations && <BookFileOperationCard
      state={operationState}
      adapter={fileOperations}
      resultActionState={resultActionState}
    />}

    <section className="book-meta" aria-label="Book metadata">
      {(['title', 'author', 'version'] as const).map((key) => <label key={`${state.revision}-${key}`}>
        <span>{t((
          { title: 'book.title', author: 'book.author', version: 'book.version' } as const
        )[key])}</span>
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
          <h2 id="book-profile-title">{t('book.profile')}</h2>
          {state.exportBlockedReason && <p role="status">
            {state.exportBlockedReason === 'publish-profile-required'
              ? t('book.profileRequired') : t('book.diagnosticsBlocked')}
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
        >{state.bookVersion === '1.0' ? t('book.createProfile') : t('book.saveProfile')}</button>
      </div>
      <div className="book-profile-grid">
        <label><span>{t('book.captionStyle')}</span><select
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
        /><span>{t('book.headingNumbering')}</span></label>
        <label><span>{t('book.headingStartNumber')}</span><input
          type="number" min={0} step={1}
          value={numberDrafts.headingStartNumber}
          aria-invalid={!startNumberValid}
          aria-describedby={!startNumberValid ? 'book-profile-error-heading-start' : undefined}
          onChange={(event) => setNumberDrafts((current) => ({
            ...current, headingStartNumber: event.currentTarget.value,
          }))}
        />{!startNumberValid && <ProfileFieldError
          id="book-profile-error-heading-start" message={t('book.fieldStartError')}
        />}</label>
        <label className="book-checkbox"><input
          type="checkbox"
          checked={profile.settings.headingDecoration}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, headingDecoration: event.currentTarget.checked },
          }))}
        /><span>{t('book.headingDecoration')}</span></label>
        {([1, 2, 3, 4, 5, 6] as const).map((level, index) => {
          const key = `headingH${level}Color` as const;
          const errorId = `book-profile-error-heading-h${level}-color`;
          return <label key={key}><span>{t(HEADING_COLOR_KEYS[key])}</span><input
            value={profile.settings[key]}
            spellCheck={false}
            aria-invalid={!colorValidity[index]}
            aria-describedby={!colorValidity[index] ? errorId : undefined}
            onChange={(event) => setProfile((current) => ({
              ...current,
              settings: { ...current.settings, [key]: event.currentTarget.value },
            }))}
          />{!colorValidity[index] && <ProfileFieldError id={errorId} message={t('book.fieldColorError')} />}</label>;
        })}
        <label><span>{t('book.captionNumbering')}</span><select
          value={profile.settings.captionNumbering}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, captionNumbering: event.currentTarget.value as 'sequential' | 'hierarchical' },
          }))}
        ><option value="sequential">{t('book.sequential')}</option><option value="hierarchical">{t('book.hierarchical')}</option></select></label>
        <label><span>{t('book.equationNumbering')}</span><select
          value={profile.settings.equationNumbering}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, equationNumbering: event.currentTarget.value as 'sequential' | 'hierarchical' },
          }))}
        ><option value="sequential">{t('book.sequential')}</option><option value="hierarchical">{t('book.hierarchical')}</option></select></label>
        <label className="book-checkbox"><input
          type="checkbox"
          checked={profile.settings.crossRefIncludeCaption}
          onChange={(event) => setProfile((current) => ({
            ...current,
            settings: { ...current.settings, crossRefIncludeCaption: event.currentTarget.checked },
          }))}
        /><span>{t('book.crossRefIncludeCaption')}</span></label>
        <label><span>{t('book.htmlEmbedding')}</span><select
          value={profile.html.selfContained}
          onChange={(event) => setProfile((current) => ({
            ...current,
            html: { selfContained: event.currentTarget.value as SdocBookPublishProfileV1['html']['selfContained'] },
          }))}
        >{['none', 'images-only', 'full'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>{t('book.pdfScale')}</span><input
          type="number" min={10} max={200}
          value={numberDrafts.pdfScale}
          aria-invalid={!pdfScaleValid}
          aria-describedby={!pdfScaleValid ? 'book-profile-error-pdf-scale' : undefined}
          onChange={(event) => setNumberDrafts((current) => ({
            ...current, pdfScale: event.currentTarget.value,
          }))}
        />{!pdfScaleValid && <ProfileFieldError
          id="book-profile-error-pdf-scale" message={t('book.fieldScaleError')}
        />}</label>
        <label><span>{t('book.diagramFailure')}</span><select
          value={profile.diagrams.failurePolicy}
          onChange={(event) => setProfile((current) => ({
            ...current,
            diagrams: { failurePolicy: event.currentTarget.value as SdocBookPublishProfileV1['diagrams']['failurePolicy'] },
          }))}
        ><option value="source-fallback">{t('book.sourceFallback')}</option><option value="fail">{t('book.fail')}</option></select></label>
        <label><span>{t('book.cssPath')}</span><input
          value={profile.theme.cssPath ?? ''}
          aria-invalid={!cssPathValid}
          aria-describedby={!cssPathValid ? 'book-profile-error-css-path' : undefined}
          placeholder="./styles/book.css"
          onChange={(event) => setProfile((current) => ({
            ...current,
            theme: { id: 'default-v1', ...(event.currentTarget.value ? { cssPath: event.currentTarget.value } : {}) },
          }))}
        />{!cssPathValid && <ProfileFieldError
          id="book-profile-error-css-path" message={t('book.fieldCssError')}
        />}</label>
        <label><span>{t('book.outputDir')}</span><input
          value={profile.outputDir ?? ''}
          aria-invalid={!outputDirValid}
          aria-describedby={!outputDirValid ? 'book-profile-error-output-dir' : undefined}
          placeholder="./dist"
          onChange={(event) => setProfile((current) => ({
            ...current,
            ...(event.currentTarget.value ? { outputDir: event.currentTarget.value } : { outputDir: undefined }),
          }))}
        />{!outputDirValid && <ProfileFieldError
          id="book-profile-error-output-dir" message={t('book.fieldOutputError')}
        />}</label>
      </div>
      <p className="book-fingerprint"><span>{t('book.fingerprint')}</span> <code>{state.settings.fingerprint}</code></p>
    </section>

    <div className="book-content-grid">
      <aside className="book-sidebar">
        <section aria-labelledby="book-documents-heading">
          <h2 id="book-documents-heading">{t('book.documents')}</h2>
          {state.documents.length === 0 ? <p>{t('book.noDocuments')}</p> : <ol className="book-document-list">
            {state.documents.map((document) => <li
              key={document.path}
              ref={(element) => {
                if (element) chapterRowRefs.current.set(document.path, element);
                else chapterRowRefs.current.delete(document.path);
              }}
              className={`book-document-row ${document.status}`}
              tabIndex={0}
              aria-label={t('book.openChapter', { label: document.label })}
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
                <button type="button" aria-label={`${t('book.moveUp')}: ${document.label}`} disabled={pending || document.index === 0} onClick={() => moveChapter(document.index, document.index - 1)}>↑</button>
                <button type="button" aria-label={`${t('book.moveDown')}: ${document.label}`} disabled={pending || document.index === state.documents.length - 1} onClick={() => moveChapter(document.index, document.index + 1)}>↓</button>
                <button type="button" aria-label={`${t('book.remove')}: ${document.label}`} disabled={pending} onClick={() => removeChapter(document.index)}>×</button>
              </span>
            </li>)}
          </ol>}
        </section>
        <section aria-labelledby="book-outline-heading">
          <h2 id="book-outline-heading">{t('book.outline')}</h2>
          {state.outline.length === 0 ? <p>{t('book.noOutline')}</p> : <ol className="book-outline-list">
            {state.outline.map((item, index) => <li key={`${item.documentPath}-${item.nodeId ?? index}`} style={{ '--book-outline-level': item.level } as React.CSSProperties}>
              <button type="button" onClick={() => callbacks.onOpenDocument(item.documentIndex, item.nodeId)}>{item.title}</button>
            </li>)}
          </ol>}
        </section>
        <section aria-labelledby="book-diagnostics-heading">
          <h2 id="book-diagnostics-heading">{t('book.diagnostics')}</h2>
          {state.diagnostics.length === 0 ? <p>{t('book.noDiagnostics')}</p> : <ul className="book-diagnostics-list">
            {state.diagnostics.map((diagnostic) => <li key={`${diagnostic.index}-${diagnostic.code}`} className={diagnostic.severity}>
              <button type="button" aria-label={t('book.openDiagnostic', { message: diagnostic.message })} onClick={() => callbacks.onOpenDiagnostic(diagnostic.index)}>
                <code>{diagnostic.code}</code><span>{diagnostic.message}</span>
              </button>
            </li>)}
          </ul>}
        </section>
      </aside>
      <section className="book-preview" aria-labelledby="book-preview-heading">
        <h2 id="book-preview-heading">{t('book.preview')}</h2>
        <BookPreview state={state} runtime={previewRuntime} />
      </section>
    </div>
    <p className="sr-only" role="status" aria-live="polite">
      {chapterAnnouncement || (pending ? t('book.operationInProgress') : '')}
    </p>
    </div>
  </main>;
};

export const BookEditorWorkspace: React.FC<BookEditorWorkspaceProps> = (props) => (
  <EditorI18nProvider locale={props.state.locale}>
    <BookEditorWorkspaceView {...props} />
  </EditorI18nProvider>
);
