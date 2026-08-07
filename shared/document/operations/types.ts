import type { DocumentSettings, SdocEnvelope, TiptapNode } from '../../types';

export type Sha256Digest = `sha256:${string}`;

export type NodeTarget =
  | { kind: 'id'; id: string; expectedType?: string }
  | { kind: 'snapshot'; path: number[]; nodeType: string; digest: Sha256Digest };

export type BlockDestination =
  | { position: 'before' | 'after'; target: NodeTarget }
  | { position: 'section-end'; target: NodeTarget };

export type PortableDocumentSettingKey = Exclude<
keyof DocumentSettings,
  'slideCssPath' | 'htmlCssPath' | 'outputDir'
>;

export type DocumentSettingsPatch = Partial<{
  [Key in PortableDocumentSettingKey]: DocumentSettings[Key] | null;
}>;

export type SdocOperation =
  | { op: 'renameHeading'; target: NodeTarget; title: string; discardFormatting?: boolean }
  | {
    op: 'setDocumentTitle';
    title: string;
    headingTarget?: NodeTarget;
    discardFormatting?: boolean;
  }
  | {
    op: 'updateDocumentMetadata';
    patch: { author?: string | null; version?: string | null };
  }
  | { op: 'updateDocumentSettings'; patch: DocumentSettingsPatch }
  | { op: 'insertBlock'; destination: BlockDestination; block: TiptapNode }
  | {
    op: 'insertSection';
    target: NodeTarget;
    title: string;
    id?: string;
    blocks?: TiptapNode[];
    position?: 'child' | 'before' | 'after';
  }
  | { op: 'replaceBlock'; target: NodeTarget; block: TiptapNode }
  | { op: 'updateBlockAttrs'; target: NodeTarget; attrs: Record<string, unknown> }
  | { op: 'moveBlock'; target: NodeTarget; destination: BlockDestination }
  | { op: 'deleteBlock'; target: NodeTarget }
  | { op: 'moveSection'; target: NodeTarget; destination: BlockDestination }
  | { op: 'deleteSection'; target: NodeTarget }
  | { op: 'setHeadingLevel'; target: NodeTarget; level: number }
  | { op: 'renameBlockId'; target: NodeTarget; newId: string };

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
  operationTarget: NodeTarget;
  id?: string;
  provisionalId?: string;
  digest?: Sha256Digest;
}

export interface InspectMetadata {
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
  settings?: Partial<DocumentSettings>;
}

export interface InspectResult {
  ok: true;
  revision: Sha256Digest;
  legacy: boolean;
  needsIdNormalization: boolean;
  documentId?: string;
  metadata: InspectMetadata;
  outline: Array<{ id?: string; provisionalId?: string; level: number; text: string; path: number[] }>;
  references: Array<{ href: string; targetExists: boolean; path: number[] }>;
  referenceables: Array<{ type: string; id?: string; provisionalId?: string; path: number[] }>;
  blocks: InspectBlock[];
  blockCount: number;
  blocksTruncated: boolean;
  target?: {
    path: number[];
    node: TiptapNode;
    digest: Sha256Digest;
    operationTarget: NodeTarget;
  };
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
    | 'numbering-updated' | 'metadata-updated'
    | 'document-title-updated' | 'document-metadata-updated'
    | 'document-settings-updated'
    | 'block-id-renamed' | 'section-level-changed';
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
    | 'crossRefIncludeCaption' | 'headingNumbering' | 'headingStartNumber'>>;
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
  targetPath?: number[];
  maxBlocks?: number;
  maxSummaryLength?: number;
}

export type ReadProjection = 'catalog' | 'target' | 'section' | 'document';
export type ReadCatalogKind = 'blocks' | 'outline' | 'references' | 'referenceables';
export type ReadTruncationReason = 'limit' | 'maxBytes' | 'maxNodes';

export interface ReadRequestBase {
  contract: 'sdoc.read/1';
  projection: ReadProjection;
  expectedRevision?: Sha256Digest;
}

export interface CatalogReadRequest extends ReadRequestBase {
  projection: 'catalog';
  kind?: ReadCatalogKind;
  limit?: number;
  cursor?: string;
  maxBytes?: number;
  maxSummaryLength?: number;
}

export type ReadTargetSelector =
  | { target: NodeTarget; targetPath?: never }
  | { target?: never; targetPath: number[] };

export type TargetReadRequest = ReadRequestBase & ReadTargetSelector & {
  projection: 'target';
  maxBytes?: number;
  maxNodes?: number;
};

export type SectionReadRequest = ReadRequestBase & ReadTargetSelector & {
  projection: 'section';
  cursor?: string;
  maxBytes?: number;
  maxNodes?: number;
};

export interface DocumentReadRequest extends ReadRequestBase {
  projection: 'document';
  cursor?: string;
  maxBytes?: number;
  maxNodes?: number;
}

export type ProjectDocumentRequest =
  | CatalogReadRequest
  | TargetReadRequest
  | SectionReadRequest
  | DocumentReadRequest;

export interface ReadPage {
  returned: number;
  complete: boolean;
  nextCursor?: string;
  truncatedBy?: ReadTruncationReason;
}

export interface ReadBudget {
  bytes: { used: number; max: number };
  nodes?: { used: number; max: number };
}

export interface ReadSuccessBase {
  ok: true;
  contract: 'sdoc.read/1';
  projection: ReadProjection;
  revision: Sha256Digest;
  legacy: boolean;
  documentId?: string;
  needsIdNormalization: boolean;
  warnings: OperationDiagnostic[];
  page: ReadPage;
  budget: ReadBudget;
}

export type CatalogReadData =
  | { kind: 'blocks'; items: InspectBlock[] }
  | { kind: 'outline'; items: InspectResult['outline'] }
  | { kind: 'references'; items: InspectResult['references'] }
  | { kind: 'referenceables'; items: InspectResult['referenceables'] };

export interface CatalogReadSuccess extends ReadSuccessBase {
  projection: 'catalog';
  data: CatalogReadData;
}

export interface TargetReadSuccess extends ReadSuccessBase {
  projection: 'target';
  data: NonNullable<InspectResult['target']>;
}

export interface SectionReadSuccess extends ReadSuccessBase {
  projection: 'section';
  data: { path: number[]; content: TiptapNode[] };
}

export interface DocumentReadSuccess extends ReadSuccessBase {
  projection: 'document';
  data: { content: TiptapNode[] };
}

export interface ReadDiagnostic extends OperationDiagnostic {
  requiredBytes?: number;
  requiredNodes?: number;
}

export interface ReadFailure {
  ok: false;
  category: FailureCategory;
  diagnostics: ReadDiagnostic[];
}

export type ProjectDocumentSuccess =
  | CatalogReadSuccess
  | TargetReadSuccess
  | SectionReadSuccess
  | DocumentReadSuccess;
export type ProjectDocumentResult = ProjectDocumentSuccess | ReadFailure;

export interface ApplyOptions {
  upgradeLegacy?: boolean;
  clock?: () => string | Date;
  externalSettings?: Partial<DocumentSettings>;
  /** Caller-established file/document identity; required when request.expected.documentId is set. */
  currentDocumentId?: string;
}
