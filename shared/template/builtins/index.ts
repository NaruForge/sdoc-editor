import { assertPersistedDocument } from '../../document/documentContract';
import { walkDocument } from '../../document/walker';
import type { SdocEnvelope } from '../../types';
import type { SdocTemplate, TemplateDescriptor } from '../types';
import blank from './blank.sdoc.json';
import designSpecification from './design-specification.sdoc.json';
import technicalReport from './technical-report.sdoc.json';
import verificationReport from './verification-report.sdoc.json';

interface BuiltInDefinition {
  id: string;
  sourceLabel: string;
  value: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, property: string): string => {
  if (!isRecord(value) || typeof value[property] !== 'string' || value[property].length === 0) {
    throw new Error(`Bundled template requires a non-empty ${property}.`);
  }
  return value[property];
};

const optionalString = (value: unknown, property: string): string | undefined =>
  isRecord(value) && typeof value[property] === 'string' && value[property].length > 0
    ? value[property]
    : undefined;

const createBuiltIn = (definition: BuiltInDefinition): SdocTemplate => {
  assertPersistedDocument(definition.value);
  const envelope: SdocEnvelope = definition.value;
  const metadata = envelope.meta.template;
  const titleNodeId = optionalString(metadata, 'titleNodeId');
  if (!titleNodeId || ![...walkDocument(envelope.doc)].some(({ node }) =>
    node.type === 'heading' && node.attrs?.id === titleNodeId)) {
    throw new Error(`Bundled template ${definition.id} requires a valid title heading.`);
  }
  const descriptor: TemplateDescriptor = {
    id: definition.id,
    name: requiredString(metadata, 'name'),
    source: 'builtin',
    sourceLabel: definition.sourceLabel,
    ...(optionalString(metadata, 'description')
      ? { description: optionalString(metadata, 'description') }
      : {}),
    ...(optionalString(metadata, 'category')
      ? { category: optionalString(metadata, 'category') }
      : {}),
    titleNodeId,
  };
  return { descriptor, envelope };
};

export const BUILTIN_TEMPLATES: readonly SdocTemplate[] = Object.freeze([
  createBuiltIn({ id: 'builtin:blank', sourceLabel: 'Structured Doc Editor', value: blank }),
  createBuiltIn({
    id: 'builtin:technical-report',
    sourceLabel: 'Structured Doc Editor',
    value: technicalReport,
  }),
  createBuiltIn({
    id: 'builtin:design-specification',
    sourceLabel: 'Structured Doc Editor',
    value: designSpecification,
  }),
  createBuiltIn({
    id: 'builtin:verification-report',
    sourceLabel: 'Structured Doc Editor',
    value: verificationReport,
  }),
]);

export const getBuiltInTemplates = (): SdocTemplate[] =>
  BUILTIN_TEMPLATES.map((template) => structuredClone(template));
