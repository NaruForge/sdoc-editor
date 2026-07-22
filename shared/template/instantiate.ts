import { assertPersistedDocument } from '../document/documentContract';
import { mapDocument } from '../document/walker';
import type { SdocEnvelope, TiptapNode } from '../types';
import type { InstantiateTemplateOptions, SdocTemplate } from './types';

const replaceTitleHeading = (
  doc: TiptapNode,
  titleNodeId: string | undefined,
  title: string,
): TiptapNode => {
  if (!titleNodeId) return doc;
  return mapDocument(doc, (node) => {
    if (node.type !== 'heading' || node.attrs?.id !== titleNodeId) return node;
    return { ...node, content: [{ type: 'text', text: title }] };
  });
};

export function instantiateTemplate(
  template: SdocTemplate,
  options: InstantiateTemplateOptions,
): SdocEnvelope {
  const envelope = structuredClone(template.envelope);
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const { template: _templateMetadata, ...preservedMeta } = envelope.meta;
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
    doc: replaceTitleHeading(
      envelope.doc,
      template.descriptor.titleNodeId,
      options.title,
    ),
  };
  assertPersistedDocument(result);
  return result;
}
