import { parseDocumentContract } from '../document/documentContract';
import { walkDocument } from '../document/walker';
import type { SdocEnvelope } from '../types';
import { BUILTIN_TEMPLATES } from './builtins';
import type {
  SdocTemplate,
  TemplateCandidate,
  TemplateCatalogOptions,
  TemplateCatalogResult,
  TemplateDescriptor,
  TemplateDiagnostic,
} from './types';

interface TemplateMetadata {
  name?: string;
  description?: string;
  category?: string;
  titleNodeId?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const readTemplateMetadata = (
  value: unknown,
): { ok: true; metadata: TemplateMetadata } | { ok: false } => {
  if (value === undefined) return { ok: true, metadata: {} };
  if (!isRecord(value)
    || !isOptionalString(value.name)
    || !isOptionalString(value.description)
    || !isOptionalString(value.category)
    || !isOptionalString(value.titleNodeId)) {
    return { ok: false };
  }
  return {
    ok: true,
    metadata: {
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.description === undefined ? {} : { description: value.description }),
      ...(value.category === undefined ? {} : { category: value.category }),
      ...(value.titleNodeId === undefined ? {} : { titleNodeId: value.titleNodeId }),
    },
  };
};

const fileNameWithoutExtension = (fileName: string): string => {
  const segments = fileName.split(/[\\/]/);
  const baseName = segments[segments.length - 1] ?? fileName;
  return baseName.toLowerCase().endsWith('.sdoc') ? baseName.slice(0, -5) : baseName;
};

const hasTitleHeading = (envelope: SdocEnvelope, titleNodeId: string): boolean => {
  for (const { node } of walkDocument(envelope.doc)) {
    if (node.type === 'heading' && node.attrs?.id === titleNodeId) return true;
  }
  return false;
};

const diagnostic = (
  candidate: TemplateCandidate,
  code: TemplateDiagnostic['code'],
  message: string,
  path?: string,
): TemplateDiagnostic => ({
  code,
  targetPath: candidate.targetPath ?? candidate.fileName,
  message,
  ...(path ? { path } : {}),
});

const parseCandidate = (
  candidate: TemplateCandidate,
): { template?: SdocTemplate; diagnostics: TemplateDiagnostic[] } => {
  const contract = parseDocumentContract(candidate.value);
  if (!contract.ok) {
    const code = contract.kind === 'unsupported-version'
      ? 'unsupported-version'
      : 'malformed-document';
    return {
      diagnostics: contract.diagnostics.length > 0
        ? contract.diagnostics.map((entry) => diagnostic(candidate, code, entry.message, entry.path))
        : [diagnostic(candidate, code, '템플릿 문서 계약을 확인할 수 없습니다.')],
    };
  }
  if (contract.legacy) {
    return {
      diagnostics: [diagnostic(
        candidate,
        'legacy-document',
        '템플릿은 sdoc 1.0 envelope 형식이어야 합니다.',
      )],
    };
  }

  const assetVisit = [...walkDocument(contract.envelope.doc)]
    .find(({ node }) => node.type === 'image');
  if (assetVisit) {
    const nodePath = assetVisit.path.length === 0
      ? '/doc'
      : `/doc/content/${assetVisit.path.join('/content/')}`;
    return {
      diagnostics: [diagnostic(
        candidate,
        'unsupported-assets',
        '이미지와 Draw.io 자산을 포함한 템플릿은 아직 지원하지 않습니다.',
        nodePath,
      )],
    };
  }

  const metadataResult = readTemplateMetadata(contract.envelope.meta.template);
  if (!metadataResult.ok) {
    return {
      diagnostics: [diagnostic(
        candidate,
        'invalid-template-metadata',
        'meta.template의 name, description, category, titleNodeId는 문자열이어야 합니다.',
        '/meta/template',
      )],
    };
  }
  const metadata = metadataResult.metadata;
  if (metadata.titleNodeId !== undefined
    && !hasTitleHeading(contract.envelope, metadata.titleNodeId)) {
    return {
      diagnostics: [diagnostic(
        candidate,
        'invalid-title-node',
        `titleNodeId '${metadata.titleNodeId}'가 유효한 heading을 가리키지 않습니다.`,
        '/meta/template/titleNodeId',
      )],
    };
  }

  const descriptor: TemplateDescriptor = {
    id: candidate.id,
    name: metadata.name || fileNameWithoutExtension(candidate.fileName),
    source: candidate.source,
    sourceLabel: candidate.sourceLabel,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.category ? { category: metadata.category } : {}),
    ...(metadata.titleNodeId !== undefined ? { titleNodeId: metadata.titleNodeId } : {}),
  };
  return { template: { descriptor, envelope: contract.envelope }, diagnostics: [] };
};

export function buildTemplateCatalog(
  options: TemplateCatalogOptions = {},
): TemplateCatalogResult {
  const templates = [...(options.builtIn ?? BUILTIN_TEMPLATES)];
  const diagnostics: TemplateDiagnostic[] = [];
  const candidates = [
    ...(options.workspaceCandidates ?? []),
    ...(options.userCandidates ?? []),
  ];
  for (const candidate of candidates) {
    const result = parseCandidate(candidate);
    if (result.template) templates.push(result.template);
    diagnostics.push(...result.diagnostics);
  }
  return { templates, diagnostics };
}
