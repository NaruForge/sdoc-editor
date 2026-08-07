import { basename, resolve } from 'node:path';
import {
  buildTemplateCatalog,
  getBuiltInTemplates,
  instantiateTemplate,
  validateDocumentTitle,
  type SdocTemplate,
} from '../../shared/template/index.js';
import { computeRevision } from '../../shared/document/operations/index.js';
import { ArgumentError } from './arguments.js';
import { IoError, readLimitedFile } from './io.js';
import { parseJsonInput } from './jsonInput.js';

const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TEMPLATE = 'builtin:blank';

export type TemplateSelection =
  | { kind: 'builtin'; id: string }
  | { kind: 'file'; path: string };

export interface CreatedDocumentPlan {
  bytes: Uint8Array;
  revision: `sha256:${string}`;
  title: string;
  template: TemplateSelection;
  templateLabel: string;
}

function builtInTemplate(selector: string): SdocTemplate {
  const template = getBuiltInTemplates().find((candidate) => candidate.descriptor.id === selector);
  if (!template) {
    throw new ArgumentError('CLI_UNKNOWN_TEMPLATE', `Unknown built-in template: ${selector}`);
  }
  return template;
}

async function fileTemplate(selector: string): Promise<{ template: SdocTemplate; path: string }> {
  const path = resolve(selector);
  if (!path.toLowerCase().endsWith('.sdoc')) {
    throw new ArgumentError('CLI_UNSUPPORTED_TEMPLATE_EXTENSION', 'Template file must end in .sdoc');
  }
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedFile(path, MAX_TEMPLATE_BYTES, 'template');
  } catch (error) {
    if (error instanceof IoError && error.code === 'CLI_INPUT_TOO_LARGE') {
      throw new IoError('CLI_TEMPLATE_TOO_LARGE', `Template exceeds ${MAX_TEMPLATE_BYTES} bytes`, 3);
    }
    throw error;
  }
  const candidateId = `cli-file:${path}`;
  const catalog = buildTemplateCatalog({
    builtIn: [],
    workspaceCandidates: [{
      id: candidateId,
      source: 'workspace',
      sourceLabel: 'Explicit CLI template',
      fileName: basename(path),
      value: parseJsonInput(bytes, 'Template', {
        invalidUtf8: (message) => new IoError('CLI_TEMPLATE_INVALID', message, 3),
        invalidJson: (message) => new IoError('CLI_TEMPLATE_INVALID', message, 3),
      }),
      targetPath: path,
    }],
  });
  const template = catalog.templates[0];
  if (!template || catalog.diagnostics.length > 0) {
    const message = catalog.diagnostics.map((item) => item.message).join('; ')
      || 'Template does not satisfy the SDOC template contract';
    throw new IoError('CLI_TEMPLATE_INVALID', message, 3);
  }
  return { template, path };
}

function defaultTitle(documentPath: string): string {
  return basename(documentPath).replace(/\.sdoc$/i, '') || 'Untitled';
}

export async function createDocumentPlan(
  documentPath: string,
  options: { title?: string; template?: string; now?: () => Date } = {},
): Promise<CreatedDocumentPlan> {
  const title = (options.title ?? defaultTitle(documentPath)).trim();
  const titleError = validateDocumentTitle(title);
  if (titleError) throw new ArgumentError('CLI_INVALID_TITLE', titleError);

  const selector = options.template ?? DEFAULT_TEMPLATE;
  let template: SdocTemplate;
  let selection: TemplateSelection;
  if (selector.startsWith('builtin:')) {
    template = builtInTemplate(selector);
    selection = { kind: 'builtin', id: selector };
  } else {
    const file = await fileTemplate(selector);
    template = file.template;
    selection = { kind: 'file', path: file.path };
  }
  const envelope = instantiateTemplate(template, { title, ...(options.now ? { now: options.now } : {}) });
  const bytes = Buffer.from(`${JSON.stringify(envelope, undefined, 2)}\n`, 'utf8');
  return {
    bytes,
    revision: computeRevision(bytes),
    title,
    template: selection,
    templateLabel: selection.kind === 'builtin' ? selection.id : selection.path,
  };
}
