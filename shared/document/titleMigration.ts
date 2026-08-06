import type { SdocEnvelope, TiptapNode } from '../types';
import { walkDocument } from './walker';

const LEGACY_TITLE_NODE_ID = 'document-title';

export interface LegacyTitleCandidate {
  path: readonly number[];
  id?: string;
  text: string;
  level?: number;
  numbered?: boolean | null;
  plainUnmarked: boolean;
  matchesMetaTitle: boolean;
  matchesLegacyAttributes: boolean;
}

export type LegacyTitleMigrationAnalysis =
  | { kind: 'none'; candidates: readonly [] }
  | { kind: 'ambiguous'; candidates: readonly LegacyTitleCandidate[] }
  | { kind: 'auto-remove'; candidate: LegacyTitleCandidate };

export interface LegacyTitleMigrationResult {
  envelope: SdocEnvelope;
  analysis: LegacyTitleMigrationAnalysis;
  migrated: boolean;
}

type TitleMigrationEnvelope = Pick<SdocEnvelope, 'meta' | 'doc'>;

const nodeText = (node: TiptapNode): string => (node.content ?? []).map((child) => child.text ?? '').join('');

const isPlainUnmarkedHeading = (node: TiptapNode): boolean => {
  const content = node.content ?? [];
  return (
    content.length > 0 &&
    content.every(
      (child) =>
        child.type === 'text' &&
        typeof child.text === 'string' &&
        (child.marks === undefined || child.marks.length === 0),
    )
  );
};

const hasExactLegacyAttributes = (node: TiptapNode): boolean => {
  if (!node.attrs) return false;
  const keys = Object.keys(node.attrs).sort();
  return (
    keys.length === 3 &&
    keys[0] === 'id' &&
    keys[1] === 'level' &&
    keys[2] === 'numbered' &&
    node.attrs.level === 1 &&
    node.attrs.id === LEGACY_TITLE_NODE_ID &&
    node.attrs.numbered === false
  );
};

/**
 * Inspect possible duplicate body-title headings without mutating the envelope.
 * Only the exact historical built-in shape is safe for automatic removal.
 */
export function analyzeLegacyTitleMigration(envelope: TitleMigrationEnvelope): LegacyTitleMigrationAnalysis {
  const metaTitle = typeof envelope.meta.title === 'string' ? envelope.meta.title : undefined;
  const candidates: LegacyTitleCandidate[] = [];

  for (const { node, path } of walkDocument(envelope.doc)) {
    if (node.type !== 'heading') continue;
    const text = nodeText(node);
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : undefined;
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : undefined;
    const numbered =
      typeof node.attrs?.numbered === 'boolean' || node.attrs?.numbered === null ? node.attrs.numbered : undefined;
    const matchesMetaTitle = metaTitle !== undefined && text === metaTitle;
    if (id !== LEGACY_TITLE_NODE_ID && !matchesMetaTitle) continue;
    candidates.push({
      path: [...path],
      ...(id === undefined ? {} : { id }),
      text,
      ...(level === undefined ? {} : { level }),
      ...(numbered === undefined ? {} : { numbered }),
      plainUnmarked: isPlainUnmarkedHeading(node),
      matchesMetaTitle,
      matchesLegacyAttributes: hasExactLegacyAttributes(node),
    });
  }

  if (candidates.length === 0) return { kind: 'none', candidates: [] };
  const candidate = candidates[0]!;
  if (
    candidates.length === 1 &&
    candidate.path.length === 1 &&
    candidate.path[0] === 0 &&
    candidate.plainUnmarked &&
    candidate.matchesMetaTitle &&
    candidate.matchesLegacyAttributes
  ) {
    return { kind: 'auto-remove', candidate };
  }
  return { kind: 'ambiguous', candidates };
}

/** Apply the conservative title migration to an in-memory clone boundary. */
export function applyLegacyTitleMigration(envelope: SdocEnvelope): LegacyTitleMigrationResult {
  const analysis = analyzeLegacyTitleMigration(envelope);
  if (analysis.kind !== 'auto-remove') {
    return { envelope, analysis, migrated: false };
  }
  return {
    envelope: {
      ...envelope,
      doc: {
        ...envelope.doc,
        content: (envelope.doc.content ?? []).slice(1),
      },
    },
    analysis,
    migrated: true,
  };
}
