import {
  assertPersistedDocument,
  parseDocumentContract,
} from '../document/documentContract';
import type {
  DocumentSettings,
  SdocEnvelope,
  SdocTemplateMetadata,
} from '../types';
import type {
  CreatePersonalTemplateSnapshotOptions,
  SdocTemplate,
  TemplateDescriptor,
  UpdatePersonalTemplateMetadataPatch,
} from './types';
import {
  findUnsupportedTemplateAsset,
  hasTitleHeading,
  isPersonalTemplateId,
} from './validation';

const requireNonEmpty = (value: string, fieldName: string, maxLength: number): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName}은(는) 비어 있을 수 없습니다.`);
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName}은(는) ${maxLength}자를 초과할 수 없습니다.`);
  }
  return normalized;
};

const optionalText = (
  value: string | undefined,
  fieldName: string,
  maxLength: number,
): string | undefined => {
  if (value === undefined) return undefined;
  if (value.length > maxLength) {
    throw new Error(`${fieldName}은(는) ${maxLength}자를 초과할 수 없습니다.`);
  }
  return value;
};

const requirePersonalTemplateId = (id: string): string => {
  if (!isPersonalTemplateId(id)) {
    throw new Error('개인 템플릿 ID는 user:<uuid> 형식이어야 합니다.');
  }
  return id;
};

const parseSourceEnvelope = (value: unknown): SdocEnvelope => {
  const contract = parseDocumentContract(value);
  if (!contract.ok) {
    const details = contract.diagnostics.map((entry) => entry.message).join('; ');
    throw new Error(details || '템플릿 원본이 유효한 sdoc 문서가 아닙니다.');
  }
  if (contract.legacy) {
    throw new Error('개인 템플릿 원본은 sdoc 1.0 envelope 형식이어야 합니다.');
  }
  return contract.envelope;
};

const validateTitleNode = (envelope: SdocEnvelope, titleNodeId: string | undefined): void => {
  if (titleNodeId === undefined) return;
  requireNonEmpty(titleNodeId, 'titleNodeId', 200);
  if (!hasTitleHeading(envelope, titleNodeId)) {
    throw new Error(`titleNodeId '${titleNodeId}'가 유효한 heading을 가리키지 않습니다.`);
  }
};

const buildDescriptor = (
  metadata: SdocTemplateMetadata & { id: string; name: string },
  sourceLabel: string,
): TemplateDescriptor => ({
  id: metadata.id,
  name: metadata.name,
  source: 'user',
  sourceLabel,
  ...(metadata.description === undefined ? {} : { description: metadata.description }),
  ...(metadata.category === undefined ? {} : { category: metadata.category }),
  ...(metadata.titleNodeId === undefined ? {} : { titleNodeId: metadata.titleNodeId }),
});

export function createPersonalTemplateSnapshot(
  source: unknown,
  options: CreatePersonalTemplateSnapshotOptions,
): SdocTemplate {
  const envelope = parseSourceEnvelope(source);
  const unsupportedAsset = findUnsupportedTemplateAsset(envelope);
  if (unsupportedAsset) throw new Error(unsupportedAsset.message);

  const metadata: SdocTemplateMetadata & { id: string; name: string } = {
    id: requirePersonalTemplateId(options.id),
    name: requireNonEmpty(options.name, 'name', 200),
    ...(optionalText(options.description, 'description', 2000) === undefined
      ? {}
      : { description: options.description }),
    ...(optionalText(options.category, 'category', 100) === undefined
      ? {}
      : { category: options.category }),
    ...(options.titleNodeId === undefined ? {} : {
      titleNodeId: requireNonEmpty(options.titleNodeId, 'titleNodeId', 200),
    }),
  };
  validateTitleNode(envelope, metadata.titleNodeId);

  const settings = envelope.meta.settings === undefined
    ? undefined
    : structuredClone(envelope.meta.settings) as Partial<DocumentSettings>;
  const snapshotEnvelope: SdocEnvelope = {
    sdoc: '1.0',
    meta: {
      ...(typeof envelope.meta.title === 'string' ? { title: envelope.meta.title } : {}),
      ...(settings === undefined ? {} : { settings }),
      template: structuredClone(metadata),
    },
    doc: structuredClone(envelope.doc),
  };
  assertPersistedDocument(snapshotEnvelope);
  return {
    descriptor: buildDescriptor(metadata, options.sourceLabel ?? '개인 템플릿'),
    envelope: snapshotEnvelope,
  };
}

export function updatePersonalTemplateMetadata(
  template: SdocTemplate,
  patch: UpdatePersonalTemplateMetadataPatch,
): SdocTemplate {
  if (template.descriptor.source !== 'user') {
    throw new Error('개인 템플릿만 메타데이터를 변경할 수 있습니다.');
  }
  if (template.envelope.meta.template?.id !== template.descriptor.id) {
    throw new Error('개인 템플릿의 descriptor와 persisted ID가 일치하지 않습니다.');
  }
  const id = requirePersonalTemplateId(template.descriptor.id);
  const name = patch.name === undefined
    ? template.descriptor.name
    : requireNonEmpty(patch.name, 'name', 200);
  const description = patch.description === undefined
    ? template.descriptor.description
    : optionalText(patch.description, 'description', 2000);
  const category = patch.category === undefined
    ? template.descriptor.category
    : optionalText(patch.category, 'category', 100);
  const titleNodeId = patch.titleNodeId === undefined
    ? template.descriptor.titleNodeId
    : requireNonEmpty(patch.titleNodeId, 'titleNodeId', 200);

  const envelope = structuredClone(template.envelope);
  validateTitleNode(envelope, titleNodeId);
  const metadata: SdocTemplateMetadata & { id: string; name: string } = {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    ...(category === undefined ? {} : { category }),
    ...(titleNodeId === undefined ? {} : { titleNodeId }),
  };
  envelope.meta.template = structuredClone(metadata);
  assertPersistedDocument(envelope);
  return {
    descriptor: buildDescriptor(metadata, template.descriptor.sourceLabel),
    envelope,
  };
}
