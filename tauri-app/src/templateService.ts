import {
  buildTemplateCatalog,
  instantiateTemplate,
  type SdocTemplate,
  type TemplateCatalogResult,
  type TemplateCandidate,
} from '@shared/template';
import type { SdocEnvelope } from '@shared/types';

export interface WorkspaceTemplateCandidate {
  id: string;
  sourceLabel: string;
  fileName: string;
  path: string;
  rawSource: string;
}

export interface WorkspaceTemplateDiagnostic {
  code: string;
  path: string;
  message: string;
}

export interface WorkspaceTemplateDiscovery {
  candidates: WorkspaceTemplateCandidate[];
  diagnostics: WorkspaceTemplateDiagnostic[];
}

export interface TauriTemplateCatalog {
  catalog: TemplateCatalogResult;
  nativeDiagnostics: WorkspaceTemplateDiagnostic[];
}

export async function loadTauriTemplateCatalog(
  workspaceFolder: string | null,
  discover: () => Promise<WorkspaceTemplateDiscovery>,
): Promise<TauriTemplateCatalog> {
  if (!workspaceFolder) {
    return {
      catalog: buildTemplateCatalog(),
      nativeDiagnostics: [],
    };
  }

  const discovery = await discover();
  const workspaceCandidates: TemplateCandidate[] = discovery.candidates.map((candidate) => {
    let value: unknown = candidate.rawSource;
    try {
      value = JSON.parse(candidate.rawSource) as unknown;
    } catch {
      // Pass the unparsed value to the shared boundary so it produces the same malformed
      // document diagnostic as every other template source.
    }
    return {
      id: candidate.id,
      source: 'workspace',
      sourceLabel: candidate.sourceLabel,
      fileName: candidate.fileName,
      value,
      targetPath: candidate.path,
    };
  });
  return {
    catalog: buildTemplateCatalog({ workspaceCandidates }),
    nativeDiagnostics: discovery.diagnostics,
  };
}

export function suggestTemplateFileName(title: string): string {
  const withoutExtension = title.trim().replace(/\.sdoc$/i, '');
  const safe = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 120)
    .replace(/[\s.]+$/g, '');
  return `${safe || 'untitled'}.sdoc`;
}

export interface CreateTauriTemplateRequest {
  template: SdocTemplate;
  title: string;
}

export interface CreateTauriTemplateOperations<TResult> {
  flush(): Promise<void>;
  create(envelope: SdocEnvelope): Promise<TResult>;
}

export async function createTauriTemplateDocument<TResult>(
  request: CreateTauriTemplateRequest,
  operations: CreateTauriTemplateOperations<TResult>,
): Promise<TResult> {
  const title = request.title.trim();
  if (title.length < 1 || title.length > 200) {
    throw new Error('Document title must be between 1 and 200 characters.');
  }
  await operations.flush();
  const envelope = instantiateTemplate(request.template, { title });
  return operations.create(envelope);
}
