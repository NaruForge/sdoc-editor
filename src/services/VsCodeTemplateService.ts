import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  buildTemplateCatalog,
  getBuiltInTemplates,
  instantiateTemplate,
  isPersonalTemplateId,
  type SdocTemplate,
  type TemplateCandidate,
  type TemplateCatalogResult,
  type TemplateDiagnostic,
} from '../../shared/template';
import { assertPersistedDocument, parseDocumentContract } from '../../shared/document/documentContract';
import type { SdocEnvelope, TiptapNode } from '../../shared/types';

const TEMPLATE_DIRECTORY_SEGMENTS = ['.sdoc', 'templates'] as const;
const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;
const MAX_TEMPLATE_CANDIDATES = 100;
const PERSONAL_MUTATION_LOCK_STALE_MS = 5 * 60 * 1000;

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
  personalFingerprints: ReadonlyMap<string, string>;
  personalRootPath: string;
}

export interface VsCodeTemplateServiceOptions {
  homeDirectory?: string;
  personalSourceLabel?: string;
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

export interface CurrentDocumentIdentity {
  sessionId: string;
  documentId: string;
  revision: number;
}

export interface PrepareCurrentDocumentTemplateApplicationOptions {
  currentText: string;
  template: SdocTemplate;
  defaultTitle: string;
  now?: () => Date;
}

export interface PreparedTemplateApplication {
  text: string;
  hasReplaceableContent: boolean;
}

export interface CommitCurrentDocumentTemplateApplicationOptions {
  expectedText: string;
  currentText: string;
  expected: CurrentDocumentIdentity;
  current: CurrentDocumentIdentity;
  preparedText: string;
  apply: (text: string) => Promise<void>;
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

export function isUninitializedSdocText(value: string): boolean {
  return value.trim().length === 0;
}

export function canApplyTemplateToCurrentDocument(
  expectedText: string,
  currentText: string,
  expected: CurrentDocumentIdentity,
  current: CurrentDocumentIdentity,
): boolean {
  return expectedText === currentText
    && expected.sessionId === current.sessionId
    && expected.documentId === current.documentId
    && expected.revision === current.revision;
}

export async function commitCurrentDocumentTemplateApplication(
  options: CommitCurrentDocumentTemplateApplicationOptions,
): Promise<boolean> {
  if (!canApplyTemplateToCurrentDocument(
    options.expectedText,
    options.currentText,
    options.expected,
    options.current,
  )) {
    return false;
  }
  await options.apply(options.preparedText);
  return true;
}

const nodeText = (node: TiptapNode): string => {
  if (node.type === 'text') return node.text ?? '';
  return node.content?.map(nodeText).join('') ?? '';
};

const hasReplaceableMetadata = (envelope: SdocEnvelope): boolean => {
  const { title: _title, created: _created, modified: _modified, version, author, settings, ...extra } = envelope.meta;
  return Boolean(author?.trim())
    || Boolean(version && version !== '0.1')
    || Boolean(settings && Object.keys(settings).length > 0)
    || Object.keys(extra).length > 0;
};

export function isBlankSdocDocument(value: unknown): boolean {
  const contract = parseDocumentContract(value);
  if (!contract.ok || contract.legacy || hasReplaceableMetadata(contract.envelope)) return false;

  const title = contract.envelope.meta.title?.trim() ?? '';
  let titleHeadingSeen = false;
  for (const node of contract.envelope.doc.content ?? []) {
    if (node.type === 'paragraph' && nodeText(node).trim().length === 0) continue;
    if (!titleHeadingSeen
      && node.type === 'heading'
      && node.attrs?.numbered === false
      && nodeText(node).trim() === title) {
      titleHeadingSeen = true;
      continue;
    }
    return false;
  }
  return true;
}

export function prepareCurrentDocumentTemplateApplication(
  options: PrepareCurrentDocumentTemplateApplicationOptions,
): PreparedTemplateApplication {
  let value: unknown;
  if (isUninitializedSdocText(options.currentText)) {
    value = {
      sdoc: '1.0',
      meta: { title: options.defaultTitle.trim() || 'Untitled' },
      doc: { type: 'doc', content: [] },
    };
  } else {
    try {
      value = JSON.parse(options.currentText);
    } catch {
      throw new Error('Template application requires a valid SDOC document.');
    }
  }
  const contract = parseDocumentContract(value);
  if (!contract.ok || contract.legacy) {
    throw new Error('Template application requires a valid SDOC 1.0 document.');
  }
  const title = contract.envelope.meta.title?.trim() || options.defaultTitle.trim() || 'Untitled';
  const instantiated = instantiateTemplate(options.template, {
    title,
    ...(options.now ? { now: options.now } : {}),
  });
  const { template: _currentTemplate, settings: _currentSettings, ...preservedMeta } = contract.envelope.meta;
  const envelope: SdocEnvelope = {
    ...instantiated,
    meta: {
      ...instantiated.meta,
      ...preservedMeta,
      title,
      modified: instantiated.meta.modified,
      ...(instantiated.meta.settings ? { settings: instantiated.meta.settings } : {}),
    },
  };
  assertPersistedDocument(envelope);
  return {
    text: `${JSON.stringify(envelope, null, 2)}\n`,
    hasReplaceableContent: !isBlankSdocDocument(value),
  };
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
  private readonly homeDirectory: string;
  private readonly personalSourceLabel?: string;

  public constructor(options: VsCodeTemplateServiceOptions = {}) {
    this.homeDirectory = path.resolve(options.homeDirectory ?? homedir());
    this.personalSourceLabel = options.personalSourceLabel;
  }

  public get personalTemplateRootPath(): string {
    return path.join(this.homeDirectory, ...TEMPLATE_DIRECTORY_SEGMENTS);
  }

  public async ensurePersonalTemplateRoot(): Promise<string> {
    return this.ensurePersonalRoot();
  }

  public async discover(workspaces: readonly WorkspaceTemplateRoot[]): Promise<VsCodeTemplateCatalog> {
    const workspaceCandidates: TemplateCandidate[] = [];
    const userCandidates: TemplateCandidate[] = [];
    const personalFingerprints = new Map<string, string>();
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
        if (workspaceCandidates.length >= MAX_TEMPLATE_CANDIDATES) {
          if (!limitReported) {
            limitReported = true;
            hostDiagnostics.push({
              code: 'candidate-limit-exceeded',
              targetPath: templateDirectory,
              message: `Only the first ${MAX_TEMPLATE_CANDIDATES} workspace templates are loaded.`,
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

    const personalRootPath = this.personalTemplateRootPath;
    try {
      const canonicalHome = await realpath(this.homeDirectory);
      const canonicalPersonalRoot = await realpath(personalRootPath);
      if (!isContainedPath(canonicalHome, canonicalPersonalRoot)) {
        hostDiagnostics.push({
          code: 'template-root-outside-workspace',
          targetPath: personalRootPath,
          message: 'The personal template directory resolves outside the extension-host home.',
        });
      } else {
        const entries = await readdir(canonicalPersonalRoot, { withFileTypes: true });
        const candidates = entries
          .filter((entry) => entry.name.toLocaleLowerCase('en-US').endsWith('.sdoc'))
          .sort((left, right) => left.name.localeCompare(right.name, 'en'));
        if (candidates.length > MAX_TEMPLATE_CANDIDATES) {
          hostDiagnostics.push({
            code: 'candidate-limit-exceeded',
            targetPath: personalRootPath,
            message: `Only the first ${MAX_TEMPLATE_CANDIDATES} personal templates are loaded.`,
          });
        }
        for (const entry of candidates.slice(0, MAX_TEMPLATE_CANDIDATES)) {
          const stem = entry.name.slice(0, -5);
          const requestedPath = path.join(canonicalPersonalRoot, entry.name);
          if (!isPersonalTemplateId(`user:${stem}`)) {
            hostDiagnostics.push({
              code: 'unsupported-file-type',
              targetPath: requestedPath,
              message: 'Personal template file names must be UUIDs with the .sdoc extension.',
            });
            continue;
          }
          try {
            const canonicalFile = await realpath(requestedPath);
            if (!isContainedPath(canonicalPersonalRoot, canonicalFile)) {
              hostDiagnostics.push({
                code: 'template-file-outside-root',
                targetPath: requestedPath,
                message: 'The personal template file resolves outside the personal template directory.',
              });
              continue;
            }
            const fileStat = await stat(canonicalFile);
            if (!fileStat.isFile()) {
              hostDiagnostics.push({
                code: 'unsupported-file-type',
                targetPath: requestedPath,
                message: 'Personal template candidates must be regular files.',
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
            const bytes = await readFile(canonicalFile);
            const templateKey = `user:${stem.toLocaleLowerCase('en-US')}`;
            personalFingerprints.set(templateKey, createHash('sha256').update(bytes).digest('hex'));
            const value: unknown = JSON.parse(bytes.toString('utf8'));
            userCandidates.push({
              id: templateKey,
              source: 'user',
              sourceLabel: this.personalSourceLabel ?? `Extension host · ${personalRootPath}`,
              fileName: entry.name,
              value,
              targetPath: canonicalFile,
            });
          } catch (error) {
            hostDiagnostics.push({
              code: error instanceof SyntaxError ? 'invalid-json' : 'read-failed',
              targetPath: requestedPath,
              message: error instanceof SyntaxError
                ? 'Personal template file is not valid JSON.'
                : `Unable to read personal template file: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        hostDiagnostics.push({
          code: 'read-failed',
          targetPath: personalRootPath,
          message: `Unable to inspect personal template directory: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return {
      catalog: buildTemplateCatalog({
        builtIn: getBuiltInTemplates(),
        workspaceCandidates,
        userCandidates,
      }),
      hostDiagnostics,
      personalFingerprints,
      personalRootPath,
    };
  }

  public async createPersonalTemplate(templateId: string, envelope: SdocEnvelope): Promise<void> {
    const uuid = this.requirePersonalUuid(templateId);
    const serialized = this.serializePersonalTemplate(uuid, envelope);
    const canonicalRoot = await this.ensurePersonalRoot();
    await this.withPersonalMutationLock(canonicalRoot, async () => {
      const entries = await readdir(canonicalRoot, { withFileTypes: true });
      const candidateCount = entries.filter((entry) =>
        path.extname(entry.name).toLocaleLowerCase('en-US') === '.sdoc').length;
      if (candidateCount >= MAX_TEMPLATE_CANDIDATES) {
        throw new Error(`Personal template limit of ${MAX_TEMPLATE_CANDIDATES} has been reached.`);
      }
      const targetPath = path.join(canonicalRoot, `${uuid}.sdoc`);
      const temporaryPath = path.join(canonicalRoot, `.${uuid}.${randomUUID()}.tmp`);
      await writeFile(temporaryPath, serialized, {
        encoding: 'utf8',
        flag: 'wx',
      });
      try {
        await link(temporaryPath, targetPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    });
  }

  public async updatePersonalTemplate(
    templateId: string,
    expectedFingerprint: string,
    envelope: SdocEnvelope,
  ): Promise<void> {
    const uuid = this.requirePersonalUuid(templateId);
    const serialized = this.serializePersonalTemplate(uuid, envelope);
    const canonicalRoot = await this.ensurePersonalRoot();
    await this.withPersonalMutationLock(canonicalRoot, async () => {
      const { canonicalTarget } = await this.verifyPersonalTemplate(uuid, expectedFingerprint);
      const temporaryPath = path.join(canonicalRoot, `.${uuid}.${randomUUID()}.tmp`);
      await writeFile(temporaryPath, serialized, {
        encoding: 'utf8',
        flag: 'wx',
      });
      try {
        await rename(temporaryPath, canonicalTarget);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    });
  }

  public async trashPersonalTemplate(templateId: string, expectedFingerprint: string): Promise<void> {
    const uuid = this.requirePersonalUuid(templateId);
    const canonicalRoot = await this.ensurePersonalRoot();
    await this.withPersonalMutationLock(canonicalRoot, async () => {
      const { canonicalTarget } = await this.verifyPersonalTemplate(uuid, expectedFingerprint);
      const trashPath = path.join(canonicalRoot, '.trash');
      await mkdir(trashPath, { recursive: true });
      const canonicalTrash = await realpath(trashPath);
      if (!isContainedPath(canonicalRoot, canonicalTrash)) {
        throw new Error('The personal template trash directory resolves outside the template root.');
      }
      const destination = path.join(canonicalTrash, `${uuid}-${Date.now()}-${randomUUID()}.sdoc`);
      await rename(canonicalTarget, destination);
    });
  }

  private requirePersonalUuid(templateId: string): string {
    const uuid = templateId.startsWith('user:') ? templateId.slice(5) : templateId;
    if (!isPersonalTemplateId(`user:${uuid}`)) {
      throw new Error('A lowercase canonical personal template UUID is required.');
    }
    return uuid;
  }

  private requireMatchingEnvelopeId(uuid: string, envelope: SdocEnvelope): void {
    const metadata = envelope.meta.template;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || !('id' in metadata) || metadata.id !== `user:${uuid}`) {
      throw new Error('The persisted personal template ID must exactly match the target UUID.');
    }
  }

  private serializePersonalTemplate(uuid: string, envelope: SdocEnvelope): string {
    assertPersistedDocument(envelope);
    this.requireMatchingEnvelopeId(uuid, envelope);
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_TEMPLATE_BYTES) {
      throw new Error(`Personal template exceeds the ${MAX_TEMPLATE_BYTES} byte size limit.`);
    }
    return serialized;
  }

  private async withPersonalMutationLock<T>(
    canonicalRoot: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = path.join(canonicalRoot, '.mutation.lock');
    const owner = randomUUID();
    await this.acquirePersonalMutationLock(lockPath, owner);
    try {
      return await operation();
    } finally {
      try {
        const value: unknown = JSON.parse(await readFile(lockPath, 'utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)
          && 'owner' in value && value.owner === owner) {
          await rm(lockPath, { force: true });
        }
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
  }

  private async acquirePersonalMutationLock(lockPath: string, owner: string): Promise<void> {
    const payload = `${JSON.stringify({ owner, createdAt: Date.now() })}\n`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(lockPath, 'wx');
        await handle.writeFile(payload, { encoding: 'utf8' });
        await handle.sync();
        await handle.close();
        return;
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => undefined);
          await rm(lockPath, { force: true }).catch(() => undefined);
        }
        if (errorCode(error) !== 'EEXIST') throw error;
      }

      let existing: unknown;
      try {
        existing = JSON.parse(await readFile(lockPath, 'utf8'));
      } catch {
        existing = undefined;
      }
      let createdAt = existing && typeof existing === 'object' && !Array.isArray(existing)
        && 'createdAt' in existing && typeof existing.createdAt === 'number'
        ? existing.createdAt
        : undefined;
      if (createdAt === undefined) {
        try {
          createdAt = (await stat(lockPath)).mtimeMs;
        } catch (error) {
          if (errorCode(error) === 'ENOENT') continue;
          throw error;
        }
      }
      if (Date.now() - createdAt <= PERSONAL_MUTATION_LOCK_STALE_MS) {
        throw new Error('Another host is already changing the personal template library.');
      }

      const stalePath = `${lockPath}.stale.${randomUUID()}`;
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { force: true });
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
    throw new Error('Unable to acquire the personal template library mutation lock.');
  }

  private async ensurePersonalRoot(): Promise<string> {
    const managementRoot = path.join(this.homeDirectory, TEMPLATE_DIRECTORY_SEGMENTS[0]);
    await mkdir(managementRoot, { recursive: true });
    const [canonicalHome, canonicalManagementRoot] = await Promise.all([
      realpath(this.homeDirectory),
      realpath(managementRoot),
    ]);
    if (!isContainedPath(canonicalHome, canonicalManagementRoot)) {
      throw new Error('The personal template directory resolves outside the extension-host home.');
    }
    await mkdir(this.personalTemplateRootPath, { recursive: true });
    const canonicalRoot = await realpath(this.personalTemplateRootPath);
    if (!isContainedPath(canonicalManagementRoot, canonicalRoot)) {
      throw new Error('The personal template directory resolves outside the managed .sdoc directory.');
    }
    return canonicalRoot;
  }

  private async verifyPersonalTemplate(
    uuid: string,
    expectedFingerprint: string,
  ): Promise<{ canonicalRoot: string; canonicalTarget: string }> {
    const canonicalRoot = await this.ensurePersonalRoot();
    const requestedTarget = path.join(canonicalRoot, `${uuid}.sdoc`);
    const canonicalTarget = await realpath(requestedTarget);
    if (!isContainedPath(canonicalRoot, canonicalTarget)) {
      throw new Error('The personal template file resolves outside the template root.');
    }
    const fileStat = await stat(canonicalTarget);
    if (!fileStat.isFile()) throw new Error('The personal template is not a regular file.');
    const bytes = await readFile(canonicalTarget);
    const actualFingerprint = createHash('sha256').update(bytes).digest('hex');
    if (actualFingerprint !== expectedFingerprint) {
      throw new Error('The personal template changed outside the editor; refresh and try again.');
    }
    return { canonicalRoot, canonicalTarget };
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
