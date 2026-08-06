import type { DocumentMutation } from '../../persistence/DocumentSyncCoordinator';
import type { ExternalFieldDiff, ExternalMutationDiff, ExternalValueSnapshot } from './types';
import { buildExternalDocumentDiff } from './diff';

const PREVIEW_LIMIT = 4096;

const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
};

const serialize = (value: unknown): string => {
  if (typeof value === 'string') return value;
  const result = JSON.stringify(normalize(value));
  return result === undefined ? String(value) : result;
};

const snapshot = (value: unknown): ExternalValueSnapshot => {
  const serialized = serialize(value);
  const truncated = serialized.length > PREVIEW_LIMIT;
  return Object.freeze({
    preview: truncated ? `${serialized.slice(0, PREVIEW_LIMIT)}…` : serialized,
    truncated,
  });
};

const jsonPointerSegment = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');

const fieldDiffs = (
  mine: Readonly<Record<string, unknown>>,
  external: Readonly<Record<string, unknown>>,
  pathPrefix: string,
): readonly ExternalFieldDiff[] => Object.freeze(
  [...new Set([...Object.keys(mine), ...Object.keys(external)])]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .flatMap((key): ExternalFieldDiff[] => {
      const hasMine = Object.prototype.hasOwnProperty.call(mine, key);
      const hasExternal = Object.prototype.hasOwnProperty.call(external, key);
      if (hasMine && hasExternal && JSON.stringify(normalize(mine[key])) === JSON.stringify(normalize(external[key]))) {
        return [];
      }
      return [Object.freeze({
        key,
        path: `${pathPrefix}/${jsonPointerSegment(key)}`,
        ...(hasMine ? { mine: snapshot(mine[key]) } : {}),
        ...(hasExternal ? { external: snapshot(external[key]) } : {}),
      })];
    }),
);

export const buildExternalMutationDiff = (
  mine: DocumentMutation,
  external: DocumentMutation,
): ExternalMutationDiff => {
  const { settings: _mineSettings, ...mineMeta } = mine.meta;
  const { settings: _externalSettings, ...externalMeta } = external.meta;
  const metadata = fieldDiffs(mineMeta, externalMeta, '/meta');
  const settings = fieldDiffs(
    mine.documentSettings ?? {},
    external.documentSettings ?? {},
    '/meta/settings',
  );
  const content = buildExternalDocumentDiff(mine.content, external.content);
  return Object.freeze({
    hasChanges: metadata.length > 0 || settings.length > 0 || content.hasChanges,
    metadata,
    settings,
    content,
  });
};
