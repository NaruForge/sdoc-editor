import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  InvalidDocumentNotice,
  type InvalidDocumentNoticeLabels,
} from '../shared/editor/components/InvalidDocumentNotice';

const labels: InvalidDocumentNoticeLabels = {
  title: 'Invalid document source',
  initial: 'The source is invalid.',
  external: 'The external source became invalid.',
  open: 'Open JSON source',
  retry: 'Retry validation',
  recover: 'Recover from local draft',
  running: 'Recovering…',
};

describe('invalid document UX', () => {
  it('shows bounded diagnostics and source recovery actions without an editor', () => {
    const markup = renderToStaticMarkup(
      <InvalidDocumentNotice
        variant="initial"
        diagnostics={[{ path: '/doc', message: 'must be object' }]}
        labels={labels}
        onOpenSource={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('<code>/doc</code>: must be object');
    expect(markup).toContain('Open JSON source');
    expect(markup).toContain('Retry validation');
    expect(markup).not.toContain('contenteditable');
  });

  it('keeps the local-draft recovery action visibly pending', () => {
    const markup = renderToStaticMarkup(
      <InvalidDocumentNotice
        variant="external"
        diagnostics={[{ path: '/', message: 'invalid JSON' }]}
        labels={labels}
        onOpenSource={() => undefined}
        onRetry={() => undefined}
        canRecover
        recoveryPending
        recoveryError="Recovery failed"
        onRecover={() => undefined}
      />,
    );

    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('Recovery failed');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Recovering…');
  });
});
