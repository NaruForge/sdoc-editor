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
