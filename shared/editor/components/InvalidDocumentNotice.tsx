import React from 'react';
import type { ContractDiagnostic } from '../../document/documentContract';

export interface InvalidDocumentNoticeLabels {
  title: string;
  initial: string;
  external: string;
  open: string;
  retry: string;
  recover: string;
  running: string;
  diagnosticsSummary?: string;
  diagnosticsDetails?: string;
}

interface InvalidDocumentNoticeProps {
  variant: 'initial' | 'external';
  diagnostics: readonly ContractDiagnostic[];
  labels: InvalidDocumentNoticeLabels;
  onOpenSource: () => void;
  onRetry: () => void;
  canRecover?: boolean;
  recoveryPending?: boolean;
  recoveryError?: string | null;
  onRecover?: () => void;
}

export const InvalidDocumentNotice: React.FC<InvalidDocumentNoticeProps> = ({
  variant,
  diagnostics,
  labels,
  onOpenSource,
  onRetry,
  canRecover = false,
  recoveryPending = false,
  recoveryError,
  onRecover,
}) => {
  const diagnosticsList = (
    <ul className="invalid-document-diagnostics">
      {diagnostics.map((item, index) => (
        <li key={`${item.path}-${index}`}><code>{item.path}</code>: {item.message}</li>
      ))}
    </ul>
  );

  if (variant === 'initial') {
    return (
      <main className="editor-shell invalid-document-shell">
        <section className="invalid-document-panel" role="alert" aria-labelledby="invalid-document-title">
          <h1 id="invalid-document-title">{labels.title}</h1>
          <p>{labels.initial}</p>
          {diagnosticsList}
          <div className="invalid-document-actions">
            <button type="button" onClick={onOpenSource}>{labels.open}</button>
            <button type="button" onClick={onRetry}>{labels.retry}</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <section className="invalid-document-banner">
      <div className="invalid-document-banner-copy">
        <div role="alert" aria-live="assertive">
        <strong>{labels.title}</strong>
        <span>{labels.external}</span>
        {recoveryError && <span className="invalid-document-error">{recoveryError}</span>}
        </div>
        {diagnostics.length > 0 && (
          <details className="invalid-document-details">
            <summary aria-label={labels.diagnosticsDetails ?? labels.title}>
              {(labels.diagnosticsSummary ?? `${diagnostics.length} validation issues`)
                .replace('{{count}}', String(diagnostics.length))}
            </summary>
            {diagnosticsList}
          </details>
        )}
      </div>
      <div className="invalid-document-actions">
        <button type="button" onClick={onOpenSource}>{labels.open}</button>
        <button type="button" onClick={onRetry}>{labels.retry}</button>
        {canRecover && onRecover && (
          <button type="button" disabled={recoveryPending} onClick={onRecover}>
            {recoveryPending ? labels.running : labels.recover}
          </button>
        )}
      </div>
    </section>
  );
};
