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
  DOCUMENT_TITLE_MAX_LENGTH,
  isPersonalTemplateId,
  normalizeDocumentTitle,
  PERSONAL_TEMPLATE_ID_PATTERN,
  suggestTemplateTitleNodeId,
  validateDocumentTitle,
} from './validation';
export type {
  CreatePersonalTemplateSnapshotOptions,
  DocumentTitleValidationResult,
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
  TemplatePreviewAssetScope,
  TemplateReplacementScope,
  TemplateStructuralCounts,
  TemplateStructuralPreview,
  UpdatePersonalTemplateMetadataPatch,
} from './types';
