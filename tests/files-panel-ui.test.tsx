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
