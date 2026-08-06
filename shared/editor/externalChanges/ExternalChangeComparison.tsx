import React from 'react';
import type {
  ExternalBlockChangeKind,
  ExternalBlockSnapshot,
  ExternalChangeComparisonModel,
  ExternalFieldComparisonRow,
} from './types';
import './externalChanges.css';

export interface ExternalChangeComparisonProps {
  readonly model: ExternalChangeComparisonModel;
  readonly onClose: () => void;
  readonly closeLabel?: string;
  readonly emptyMessage?: string;
  readonly labels?: Partial<{
    metadata: string;
    settings: string;
    body: string;
    field: string;
    change: string;
    changedBlocks: string;
    notInMine: string;
    notOnDisk: string;
    added: string;
    removed: string;
    changed: string;
    moved: string;
    truncated: string;
  }>;
}

const kindLabel = (kind: ExternalBlockChangeKind, labels: ExternalChangeComparisonProps['labels']): string =>
  ({
    added: labels?.added ?? 'Added',
    removed: labels?.removed ?? 'Removed',
    changed: labels?.changed ?? 'Changed',
    moved: labels?.moved ?? 'Moved',
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

const FieldSection: React.FC<{
  title: string;
  rows: readonly ExternalFieldComparisonRow[];
  labels?: ExternalChangeComparisonProps['labels'];
}> = ({ title, rows, labels }) => {
  if (rows.length === 0) return null;
  return (
    <section className="external-comparison__section">
      <h3>{title}</h3>
      <div className="external-comparison__table" role="table" aria-label={title}>
        <div className="external-comparison__row external-comparison__row--head" role="row">
          <div role="columnheader">{labels?.field ?? 'Field'}</div>
          <div role="columnheader">{rows[0].mine.label}</div>
          <div role="columnheader">{rows[0].external.label}</div>
        </div>
        {rows.map((row) => (
          <div className="external-comparison__row" role="row" key={row.path}>
            <div className="external-comparison__field" role="rowheader"><code>{row.path}</code></div>
            <div role="cell"><pre className="external-comparison__preview">{row.mine.value?.preview ?? (labels?.notInMine ?? 'Not in mine')}</pre>{row.mine.value?.truncated && <span>{labels?.truncated ?? 'Preview truncated'}</span>}</div>
            <div role="cell"><pre className="external-comparison__preview">{row.external.value?.preview ?? (labels?.notOnDisk ?? 'Not on disk')}</pre>{row.external.value?.truncated && <span>{labels?.truncated ?? 'Preview truncated'}</span>}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

/** Read-only, non-modal side-by-side rendering of externally changed blocks. */
export const ExternalChangeComparison: React.FC<ExternalChangeComparisonProps> = ({
  model,
  onClose,
  closeLabel = 'Close comparison',
  emptyMessage = 'The document contents are identical.',
  labels,
}) => (
  <section className="external-comparison" aria-label={model.title} data-testid="external-change-comparison">
    <header className="external-comparison__header">
      <h2>{model.title}</h2>
      <button type="button" className="external-change-action" onClick={onClose}>
        {closeLabel}
      </button>
    </header>
    {model.rows.length === 0 && model.metadata.length === 0 && model.settings.length === 0 ? (
      <p className="external-comparison__empty">{emptyMessage}</p>
    ) : (
      <>
      <FieldSection title={labels?.metadata ?? 'Metadata'} rows={model.metadata} labels={labels} />
      <FieldSection title={labels?.settings ?? 'Document settings'} rows={model.settings} labels={labels} />
      {model.rows.length > 0 && <section className="external-comparison__section">
      <h3>{labels?.body ?? 'Body'}</h3>
      <div className="external-comparison__table" role="table" aria-label={labels?.changedBlocks ?? 'Changed blocks'}>
        <div className="external-comparison__row external-comparison__row--head" role="row">
          <div role="columnheader">{labels?.change ?? 'Change'}</div>
          <div role="columnheader">{model.rows[0].mine.label}</div>
          <div role="columnheader">{model.rows[0].external.label}</div>
        </div>
        {model.rows.map((row) => (
          <div className="external-comparison__row" role="row" key={row.key}>
            <div className="external-comparison__kinds" role="cell">
              {row.kinds.map((kind) => (
                <span className={`external-comparison__kind external-comparison__kind--${kind}`} key={kind}>
                  {kindLabel(kind, labels)}
                </span>
              ))}
            </div>
            <div role="cell">
              <ComparisonBlock snapshot={row.mine.block} emptyLabel={labels?.notInMine ?? 'Not in mine'} />
            </div>
            <div role="cell">
              <ComparisonBlock snapshot={row.external.block} emptyLabel={labels?.notOnDisk ?? 'Not on disk'} />
            </div>
          </div>
        ))}
      </div>
      </section>}
      </>
    )}
  </section>
);
