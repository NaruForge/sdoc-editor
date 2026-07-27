import React from 'react';
import type { ExternalBlockChangeKind, ExternalBlockSnapshot, ExternalChangeComparisonModel } from './types';
import './externalChanges.css';

export interface ExternalChangeComparisonProps {
  readonly model: ExternalChangeComparisonModel;
  readonly onClose: () => void;
  readonly closeLabel?: string;
  readonly emptyMessage?: string;
}

const kindLabel = (kind: ExternalBlockChangeKind): string =>
  ({
    added: 'Added',
    removed: 'Removed',
    changed: 'Changed',
    moved: 'Moved',
  })[kind];

const ComparisonBlock: React.FC<{
  readonly snapshot?: ExternalBlockSnapshot;
  readonly emptyLabel: string;
}> = ({ snapshot, emptyLabel }) => {
  if (!snapshot) {
    return <div className="external-comparison__empty">{emptyLabel}</div>;
  }
  return (
    <div className="external-comparison__block">
      <div className="external-comparison__block-label">{snapshot.label}</div>
      <pre className="external-comparison__preview">{snapshot.preview}</pre>
    </div>
  );
};

/** Read-only, non-modal side-by-side rendering of externally changed blocks. */
export const ExternalChangeComparison: React.FC<ExternalChangeComparisonProps> = ({
  model,
  onClose,
  closeLabel = 'Close comparison',
  emptyMessage = 'The document contents are identical.',
}) => (
  <section className="external-comparison" aria-label={model.title} data-testid="external-change-comparison">
    <header className="external-comparison__header">
      <h2>{model.title}</h2>
      <button type="button" className="external-change-action" onClick={onClose}>
        {closeLabel}
      </button>
    </header>
    {model.rows.length === 0 ? (
      <p className="external-comparison__empty">{emptyMessage}</p>
    ) : (
      <div className="external-comparison__table" role="table" aria-label="Changed blocks">
        <div className="external-comparison__row external-comparison__row--head" role="row">
          <div role="columnheader">Change</div>
          <div role="columnheader">{model.rows[0].mine.label}</div>
          <div role="columnheader">{model.rows[0].external.label}</div>
        </div>
        {model.rows.map((row) => (
          <div className="external-comparison__row" role="row" key={row.key}>
            <div className="external-comparison__kinds" role="cell">
              {row.kinds.map((kind) => (
                <span className={`external-comparison__kind external-comparison__kind--${kind}`} key={kind}>
                  {kindLabel(kind)}
                </span>
              ))}
            </div>
            <div role="cell">
              <ComparisonBlock snapshot={row.mine.block} emptyLabel="Not in mine" />
            </div>
            <div role="cell">
              <ComparisonBlock snapshot={row.external.block} emptyLabel="Not on disk" />
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);
