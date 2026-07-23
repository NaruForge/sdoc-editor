export { BUILTIN_TEMPLATES, getBuiltInTemplates } from './builtins';
export { buildTemplateCatalog } from './catalog';
export { instantiateTemplate } from './instantiate';
export {
  createPersonalTemplateSnapshot,
  updatePersonalTemplateMetadata,
} from './personal';
export {
  buildTemplateStructuralPreview,
  TEMPLATE_PREVIEW_MAX_OUTLINE_ITEMS,
  TEMPLATE_PREVIEW_MAX_TEXT_LENGTH,
} from './preview';
export {
  isPersonalTemplateId,
  PERSONAL_TEMPLATE_ID_PATTERN,
  suggestTemplateTitleNodeId,
} from './validation';
export type {
  CreatePersonalTemplateSnapshotOptions,
  InstantiateTemplateOptions,
  SdocTemplate,
  TemplateCandidate,
  TemplateCatalogOptions,
  TemplateCatalogResult,
  TemplateDescriptor,
  TemplateDiagnostic,
  TemplateDiagnosticCode,
  TemplateOutlinePreviewItem,
  TemplateSource,
  TemplateStructuralCounts,
  TemplateStructuralPreview,
  UpdatePersonalTemplateMetadataPatch,
} from './types';
