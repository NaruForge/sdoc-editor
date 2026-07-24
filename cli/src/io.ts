import { randomBytes } from 'node:crypto';
import { open, readFile, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

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

export function suggestedOutputName(documentPath: string): string {
  return `${basename(documentPath, extname(documentPath))}.preview.sdoc`;
}
