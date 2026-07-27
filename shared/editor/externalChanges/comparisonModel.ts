import type { ExternalChangeComparisonModel, ExternalChangeComparisonRow, ExternalDocumentDiff } from './types';

export interface ExternalChangeComparisonLabels {
  readonly title?: string;
  readonly mine?: string;
  readonly external?: string;
}

/** Creates a render-ready, read-only side-by-side model from a document diff. */
export const buildExternalChangeComparison = (
  diff: ExternalDocumentDiff,
  labels: ExternalChangeComparisonLabels = {},
): ExternalChangeComparisonModel => {
  const mineLabel = labels.mine ?? 'Mine';
  const externalLabel = labels.external ?? 'On disk';
  const rows = diff.blocks.map((block): ExternalChangeComparisonRow =>
    Object.freeze({
      key: block.key,
      kinds: block.kinds,
      mine: Object.freeze({ label: mineLabel, ...(block.mine ? { block: block.mine } : {}) }),
      external: Object.freeze({
        label: externalLabel,
        ...(block.external ? { block: block.external } : {}),
      }),
    }),
  );

  return Object.freeze({
    title: labels.title ?? 'External document changes',
    summary: diff.summary,
    rows: Object.freeze(rows),
  });
};
