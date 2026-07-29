export { buildExternalDocumentDiff } from './diff';
export { buildExternalChangeComparison, type ExternalChangeComparisonLabels } from './comparisonModel';
export { ExternalChangeBanner, type ExternalChangeBannerProps } from './ExternalChangeBanner';
export {
  ExternalChangePrompt,
  externalChangePromptTabTarget,
  initialExternalChangePromptState,
  reduceExternalChangePromptState,
  type ExternalChangePromptEvent,
  type ExternalChangePromptLabels,
  type ExternalChangePromptProps,
  type ExternalChangePromptState,
  type ExternalChangeResolution,
} from './ExternalChangePrompt';
export { ExternalChangeComparison, type ExternalChangeComparisonProps } from './ExternalChangeComparison';
export type {
  ExternalBlockChangeKind,
  ExternalBlockDiff,
  ExternalBlockIdentityStrategy,
  ExternalBlockSnapshot,
  ExternalChangeComparisonModel,
  ExternalChangeComparisonRow,
  ExternalChangeComparisonSide,
  ExternalDocumentDiff,
  ExternalDocumentDiffSummary,
} from './types';
