import React from 'react';
import './externalChanges.css';

export interface ExternalChangeBannerProps {
  readonly isDirty: boolean;
  readonly onCompare: () => void;
  readonly onKeepMine: () => void;
  readonly onReload: () => void;
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
  message = 'This document changed outside the editor.',
  compareLabel = 'Compare',
  keepMineLabel = 'Keep mine',
  reloadLabel = 'Reload',
}) => (
  <section
    className="external-change-banner"
    aria-label="External document change"
    data-testid="external-change-banner"
  >
    <p className="external-change-banner__message">{message}</p>
    <div className="external-change-banner__actions">
      <button type="button" className="external-change-action" onClick={onCompare}>
        {compareLabel}
      </button>
      {isDirty && (
        <button type="button" className="external-change-action" onClick={onKeepMine}>
          {keepMineLabel}
        </button>
      )}
      <button type="button" className="external-change-action external-change-action--primary" onClick={onReload}>
        {reloadLabel}
      </button>
    </div>
  </section>
);
