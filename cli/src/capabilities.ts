import type { SdocOperation } from '../../shared/document/operations/index.js';
import { getBuiltInTemplates } from '../../shared/template/index.js';
import { COMMAND_NAMES } from './arguments.js';
import { MAX_DOCUMENT_BYTES, MAX_OPERATIONS_BYTES } from './io.js';
import { CLI_RESPONSE_CONTRACT, type OutputRecord } from './response.js';

const SEMANTIC_OPERATION_NAMES: Record<SdocOperation['op'], true> = {
  renameHeading: true,
  setDocumentTitle: true,
  updateDocumentMetadata: true,
  updateDocumentSettings: true,
  insertBlock: true,
  insertSection: true,
  replaceBlock: true,
  updateBlockAttrs: true,
  moveBlock: true,
  deleteBlock: true,
  moveSection: true,
  deleteSection: true,
  setHeadingLevel: true,
  renameBlockId: true,
};

export function capabilitiesRecord(cliVersion: string): OutputRecord {
  return {
    ok: true,
    command: 'capabilities',
    cliVersion,
    contracts: {
      document: 'sdoc/1.0',
      operations: 'sdoc.operations/1',
      read: 'sdoc.read/1',
      response: CLI_RESPONSE_CONTRACT,
    },
    commands: [...COMMAND_NAMES],
    semanticOperations: Object.keys(SEMANTIC_OPERATION_NAMES),
    limits: {
      documentBytes: MAX_DOCUMENT_BYTES,
      operationInputBytes: MAX_OPERATIONS_BYTES,
      operationCount: 100,
      documentNodes: 100_000,
      inspectLegacyMaxBlocks: 10_000,
      readCatalogLimit: 10_000,
      readMaxBytes: MAX_DOCUMENT_BYTES,
      readMaxNodes: 100_000,
    },
    projections: ['catalog', 'target', 'section', 'document'],
    catalogKinds: ['blocks', 'outline', 'references', 'referenceables', 'endnotes'],
    builtInTemplateIds: getBuiltInTemplates().map((template) => template.descriptor.id),
  };
}
