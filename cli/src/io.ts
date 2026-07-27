import { randomBytes } from 'node:crypto';
import { link, open, readFile, realpath, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const MAX_OPERATIONS_BYTES = 4 * 1024 * 1024;

export class IoError extends Error {
  readonly code: string;
  readonly exitCode: 2 | 3 | 5;

  constructor(code: string, message: string, exitCode: 2 | 3 | 5 = 5, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function resolveDocumentPath(input: string): string {
  const resolved = resolve(input);
  const lower = resolved.toLowerCase();
  if (!lower.endsWith('.sdoc') && !lower.endsWith('.tiptap.json')) {
    throw new IoError('CLI_UNSUPPORTED_EXTENSION', 'Document must end in .sdoc or .tiptap.json', 2);
  }
  return resolved;
}

export function resolveCreatePath(input: string): string {
  const resolved = resolve(input);
  if (!resolved.toLowerCase().endsWith('.sdoc')) {
    throw new IoError('CLI_UNSUPPORTED_EXTENSION', 'New documents must end in .sdoc', 2);
  }
  return resolved;
}

const isTemplateDirectoryPath = (path: string): boolean => {
  const portable = path.replace(/\\/g, '/').toLowerCase();
  return portable.includes('/.sdoc/templates/') || portable.endsWith('/.sdoc/templates');
};

export async function assertCreateDestination(path: string): Promise<void> {
  if (isTemplateDirectoryPath(path)) {
    throw new IoError(
      'CLI_TEMPLATE_DESTINATION_FORBIDDEN',
      'New documents cannot be created inside a .sdoc/templates directory',
      2,
    );
  }
  let canonicalParent: string;
  try {
    canonicalParent = await realpath(dirname(path));
  } catch (error) {
    throw new IoError('CLI_CREATE_FAILED', 'Unable to resolve the destination parent directory', 5, {
      cause: error,
    });
  }
  if (isTemplateDirectoryPath(join(canonicalParent, basename(path)))) {
    throw new IoError(
      'CLI_TEMPLATE_DESTINATION_FORBIDDEN',
      'New documents cannot be created inside a .sdoc/templates directory',
      2,
    );
  }
}

export async function assertCreateTargetAvailable(path: string): Promise<void> {
  try {
    await stat(path);
    throw new IoError('CLI_TARGET_EXISTS', `Target already exists: ${basename(path)}`, 5);
  } catch (error) {
    if (error instanceof IoError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined;
    if (code !== 'ENOENT') {
      throw new IoError('CLI_CREATE_FAILED', 'Unable to inspect the destination path', 5, {
        cause: error,
      });
    }
  }
}

export async function readLimitedFile(path: string, maximum: number, label: string): Promise<Uint8Array> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new IoError('CLI_NOT_A_FILE', `${label} is not a regular file`);
    }
    if (info.size > maximum) {
      throw new IoError(
        'CLI_INPUT_TOO_LARGE',
        `${label} exceeds ${maximum} bytes`,
        label === 'document' ? 3 : 2,
      );
    }
    return await readFile(path);
  } catch (error) {
    if (error instanceof IoError) {
      throw error;
    }
    throw new IoError('CLI_READ_FAILED', `Unable to read ${label}`, 5, { cause: error });
  }
}

export async function readStandardInput(maximum: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximum) {
      throw new IoError('CLI_INPUT_TOO_LARGE', `Operation input exceeds ${maximum} bytes`, 2);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export interface FileLock {
  release(): Promise<void>;
}

export async function acquireSiblingLock(documentPath: string): Promise<FileLock> {
  const lockPath = `${documentPath}.lock`;
  const owner = `${process.pid}:${randomBytes(16).toString('hex')}\n`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(owner, 'utf8');
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
    throw new IoError('CLI_LOCK_UNAVAILABLE', `Unable to acquire lock ${basename(lockPath)}`, 5, { cause: error });
  }
  return {
    async release() {
      await handle.close().catch(() => undefined);
      const currentOwner = await readFile(lockPath, 'utf8').catch(() => undefined);
      if (currentOwner === owner) {
        await rm(lockPath, { force: true }).catch(() => undefined);
      }
    },
  };
}

export async function atomicReplace(
  documentPath: string,
  bytes: Uint8Array,
  replaceFile: (source: string, destination: string) => Promise<void> = rename,
): Promise<void> {
  const directory = dirname(documentPath);
  const suffix = randomBytes(8).toString('hex');
  const tempPath = join(directory, `.${basename(documentPath)}.${process.pid}.${suffix}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await replaceFile(tempPath, documentPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new IoError('CLI_ATOMIC_WRITE_FAILED', 'Unable to atomically replace document', 5, { cause: error });
  }
}

export interface AtomicCreateResult {
  cleanupWarning?: string;
}

export async function atomicCreate(
  documentPath: string,
  bytes: Uint8Array,
  publish: (source: string, destination: string) => Promise<void> = link,
): Promise<AtomicCreateResult> {
  const directory = dirname(documentPath);
  const suffix = randomBytes(8).toString('hex');
  const tempPath = join(directory, `.${basename(documentPath)}.${process.pid}.${suffix}.tmp`);
  let handle: FileHandle | undefined;
  let published = false;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await publish(tempPath, documentPath);
      published = true;
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : undefined;
      if (code === 'EEXIST') {
        throw new IoError('CLI_TARGET_EXISTS', `Target already exists: ${basename(documentPath)}`, 5, {
          cause: error,
        });
      }
      throw new IoError('CLI_CREATE_FAILED', 'Unable to publish the new document', 5, { cause: error });
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (!published) await rm(tempPath, { force: true }).catch(() => undefined);
    if (error instanceof IoError) throw error;
    throw new IoError('CLI_CREATE_FAILED', 'Unable to create the document', 5, { cause: error });
  }
  try {
    await rm(tempPath);
    return {};
  } catch {
    return { cleanupWarning: `Created document but could not remove temporary link ${basename(tempPath)}` };
  }
}

export function suggestedSdocPath(documentPath: string): string {
  const name = basename(documentPath).replace(/\.tiptap\.json$/i, '');
  return join(dirname(documentPath), `${name}.sdoc`);
}
