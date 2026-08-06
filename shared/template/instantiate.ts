import { assertPersistedDocument } from '../document/documentContract';
import type { SdocEnvelope, TiptapNode } from '../types';
import type { InstantiateTemplateOptions, SdocTemplate } from './types';

const removeTitlePlaceholder = (
  doc: TiptapNode,
  titleNodeId: string | undefined,
): TiptapNode => {
  if (!titleNodeId) return doc;
  if (!doc.content) return doc;
  return {
    ...doc,
    content: doc.content
      .filter((node) => node.type !== 'heading' || node.attrs?.id !== titleNodeId)
      .map((node) => removeTitlePlaceholder(node, titleNodeId)),
  };
};

export function instantiateTemplate(
  template: SdocTemplate,
  options: InstantiateTemplateOptions,
): SdocEnvelope {
  const envelope = structuredClone(template.envelope);
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const {
    template: _templateMetadata,
    documentId: _documentId,
    id: _legacyDocumentId,
    ...preservedMeta
  } = envelope.meta;
  const result: SdocEnvelope = {
    sdoc: '1.0',
    meta: {
      ...preservedMeta,
      title: options.title,
      author: '',
      version: '0.1',
      created: timestamp,
      modified: timestamp,
    },
    doc: removeTitlePlaceholder(envelope.doc, template.descriptor.titleNodeId),
  };
  assertPersistedDocument(result);
  return result;
}
