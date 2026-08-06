import type {
  ExternalChangeComparisonModel,
  ExternalChangeComparisonRow,
  ExternalDocumentDiff,
  ExternalFieldComparisonRow,
  ExternalFieldDiff,
  ExternalMutationDiff,
} from './types';

export interface ExternalChangeComparisonLabels {
  readonly title?: string;
  readonly mine?: string;
  readonly external?: string;
}

/** Creates a render-ready, read-only side-by-side model from a document diff. */
export const buildExternalChangeComparison = (
  diff: ExternalDocumentDiff | ExternalMutationDiff,
  labels: ExternalChangeComparisonLabels = {},
): ExternalChangeComparisonModel => {
  const mineLabel = labels.mine ?? 'Mine';
  const externalLabel = labels.external ?? 'On disk';
  const content = 'content' in diff ? diff.content : diff;
  const fieldRows = (fields: readonly ExternalFieldDiff[]): readonly ExternalFieldComparisonRow[] =>
    Object.freeze(fields.map((field) => Object.freeze({
      key: field.key,
      path: field.path,
      mine: Object.freeze({ label: mineLabel, ...(field.mine ? { value: field.mine } : {}) }),
      external: Object.freeze({
        label: externalLabel,
        ...(field.external ? { value: field.external } : {}),
      }),
    })));
  const rows = content.blocks.map((block): ExternalChangeComparisonRow =>
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
    summary: content.summary,
    rows: Object.freeze(rows),
    metadata: fieldRows('metadata' in diff ? diff.metadata : []),
    settings: fieldRows('settings' in diff ? diff.settings : []),
  });
};
