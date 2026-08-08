import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FilesPanel } from '../shared/editor/components/FilesPanel';
import { EditorI18nProvider } from '../shared/editor/i18n';
import {
  FILE_OPERATION_IDLE_STATE,
  createFileOperationError,
  type FileOperationState,
} from '../shared/editor/fileOperations';

const renderPanel = (
  operationState: FileOperationState = FILE_OPERATION_IDLE_STATE,
  locale: 'en' | 'ko' = 'en',
) => renderToStaticMarkup(
  <EditorI18nProvider locale={locale}>
    <FilesPanel
      exportFormats={[
        { format: 'html', available: true },
        {
          format: 'pdf',
          available: false,
          unavailableReason: locale === 'ko'
            ? '이 호스트에서는 PDF 내보내기를 사용할 수 없습니다.'
            : 'PDF export is not available in this host.',
        },
      ]}
      importFormats={[
        { format: 'markdown', available: true },
      ]}
      operationState={operationState}
      onStart={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onRetry={vi.fn()}
      onResultAction={vi.fn()}
      onViewJson={vi.fn()}
    />
  </EditorI18nProvider>,
);

describe('files panel UI', () => {
  it('renders descriptive whole-row actions and an explicit disabled reason', () => {
    const markup = renderPanel();

    expect(markup).toContain('file-operation-row');
    expect(markup).toContain('HTML');
    expect(markup).toContain('.html');
    expect(markup).toContain('Web page for sharing or publishing.');
    expect(markup).toContain('PDF export is not available in this host.');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Unavailable:');
  });

  it('keeps JSON source inside a collapsed Advanced disclosure', () => {
    const markup = renderPanel();

    expect(markup).toContain('<details class="files-panel-advanced">');
    expect(markup).toContain('<summary>Advanced</summary>');
    expect(markup).toContain('JSON source');
    expect(markup).not.toContain('<details class="files-panel-advanced" open="">');
  });

  it('announces running and fallback success states', () => {
    const request = {
      requestId: 'request-1',
      kind: 'export' as const,
      format: 'html',
      stage: 'Exporting HTML…',
    };
    const running = renderPanel({ phase: 'running', ...request });
    const fallback = renderPanel({
      phase: 'succeeded',
      requestId: 'request-1',
      result: 'fallback',
    });

    expect(running).toContain('aria-busy="true"');
    expect(running).toContain('role="status"');
    expect(running).toContain('Exporting HTML');
    expect(fallback).toContain('is-warning');
    expect(fallback).toContain('Completed with fallback.');
  });

  it('uses an alert for failures and exposes cancellation status', () => {
    const request = {
      requestId: 'request-1',
    };
    const failed = renderPanel({
      phase: 'failed',
      ...request,
      error: createFileOperationError('INVALID_INPUT', 'The selected file is invalid.'),
    });
    const cancelled = renderPanel({
      phase: 'cancelled',
      ...request,
    });

    expect(failed).toContain('role="alert"');
    expect(failed).toContain('aria-live="assertive"');
    expect(failed).toContain('The selected file is invalid.');
    expect(cancelled).toContain('is-cancelled');
    expect(cancelled).toContain('File operation cancelled.');
  });

  it('renders a cancel-first preflight alertdialog with overwrite and import preview details', () => {
    const exportMarkup = renderPanel({
      phase: 'awaiting-confirmation',
      requestId: 'request-1',
      intent: { kind: 'export', format: 'html' },
      plan: {
        planId: 'plan-1',
        intent: { kind: 'export', format: 'html' },
        source: { displayName: 'report.sdoc', sizeBytes: 512, revision: 7 },
        destination: {
          displayName: 'report.html',
          exists: true,
          scope: 'workspace',
          relativePath: './dist/report.html',
        },
        effectiveSettings: {
          fingerprint: `sha256:${'a'.repeat(64)}`,
          items: [
            { key: 'selfContained', value: 'images-only', source: 'document' },
            { key: 'headingNumbering', value: 'true', source: 'built-in' },
          ],
        },
        diagram: { failurePolicy: 'source-fallback', fallbackCount: 2 },
        warnings: ['The existing destination will be replaced.'],
        requiresConfirmation: true,
      },
    });
    expect(exportMarkup).toContain('role="alertdialog"');
    expect(exportMarkup).toContain('report.html');
    expect(exportMarkup).toContain('Existing file will be replaced');
    expect(exportMarkup.indexOf('Cancel')).toBeLessThan(exportMarkup.indexOf('Export file'));
    expect(exportMarkup).toContain('Workspace');
    expect(exportMarkup).toContain('./dist/report.html');
    expect(exportMarkup).toContain('HTML embedding');
    expect(exportMarkup).toContain('images-only');
    expect(exportMarkup).toContain('Stored in document');
    expect(exportMarkup).toContain('Product default');
    expect(exportMarkup).toContain('Keep diagram source when rendering is unavailable.');
    expect(exportMarkup).toContain('2 diagram fallbacks');
    expect(exportMarkup).toContain(`sha256:${'a'.repeat(64)}`);
    expect(exportMarkup).not.toContain('Effective document settings snapshot');

    const importMarkup = renderPanel({
      phase: 'awaiting-confirmation',
      requestId: 'request-2',
      intent: { kind: 'import', format: 'markdown' },
      plan: {
        planId: 'plan-2',
        intent: { kind: 'import', format: 'markdown' },
        source: { displayName: 'source.md', sizeBytes: 128 },
        importPreview: {
          outline: [{ level: 1, title: 'Overview' }],
          topLevelBlockCount: 4,
          replacement: 'body-only',
          preserved: ['metadata', 'settings'],
        },
        warnings: [],
        requiresConfirmation: true,
      },
    });
    expect(importMarkup).toContain('Overview');
    expect(importMarkup).toContain('4 top-level blocks');
    expect(importMarkup).toContain('Metadata and settings will be preserved');
  });

  it('exposes cancel, retry, and artifact result actions', () => {
    const running = renderPanel({
      phase: 'running', requestId: 'request-1', kind: 'export', format: 'html',
      intent: { kind: 'export', format: 'html' }, planId: 'plan-1', stage: 'Rendering…',
    });
    const failed = renderPanel({
      phase: 'failed', requestId: 'request-1',
      intent: { kind: 'export', format: 'html' },
      error: createFileOperationError('STALE_TARGET', 'The destination changed.', true),
    });
    const succeeded = renderPanel({
      phase: 'succeeded', requestId: 'request-1', result: 'completed',
      intent: { kind: 'export', format: 'html' },
      details: {
        outcome: 'completed', warnings: [],
        artifact: { artifactId: 'artifact-1', displayName: 'report.html', sizeBytes: 1024 },
        availableActions: [
          { action: 'open', artifactId: 'artifact-1' },
          { action: 'reveal', artifactId: 'artifact-1' },
          { action: 'copy', artifactId: 'artifact-1' },
          { action: 'repeat' },
        ],
      },
    });
    expect(running).toContain('Cancel operation');
    expect(failed).toContain('Retry');
    expect(succeeded).toContain('report.html');
    expect(succeeded).toContain('Open');
    expect(succeeded).toContain('Reveal');
    expect(succeeded).toContain('Copy path');
    expect(succeeded).toContain('Repeat');

    const imported = renderPanel({
      phase: 'succeeded', requestId: 'request-2', result: 'completed',
      intent: { kind: 'import', format: 'markdown' },
      details: { outcome: 'completed', warnings: [], availableActions: [] },
    });
    expect(imported).toContain('Imported body applied to the editor buffer.');
    expect(imported).toContain('Save the document to write this change to disk.');
    expect(imported).not.toContain('Saved to disk');
  });

  it('localizes descriptions, statuses, disclosure labels, and availability text in Korean', () => {
    const idle = renderPanel(FILE_OPERATION_IDLE_STATE, 'ko');
    const fallback = renderPanel({
      phase: 'succeeded',
      requestId: 'request-1',
      result: 'fallback',
    }, 'ko');
    const cancelled = renderPanel({
      phase: 'cancelled',
      requestId: 'request-1',
    }, 'ko');

    expect(idle).toContain('공유하거나 게시할 웹 페이지입니다.');
    expect(idle).toContain('<summary>고급</summary>');
    expect(idle).toContain('사용 불가: 이 호스트에서는 PDF 내보내기를 사용할 수 없습니다.');
    expect(idle).toContain('구조화된 문서 원본을 확인합니다.');
    expect(idle).not.toContain('Web page for sharing or publishing.');
    expect(fallback).toContain('대체 방식으로 완료했습니다.');
    expect(cancelled).toContain('파일 작업이 취소되었습니다.');
  });
});
