import React from 'react';
import './externalChanges.css';

export interface ExternalChangeBannerProps {
  readonly isDirty: boolean;
  readonly onCompare: () => void;
  readonly onKeepMine: () => void;
  readonly onReload: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly status?: string;
  readonly error?: string;
  readonly message?: string;
  readonly compareLabel?: string;
  readonly keepMineLabel?: string;
  readonly reloadLabel?: string;
}

/**
 * Non-modal notice for a document that changed outside the current editor.
 * "Keep mine" is intentionally absent when there are no local edits.
 */
export const ExternalChangeBanner: React.FC<ExternalChangeBannerProps> = ({
  isDirty,
  onCompare,
  onKeepMine,
  onReload,
  disabled = false,
  busy = false,
  status,
  error,
  message = 'This document changed outside the editor.',
  compareLabel = 'Compare',
  keepMineLabel = 'Keep mine',
  reloadLabel = 'Reload',
}) => (
  <section
    className="external-change-banner"
    aria-label="External document change"
    aria-busy={busy || undefined}
    data-testid="external-change-banner"
  >
    <div className="external-change-banner__copy">
      <p className="external-change-banner__message">{message}</p>
      {status && (
        <p className="external-change-banner__status" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="external-change-banner__error" role="alert">
          {error}
        </p>
      )}
    </div>
    <div className="external-change-banner__actions">
      <button type="button" className="external-change-action" disabled={disabled} onClick={onCompare}>
        {compareLabel}
      </button>
      {isDirty && (
        <button type="button" className="external-change-action" disabled={disabled} onClick={onKeepMine}>
          {keepMineLabel}
        </button>
      )}
      <button
        type="button"
        className="external-change-action external-change-action--primary"
        disabled={disabled}
        onClick={onReload}
      >
        {reloadLabel}
      </button>
    </div>
  </section>
);
