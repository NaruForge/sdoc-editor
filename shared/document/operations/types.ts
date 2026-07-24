import type { DocumentSettings, SdocEnvelope, TiptapNode } from '../../types';

export type Sha256Digest = `sha256:${string}`;

export type NodeTarget =
  | { kind: 'id'; id: string; expectedType?: string }
  | { kind: 'snapshot'; path: number[]; nodeType: string; digest: Sha256Digest };

export type BlockDestination =
  | { position: 'before' | 'after'; target: NodeTarget }
  | { position: 'section-end'; target: NodeTarget };

export type SdocOperation =
  | { op: 'renameHeading'; target: NodeTarget; title: string; discardFormatting?: boolean }
  | { op: 'insertBlock'; destination: BlockDestination; block: TiptapNode }
  | { op: 'insertSection'; target: NodeTarget; title: string; id?: string; blocks?: TiptapNode[] }
  | { op: 'replaceBlock'; target: NodeTarget; block: TiptapNode }
  | { op: 'updateBlockAttrs'; target: NodeTarget; attrs: Record<string, unknown> }
  | { op: 'moveBlock'; target: NodeTarget; destination: BlockDestination }
  | { op: 'deleteBlock'; target: NodeTarget }
  | { op: 'moveSection'; target: NodeTarget; destination: BlockDestination }
  | { op: 'deleteSection'; target: NodeTarget };

export interface SdocOperationRequest {
  contract: 'sdoc.operations/1';
  expected: { revision: Sha256Digest; documentId?: string };
  operations: SdocOperation[];
}

export interface OperationDiagnostic {
  code: string;
  message: string;
  path?: string;
  operationIndex?: number;
  severity?: 'error' | 'warning';
}

export type FailureCategory = 'argument' | 'document' | 'conflict';

export interface InspectBlock {
  type: string;
  path: number[];
  summary: string;
  id?: string;
  provisionalId?: string;
  digest?: Sha256Digest;
}

export interface InspectResult {
  ok: true;
  revision: Sha256Digest;
  legacy: boolean;
  needsIdNormalization: boolean;
  documentId?: string;
  outline: Array<{ id?: string; provisionalId?: string; level: number; text: string; path: number[] }>;
  references: Array<{ href: string; targetExists: boolean; path: number[] }>;
  referenceables: Array<{ type: string; id?: string; provisionalId?: string; path: number[] }>;
  blocks: InspectBlock[];
  target?: { path: number[]; node: TiptapNode; digest: Sha256Digest };
  warnings: OperationDiagnostic[];
}

export interface ValidationResult {
  ok: true;
  revision: Sha256Digest;
  legacy: boolean;
  needsIdNormalization: boolean;
  warnings: OperationDiagnostic[];
}

export interface SemanticDiffEvent {
  kind:
    | 'heading-renamed' | 'block-inserted' | 'section-inserted' | 'block-replaced'
    | 'block-attrs-updated' | 'block-moved' | 'block-deleted' | 'section-moved'
    | 'section-deleted' | 'id-assigned' | 'reference-label-updated'
    | 'numbering-updated' | 'metadata-updated';
  before?: string;
  after?: string;
  indirectChanges?: number;
}

export interface ApplySuccess {
  ok: true;
  revision: Sha256Digest;
  outputRevision: Sha256Digest;
  changed: boolean;
  legacy: boolean;
  envelope: SdocEnvelope;
  outputText: string;
  diff: SemanticDiffEvent[];
  normalizationPolicy: Required<Pick<DocumentSettings,
    'captionStyle' | 'captionNumbering' | 'equationNumbering'
    | 'crossRefIncludeCaption' | 'headingNumbering'>>;
  warnings: OperationDiagnostic[];
}

export type OperationFailure = {
  ok: false;
  category: FailureCategory;
  diagnostics: OperationDiagnostic[];
};

export type InspectDocumentResult = InspectResult | OperationFailure;
export type ValidateDocumentResult = ValidationResult | OperationFailure;
export type ApplyOperationResult = ApplySuccess | OperationFailure;

export interface InspectOptions {
  target?: NodeTarget;
  maxBlocks?: number;
  maxSummaryLength?: number;
}

export interface ApplyOptions {
  upgradeLegacy?: boolean;
  clock?: () => string | Date;
  externalSettings?: Partial<DocumentSettings>;
  /** Caller-established file/document identity; required when request.expected.documentId is set. */
  currentDocumentId?: string;
}
