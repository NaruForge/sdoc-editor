import {
  buildTemplateCatalog,
  createPersonalTemplateSnapshot,
  instantiateTemplate,
  suggestTemplateTitleNodeId,
  type SdocTemplate,
  type TemplateCatalogResult,
  type TemplateCandidate,
} from '@shared/template';
import { parseDocumentContract } from '@shared/document/documentContract';
import type { SdocEnvelope, SdocMeta, TiptapNode } from '@shared/types';

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
  personalFingerprints: Map<string, string>;
  personalRootPath: string;
}

export interface PersonalTemplateCandidate {
  storageId: string;
  fileName: string;
  rawSource: string;
  fingerprint: string;
  sizeBytes: number;
}

export interface PersonalTemplateDiscovery {
  libraryPath: string;
  storageScope: string;
  candidates: PersonalTemplateCandidate[];
  diagnostics: WorkspaceTemplateDiagnostic[];
}

export async function loadTauriTemplateCatalog(
  workspaceFolder: string | null,
  discover: () => Promise<WorkspaceTemplateDiscovery>,
  discoverPersonal: () => Promise<PersonalTemplateDiscovery> = async () => ({
    libraryPath: '',
    storageScope: 'local-user-home',
    candidates: [],
    diagnostics: [],
  }),
): Promise<TauriTemplateCatalog> {
  const [workspaceDiscovery, personalDiscovery] = await Promise.all([
    workspaceFolder ? discover() : Promise.resolve<WorkspaceTemplateDiscovery>({
      candidates: [],
      diagnostics: [],
    }),
    discoverPersonal(),
  ]);
  const workspaceCandidates: TemplateCandidate[] = workspaceDiscovery.candidates.map((candidate) => {
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
  const personalFingerprints = new Map<string, string>();
  const userCandidates: TemplateCandidate[] = personalDiscovery.candidates.map((candidate) => {
    const id = `user:${candidate.storageId}`;
    personalFingerprints.set(id, candidate.fingerprint);
    let value: unknown = candidate.rawSource;
    try {
      value = JSON.parse(candidate.rawSource) as unknown;
    } catch {
      // Shared parsing emits a consistent malformed-document diagnostic.
    }
    return {
      id,
      source: 'user',
      sourceLabel: `이 PC의 공유 저장소 · ${personalDiscovery.libraryPath}`,
      fileName: candidate.fileName,
      value,
      targetPath: candidate.fileName,
    };
  });
  return {
    catalog: buildTemplateCatalog({ workspaceCandidates, userCandidates }),
    nativeDiagnostics: [
      ...workspaceDiscovery.diagnostics,
      ...personalDiscovery.diagnostics,
    ],
    personalFingerprints,
    personalRootPath: personalDiscovery.libraryPath,
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

export interface TauriDocumentIdentity {
  documentId: string;
  revision: number;
}

export interface TauriActiveDocumentSnapshot extends TauriDocumentIdentity {
  envelope: unknown;
}

interface ActiveDocumentOperations {
  flushAndWait(): Promise<void>;
  getIdentity(): TauriDocumentIdentity;
  readSnapshot(identity: TauriDocumentIdentity): Promise<TauriActiveDocumentSnapshot>;
}

const readFlushedSnapshot = async (
  operations: ActiveDocumentOperations,
): Promise<{ identity: TauriDocumentIdentity; envelope: SdocEnvelope }> => {
  await operations.flushAndWait();
  const identity = operations.getIdentity();
  const snapshot = await operations.readSnapshot(identity);
  if (snapshot.documentId !== identity.documentId || snapshot.revision !== identity.revision) {
    throw new Error('Active document changed while reading the template snapshot.');
  }
  const contract = parseDocumentContract(snapshot.envelope);
  if (!contract.ok || contract.legacy) {
    throw new Error('The active document is not a valid SDOC 1.0 envelope.');
  }
  return { identity, envelope: contract.envelope };
};

export interface SaveActiveDocumentAsPersonalTemplateOperations extends ActiveDocumentOperations {
  createId(): string;
  create(templateId: string, envelope: SdocEnvelope): Promise<void>;
}

export async function saveActiveDocumentAsPersonalTemplate(
  metadata: { name: string; description?: string; category?: string },
  operations: SaveActiveDocumentAsPersonalTemplateOperations,
): Promise<SdocTemplate> {
  const { envelope } = await readFlushedSnapshot(operations);
  const titleNodeId = suggestTemplateTitleNodeId(envelope);
  const template = createPersonalTemplateSnapshot(envelope, {
    id: `user:${operations.createId()}`,
    name: metadata.name,
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
    ...(metadata.category === undefined ? {} : { category: metadata.category }),
    ...(titleNodeId === undefined ? {} : { titleNodeId }),
    sourceLabel: '이 PC의 공유 저장소',
  });
  await operations.create(template.descriptor.id, template.envelope);
  return template;
}

export interface ApplyTemplateToActiveTauriDocumentOperations extends ActiveDocumentOperations {
  confirm(snapshot: SdocEnvelope): Promise<boolean>;
  save(request: {
    content: TiptapNode;
    metaUpdates: Record<string, unknown>;
    documentId: string;
    revision: number;
  }): Promise<TauriDocumentIdentity>;
}

export interface ApplyTemplateToActiveTauriDocumentResult {
  applied: boolean;
  identity?: TauriDocumentIdentity;
  envelope?: SdocEnvelope;
}

export async function applyTemplateToActiveTauriDocument(
  template: SdocTemplate,
  operations: ApplyTemplateToActiveTauriDocumentOperations,
): Promise<ApplyTemplateToActiveTauriDocumentResult> {
  const { identity, envelope: current } = await readFlushedSnapshot(operations);
  if (!await operations.confirm(current)) return { applied: false };

  const instantiated = instantiateTemplate(template, {
    title: typeof current.meta.title === 'string' && current.meta.title.trim()
      ? current.meta.title
      : 'Untitled',
  });
  const nextMeta: SdocMeta = structuredClone(current.meta);
  if (instantiated.meta.settings === undefined) delete nextMeta.settings;
  else nextMeta.settings = structuredClone(instantiated.meta.settings);
  const savedIdentity = await operations.save({
    content: instantiated.doc,
    metaUpdates: { settings: instantiated.meta.settings ?? null },
    documentId: identity.documentId,
    revision: identity.revision,
  });
  return {
    applied: true,
    identity: savedIdentity,
    envelope: {
      sdoc: '1.0',
      meta: nextMeta,
      doc: structuredClone(instantiated.doc),
    },
  };
}
