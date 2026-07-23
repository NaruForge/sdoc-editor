import type { SdocEnvelope } from '../types';

export type TemplateSource = 'builtin' | 'workspace' | 'user';

export interface TemplateDescriptor {
  id: string;
  name: string;
  description?: string;
  category?: string;
  source: TemplateSource;
  sourceLabel: string;
  titleNodeId?: string;
}

export interface SdocTemplate {
  descriptor: TemplateDescriptor;
  envelope: SdocEnvelope;
}

export type TemplateDiagnosticCode =
  | 'malformed-document'
  | 'unsupported-version'
  | 'legacy-document'
  | 'invalid-template-metadata'
  | 'invalid-template-id'
  | 'duplicate-template-id'
  | 'invalid-title-node'
  | 'unsupported-assets'
  | 'read-failed'
  | 'unsafe-path'
  | 'file-too-large'
  | 'candidate-limit-exceeded'
  | 'unsupported-filesystem';

export interface TemplateDiagnostic {
  code: TemplateDiagnosticCode;
  targetPath: string;
  message: string;
  path?: string;
}

export interface TemplateCandidate {
  id: string;
  source: Exclude<TemplateSource, 'builtin'>;
  sourceLabel: string;
  fileName: string;
  value: unknown;
  targetPath?: string;
}

export interface TemplateCatalogOptions {
  builtIn?: readonly SdocTemplate[];
  workspaceCandidates?: readonly TemplateCandidate[];
  userCandidates?: readonly TemplateCandidate[];
}

export interface TemplateCatalogResult {
  templates: SdocTemplate[];
  diagnostics: TemplateDiagnostic[];
}

export interface InstantiateTemplateOptions {
  title: string;
  now?: () => Date;
}

export interface CreatePersonalTemplateSnapshotOptions {
  id: string;
  name: string;
  description?: string;
  category?: string;
  titleNodeId?: string;
  sourceLabel?: string;
}

export interface UpdatePersonalTemplateMetadataPatch {
  name?: string;
  description?: string;
  category?: string;
  titleNodeId?: string;
}

export interface TemplateOutlinePreviewItem {
  id?: string;
  level: number;
  text: string;
  numbered: boolean;
  isTitle: boolean;
}

export interface TemplateStructuralCounts {
  headings: number;
  paragraphs: number;
  tables: number;
  figures: number;
  equations: number;
  diagrams: number;
  codeBlocks: number;
}

export interface TemplateStructuralPreview {
  templateId: string;
  outline: TemplateOutlinePreviewItem[];
  counts: TemplateStructuralCounts;
  settingsKeys: string[];
  truncated: boolean;
}
