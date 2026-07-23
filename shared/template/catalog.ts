import { parseDocumentContract } from '../document/documentContract';
import { BUILTIN_TEMPLATES } from './builtins';
import type {
  SdocTemplate,
  TemplateCandidate,
  TemplateCatalogOptions,
  TemplateCatalogResult,
  TemplateDescriptor,
  TemplateDiagnostic,
} from './types';
import {
  findUnsupportedTemplateAsset,
  hasTitleHeading,
  isPersonalTemplateId,
  readTemplateMetadata,
} from './validation';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fileNameWithoutExtension = (fileName: string): string => {
  const segments = fileName.split(/[\\/]/);
  const baseName = segments[segments.length - 1] ?? fileName;
  return baseName.toLowerCase().endsWith('.sdoc') ? baseName.slice(0, -5) : baseName;
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
): { candidate: TemplateCandidate; template?: SdocTemplate; diagnostics: TemplateDiagnostic[] } => {
  if (isRecord(candidate.value) && isRecord(candidate.value.meta)) {
    const rawMetadata = readTemplateMetadata(candidate.value.meta.template);
    if (!rawMetadata.ok) {
      return {
        candidate,
        diagnostics: [diagnostic(
          candidate,
          'invalid-template-metadata',
          'meta.template의 id, name, description, category, titleNodeId는 문자열이어야 합니다.',
          '/meta/template',
        )],
      };
    }
  }
  const contract = parseDocumentContract(candidate.value);
  if (!contract.ok) {
    const code = contract.kind === 'unsupported-version'
      ? 'unsupported-version'
      : 'malformed-document';
    return {
      candidate,
      diagnostics: contract.diagnostics.length > 0
        ? contract.diagnostics.map((entry) => diagnostic(candidate, code, entry.message, entry.path))
        : [diagnostic(candidate, code, '템플릿 문서 계약을 확인할 수 없습니다.')],
    };
  }
  if (contract.legacy) {
    return {
      candidate,
      diagnostics: [diagnostic(
        candidate,
        'legacy-document',
        '템플릿은 sdoc 1.0 envelope 형식이어야 합니다.',
      )],
    };
  }

  const unsupportedAsset = findUnsupportedTemplateAsset(contract.envelope);
  if (unsupportedAsset) {
    return {
      candidate,
      diagnostics: [diagnostic(
        candidate,
        'unsupported-assets',
        unsupportedAsset.message,
        unsupportedAsset.path,
      )],
    };
  }

  const metadataResult = readTemplateMetadata(contract.envelope.meta.template);
  if (!metadataResult.ok) {
    return {
      candidate,
      diagnostics: [diagnostic(
        candidate,
        'invalid-template-metadata',
        'meta.template의 id, name, description, category, titleNodeId는 문자열이어야 합니다.',
        '/meta/template',
      )],
    };
  }
  const metadata = metadataResult.metadata;
  if (candidate.source === 'user' && !isPersonalTemplateId(metadata.id)) {
    return {
      candidate,
      diagnostics: [diagnostic(
        candidate,
        'invalid-template-id',
        '개인 템플릿의 meta.template.id는 user:<uuid> 형식이어야 합니다.',
        '/meta/template/id',
      )],
    };
  }
  if (candidate.source === 'user' && metadata.id !== candidate.id) {
    return {
      candidate,
      diagnostics: [diagnostic(
        candidate,
        'invalid-template-id',
        '개인 템플릿의 저장소 ID와 meta.template.id가 일치해야 합니다.',
        '/meta/template/id',
      )],
    };
  }
  if (candidate.source === 'user' && (!metadata.name || metadata.name.trim().length === 0)) {
    return {
      candidate,
      diagnostics: [diagnostic(
        candidate,
        'invalid-template-metadata',
        '개인 템플릿의 meta.template.name은 비어 있지 않은 문자열이어야 합니다.',
        '/meta/template/name',
      )],
    };
  }
  if (metadata.titleNodeId !== undefined
    && !hasTitleHeading(contract.envelope, metadata.titleNodeId)) {
    return {
      candidate,
      diagnostics: [diagnostic(
        candidate,
        'invalid-title-node',
        `titleNodeId '${metadata.titleNodeId}'가 유효한 heading을 가리키지 않습니다.`,
        '/meta/template/titleNodeId',
      )],
    };
  }

  const descriptor: TemplateDescriptor = {
    id: candidate.source === 'user' ? (metadata.id ?? candidate.id) : candidate.id,
    name: metadata.name || fileNameWithoutExtension(candidate.fileName),
    source: candidate.source,
    sourceLabel: candidate.sourceLabel,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.category ? { category: metadata.category } : {}),
    ...(metadata.titleNodeId !== undefined ? { titleNodeId: metadata.titleNodeId } : {}),
  };
  return {
    candidate,
    template: { descriptor, envelope: contract.envelope },
    diagnostics: [],
  };
};

export function buildTemplateCatalog(
  options: TemplateCatalogOptions = {},
): TemplateCatalogResult {
  const builtIn = [...(options.builtIn ?? BUILTIN_TEMPLATES)];
  const templates = [...builtIn];
  const diagnostics: TemplateDiagnostic[] = [];
  const candidates = [
    ...(options.workspaceCandidates ?? []),
    ...(options.userCandidates ?? []),
  ];
  const parsed = candidates.map(parseCandidate);
  for (const result of parsed) {
    diagnostics.push(...result.diagnostics);
  }
  const accepted = parsed.filter(
    (result): result is typeof result & { template: SdocTemplate } => result.template !== undefined,
  );
  const builtInIds = new Set(builtIn.map((template) => template.descriptor.id));
  const idCounts = new Map<string, number>();
  for (const { template } of accepted) {
    idCounts.set(template.descriptor.id, (idCounts.get(template.descriptor.id) ?? 0) + 1);
  }
  for (const result of accepted) {
    const id = result.template.descriptor.id;
    if ((idCounts.get(id) ?? 0) > 1 || builtInIds.has(id)) {
      diagnostics.push(diagnostic(
        result.candidate,
        'duplicate-template-id',
        `템플릿 ID '${id}'가 중복되어 해당 후보를 사용할 수 없습니다.`,
        '/meta/template/id',
      ));
      continue;
    }
    templates.push(result.template);
  }
  return { templates, diagnostics };
}
