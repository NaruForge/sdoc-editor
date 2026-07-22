import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTemplateCatalog,
  getBuiltInTemplates,
  instantiateTemplate,
  type SdocTemplate,
  type TemplateCandidate,
  type TemplateCatalogResult,
  type TemplateDiagnostic,
} from '../../shared/template';

const TEMPLATE_DIRECTORY_SEGMENTS = ['.sdoc', 'templates'] as const;
const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;
const MAX_WORKSPACE_TEMPLATES = 100;

export interface WorkspaceTemplateRoot {
  identity: string;
  name: string;
  rootPath: string;
}

export type HostTemplateDiagnosticCode =
  | 'invalid-json'
  | 'read-failed'
  | 'file-too-large'
  | 'candidate-limit-exceeded'
  | 'template-root-outside-workspace'
  | 'template-file-outside-root'
  | 'unsupported-file-type';

export interface HostTemplateDiagnostic {
  code: HostTemplateDiagnosticCode;
  targetPath: string;
  message: string;
}

export interface VsCodeTemplateCatalog {
  catalog: TemplateCatalogResult;
  hostDiagnostics: HostTemplateDiagnostic[];
}

export type NewSdocDiagnostic = TemplateDiagnostic | HostTemplateDiagnostic;

export interface NewSdocWorkflowHost {
  selectTemplate(templates: readonly SdocTemplate[]): Promise<SdocTemplate | undefined>;
  requestTitle(): Promise<string | undefined>;
  selectTarget(defaultFileName: string): Promise<string | undefined>;
  flushActiveDocument(): Promise<void>;
  openDocument(targetPath: string): Promise<void>;
  reportDiagnostics(diagnostics: readonly NewSdocDiagnostic[]): void;
}

export interface NewSdocWorkflowOptions {
  now?: () => Date;
}

const isContainedPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const toPortableRelativePath = (value: string): string => value.split(path.sep).join('/');

const errorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
};

export function isFilesystemBackedScheme(scheme: string): boolean {
  return scheme === 'file' || scheme === 'vscode-remote';
}

export function isWorkspaceTemplatePath(value: string): boolean {
  const portablePath = value.replace(/\\/g, '/').toLocaleLowerCase('en-US');
  return portablePath.startsWith('.sdoc/templates/')
    || portablePath.includes('/.sdoc/templates/');
}

export function validateDocumentTitle(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a document title.';
  if (trimmed.length > 200) return 'The title must be 200 characters or fewer.';
  return undefined;
}

export function suggestSdocFileName(title: string): string {
  const sanitized = title.trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return `${sanitized || 'Untitled'}.sdoc`;
}

export class VsCodeTemplateService {
  public async discover(workspaces: readonly WorkspaceTemplateRoot[]): Promise<VsCodeTemplateCatalog> {
    const workspaceCandidates: TemplateCandidate[] = [];
    const hostDiagnostics: HostTemplateDiagnostic[] = [];
    let limitReported = false;

    for (const workspace of workspaces) {
      const templateDirectory = path.join(workspace.rootPath, ...TEMPLATE_DIRECTORY_SEGMENTS);
      let canonicalWorkspace: string;
      let canonicalTemplateDirectory: string;
      try {
        [canonicalWorkspace, canonicalTemplateDirectory] = await Promise.all([
          realpath(workspace.rootPath),
          realpath(templateDirectory),
        ]);
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue;
        hostDiagnostics.push({
          code: 'read-failed',
          targetPath: templateDirectory,
          message: `Unable to inspect template directory: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      if (!isContainedPath(canonicalWorkspace, canonicalTemplateDirectory)) {
        hostDiagnostics.push({
          code: 'template-root-outside-workspace',
          targetPath: templateDirectory,
          message: 'The template directory resolves outside its workspace.',
        });
        continue;
      }

      let entries;
      try {
        entries = await readdir(canonicalTemplateDirectory, { withFileTypes: true });
      } catch (error) {
        hostDiagnostics.push({
          code: 'read-failed',
          targetPath: templateDirectory,
          message: `Unable to read template directory: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
      for (const entry of entries) {
        if (!entry.name.toLocaleLowerCase('en-US').endsWith('.sdoc')) continue;
        if (workspaceCandidates.length >= MAX_WORKSPACE_TEMPLATES) {
          if (!limitReported) {
            limitReported = true;
            hostDiagnostics.push({
              code: 'candidate-limit-exceeded',
              targetPath: templateDirectory,
              message: `Only the first ${MAX_WORKSPACE_TEMPLATES} workspace templates are loaded.`,
            });
          }
          break;
        }

        const requestedPath = path.join(canonicalTemplateDirectory, entry.name);
        let canonicalFile: string;
        try {
          canonicalFile = await realpath(requestedPath);
        } catch (error) {
          hostDiagnostics.push({
            code: 'read-failed',
            targetPath: requestedPath,
            message: `Unable to resolve template file: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
        if (!isContainedPath(canonicalTemplateDirectory, canonicalFile)) {
          hostDiagnostics.push({
            code: 'template-file-outside-root',
            targetPath: requestedPath,
            message: 'The template file resolves outside the template directory.',
          });
          continue;
        }

        try {
          const fileStat = await stat(canonicalFile);
          if (!fileStat.isFile()) {
            hostDiagnostics.push({
              code: 'unsupported-file-type',
              targetPath: requestedPath,
              message: 'Template candidates must be regular files.',
            });
            continue;
          }
          if (fileStat.size > MAX_TEMPLATE_BYTES) {
            hostDiagnostics.push({
              code: 'file-too-large',
              targetPath: requestedPath,
              message: `Template file exceeds the ${MAX_TEMPLATE_BYTES} byte limit.`,
            });
            continue;
          }
          const value: unknown = JSON.parse(await readFile(canonicalFile, 'utf8'));
          const relativePath = toPortableRelativePath(path.join(...TEMPLATE_DIRECTORY_SEGMENTS, entry.name));
          workspaceCandidates.push({
            id: `workspace:${workspace.identity}:${relativePath}`,
            source: 'workspace',
            sourceLabel: `${workspace.name} · ${relativePath}`,
            fileName: entry.name,
            value,
            targetPath: canonicalFile,
          });
        } catch (error) {
          hostDiagnostics.push({
            code: error instanceof SyntaxError ? 'invalid-json' : 'read-failed',
            targetPath: requestedPath,
            message: error instanceof SyntaxError
              ? 'Template file is not valid JSON.'
              : `Unable to read template file: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    return {
      catalog: buildTemplateCatalog({
        builtIn: getBuiltInTemplates(),
        workspaceCandidates,
      }),
      hostDiagnostics,
    };
  }

  public async createExclusive(
    template: SdocTemplate,
    title: string,
    targetPath: string,
    workspaces: readonly WorkspaceTemplateRoot[],
    now?: () => Date,
  ): Promise<void> {
    const titleError = validateDocumentTitle(title);
    if (titleError) throw new Error(titleError);
    if (path.extname(targetPath).toLocaleLowerCase('en-US') !== '.sdoc') {
      throw new Error('The destination must use the .sdoc extension.');
    }
    if (await this.isTemplateDestination(targetPath, workspaces)) {
      throw new Error('New documents cannot be created inside a template directory.');
    }

    const envelope = instantiateTemplate(template, { title: title.trim(), ...(now ? { now } : {}) });
    await writeFile(targetPath, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  }

  private async isTemplateDestination(
    targetPath: string,
    workspaces: readonly WorkspaceTemplateRoot[],
  ): Promise<boolean> {
    const absoluteTarget = path.resolve(targetPath);
    if (isWorkspaceTemplatePath(absoluteTarget)) return true;
    let canonicalParent: string | undefined;
    try {
      canonicalParent = await realpath(path.dirname(absoluteTarget));
    } catch {
      // The exclusive write will report an invalid or missing parent later.
    }
    if (canonicalParent) {
      const canonicalTarget = path.join(canonicalParent, path.basename(absoluteTarget));
      if (isWorkspaceTemplatePath(canonicalTarget)) return true;
    }

    for (const workspace of workspaces) {
      const templateDirectory = path.resolve(workspace.rootPath, ...TEMPLATE_DIRECTORY_SEGMENTS);
      if (isContainedPath(templateDirectory, absoluteTarget)) return true;
      if (!canonicalParent) continue;
      try {
        const canonicalTemplateDirectory = await realpath(templateDirectory);
        const canonicalTarget = path.join(canonicalParent, path.basename(absoluteTarget));
        if (isContainedPath(canonicalTemplateDirectory, canonicalTarget)) return true;
      } catch {
        // A workspace without a template directory cannot contain this destination.
      }
    }
    return false;
  }
}

export async function runNewSdocWorkflow(
  service: VsCodeTemplateService,
  workspaces: readonly WorkspaceTemplateRoot[],
  host: NewSdocWorkflowHost,
  options: NewSdocWorkflowOptions = {},
): Promise<string | undefined> {
  const discovery = await service.discover(workspaces);
  const diagnostics: NewSdocDiagnostic[] = [
    ...discovery.hostDiagnostics,
    ...discovery.catalog.diagnostics,
  ];
  if (diagnostics.length > 0) host.reportDiagnostics(diagnostics);

  const template = await host.selectTemplate(discovery.catalog.templates);
  if (!template) return undefined;
  const title = await host.requestTitle();
  if (title === undefined) return undefined;
  const titleError = validateDocumentTitle(title);
  if (titleError) throw new Error(titleError);
  const targetPath = await host.selectTarget(suggestSdocFileName(title));
  if (!targetPath) return undefined;

  await host.flushActiveDocument();
  await service.createExclusive(template, title, targetPath, workspaces, options.now);
  await host.openDocument(targetPath);
  return targetPath;
}
