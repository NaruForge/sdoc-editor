import { walkDocument } from '../document/walker';
import type { SdocEnvelope, SdocTemplateMetadata, TiptapNode } from '../types';

export const PERSONAL_TEMPLATE_ID_PATTERN =
  /^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface UnsupportedTemplateAsset {
  path: string;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

export const isPersonalTemplateId = (value: unknown): value is string =>
  typeof value === 'string' && PERSONAL_TEMPLATE_ID_PATTERN.test(value);

export const readTemplateMetadata = (
  value: unknown,
): { ok: true; metadata: SdocTemplateMetadata } | { ok: false } => {
  if (value === undefined) return { ok: true, metadata: {} };
  if (!isRecord(value)
    || !isOptionalString(value.id)
    || !isOptionalString(value.name)
    || !isOptionalString(value.description)
    || !isOptionalString(value.category)
    || !isOptionalString(value.titleNodeId)) {
    return { ok: false };
  }
  return {
    ok: true,
    metadata: {
      ...(value.id === undefined ? {} : { id: value.id }),
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.description === undefined ? {} : { description: value.description }),
      ...(value.category === undefined ? {} : { category: value.category }),
      ...(value.titleNodeId === undefined ? {} : { titleNodeId: value.titleNodeId }),
    },
  };
};

export const hasTitleHeading = (envelope: SdocEnvelope, titleNodeId: string): boolean => {
  for (const { node } of walkDocument(envelope.doc)) {
    if (node.type === 'heading' && node.attrs?.id === titleNodeId) return true;
  }
  return false;
};

export const suggestTemplateTitleNodeId = (envelope: SdocEnvelope): string | undefined => {
  const title = envelope.meta.title?.trim();
  if (!title) return undefined;
  const nodeText = (node: TiptapNode): string =>
    node.type === 'text' ? (node.text ?? '') : (node.content?.map(nodeText).join('') ?? '');
  const matches = [...walkDocument(envelope.doc)]
    .map(({ node }) => node)
    .filter((node) => node.type === 'heading'
      && typeof node.attrs?.id === 'string'
      && nodeText(node).trim() === title);
  return matches.length === 1 ? String(matches[0]?.attrs?.id) : undefined;
};

export const findUnsupportedTemplateAsset = (
  envelope: SdocEnvelope,
): UnsupportedTemplateAsset | undefined => {
  const assetVisit = [...walkDocument(envelope.doc)]
    .find(({ node }) => node.type === 'image');
  if (!assetVisit) return undefined;
  return {
    path: assetVisit.path.length === 0
      ? '/doc'
      : `/doc/content/${assetVisit.path.join('/content/')}`,
    message: '이미지와 Draw.io 자산을 포함한 템플릿은 아직 지원하지 않습니다.',
  };
};
