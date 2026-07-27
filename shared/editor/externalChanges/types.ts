export type ExternalBlockChangeKind = 'added' | 'removed' | 'changed' | 'moved';
export type ExternalBlockIdentityStrategy = 'persistent-id' | 'fallback';

export interface ExternalBlockSnapshot {
  readonly key: string;
  readonly identityStrategy: ExternalBlockIdentityStrategy;
  readonly index: number;
  readonly path: readonly number[];
  readonly type: string;
  readonly id?: string;
  readonly label: string;
  readonly preview: string;
  readonly serialized: string;
}

export interface ExternalBlockDiff {
  readonly key: string;
  readonly kinds: readonly ExternalBlockChangeKind[];
  readonly mine?: ExternalBlockSnapshot;
  readonly external?: ExternalBlockSnapshot;
}

export interface ExternalDocumentDiffSummary {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly moved: number;
}

export interface ExternalDocumentDiff {
  readonly hasChanges: boolean;
  readonly blocks: readonly ExternalBlockDiff[];
  readonly summary: ExternalDocumentDiffSummary;
}

export interface ExternalChangeComparisonSide {
  readonly label: string;
  readonly block?: ExternalBlockSnapshot;
}

export interface ExternalChangeComparisonRow {
  readonly key: string;
  readonly kinds: readonly ExternalBlockChangeKind[];
  readonly mine: ExternalChangeComparisonSide;
  readonly external: ExternalChangeComparisonSide;
}

export interface ExternalChangeComparisonModel {
  readonly title: string;
  readonly summary: ExternalDocumentDiffSummary;
  readonly rows: readonly ExternalChangeComparisonRow[];
}
