import { randomBytes } from 'node:crypto';
import { link, open, readFile, realpath, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { MAX_DOCUMENT_BYTES as SHARED_MAX_DOCUMENT_BYTES } from '../../shared/resourceLimits';

export const MAX_DOCUMENT_BYTES = SHARED_MAX_DOCUMENT_BYTES;
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
    const bytes = await readFile(path);
    if (bytes.byteLength > maximum) {
      throw new IoError(
        'CLI_INPUT_TOO_LARGE',
        `${label} exceeds ${maximum} bytes`,
        label === 'document' ? 3 : 2,
      );
    }
    return bytes;
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

export type LockProcessStatus = 'alive' | 'dead' | 'unknown';

export interface LockAcquisitionOptions {
  now?: () => number;
  hostname?: () => string;
  pid?: number;
  createToken?: () => string;
  processStatus?: (pid: number) => LockProcessStatus | Promise<LockProcessStatus>;
  renameStaleLock?: (source: string, destination: string) => Promise<void>;
}

interface LockOwner {
  version: 1;
  pid: number;
  token: string;
  hostname: string;
  createdAt: string;
}

interface ParsedLockOwner {
  owner: LockOwner;
  createdAtMilliseconds: number;
}

interface CreatedLock {
  kind: 'created';
  handle: FileHandle;
}

interface ExistingLock {
  kind: 'exists';
  cause: unknown;
}

const LOCK_OWNER_VERSION = 1;
const STALE_LOCK_GRACE_MILLISECONDS = 60_000;
const MAX_LOCK_OWNER_BYTES = 4 * 1024;
const LOCK_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const activeLockOwners = new Map<string, string>();
const LOCK_OWNER_TOO_LARGE = Symbol('lock-owner-too-large');

async function readBoundedLockOwner(
  path: string,
): Promise<string | typeof LOCK_OWNER_TOO_LARGE | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    const bytes = Buffer.allocUnsafe(MAX_LOCK_OWNER_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_LOCK_OWNER_BYTES) return LOCK_OWNER_TOO_LARGE;
    return bytes.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function defaultProcessStatus(pid: number): LockProcessStatus {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return errorCode(error) === 'ESRCH' ? 'dead' : 'unknown';
  }
}

function parseLockOwner(value: string): ParsedLockOwner | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== LOCK_OWNER_VERSION
    || !Number.isSafeInteger(record.pid)
    || Number(record.pid) <= 0
    || typeof record.token !== 'string'
    || !LOCK_TOKEN_PATTERN.test(record.token)
    || typeof record.hostname !== 'string'
    || record.hostname.trim().length === 0
    || typeof record.createdAt !== 'string'
  ) {
    return undefined;
  }
  const createdAtMilliseconds = Date.parse(record.createdAt);
  if (
    !Number.isFinite(createdAtMilliseconds)
    || new Date(createdAtMilliseconds).toISOString() !== record.createdAt
  ) {
    return undefined;
  }
  return {
    owner: {
      version: LOCK_OWNER_VERSION,
      pid: Number(record.pid),
      token: record.token,
      hostname: record.hostname,
      createdAt: record.createdAt,
    },
    createdAtMilliseconds,
  };
}

function unavailableMessage(lockPath: string, reason: string): string {
  const name = basename(lockPath);
  return `Unable to acquire lock ${name}: ${reason}. Remove ${name} manually only after confirming no writer is active, then re-inspect the document before retrying.`;
}

function lockUnavailable(lockPath: string, reason: string, cause?: unknown): IoError {
  return new IoError('CLI_LOCK_UNAVAILABLE', unavailableMessage(lockPath, reason), 5, { cause });
}

async function createOwnedLock(
  lockPath: string,
  ownerText: string,
): Promise<CreatedLock | ExistingLock> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(ownerText, 'utf8');
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
    if (!handle && errorCode(error) === 'EEXIST') return { kind: 'exists', cause: error };
    throw lockUnavailable(lockPath, 'the lock file could not be created safely', error);
  }

  const currentOwner = await readBoundedLockOwner(lockPath);
  if (currentOwner !== ownerText) {
    await handle.close().catch(() => undefined);
    throw lockUnavailable(lockPath, 'ownership changed while the lock was being acquired');
  }
  return { kind: 'created', handle };
}

async function restoreCompetingOwner(
  quarantinedPath: string,
  lockPath: string,
): Promise<boolean> {
  try {
    await link(quarantinedPath, lockPath);
    await rm(quarantinedPath);
    return true;
  } catch {
    return false;
  }
}

async function reclaimStaleLock(
  lockPath: string,
  ownerText: string,
  owner: ParsedLockOwner,
  newOwnerToken: string,
  options: Required<Pick<LockAcquisitionOptions, 'now' | 'hostname' | 'processStatus' | 'renameStaleLock'>>,
): Promise<void> {
  if (owner.owner.hostname.toLowerCase() !== options.hostname().toLowerCase()) {
    throw lockUnavailable(lockPath, `the owner metadata belongs to host ${owner.owner.hostname}`);
  }

  const age = options.now() - owner.createdAtMilliseconds;
  if (age < STALE_LOCK_GRACE_MILLISECONDS) {
    throw lockUnavailable(lockPath, 'the lock has not reached the 60 second stale-lock grace period');
  }

  const status = await options.processStatus(owner.owner.pid);
  if (status === 'alive') {
    throw lockUnavailable(lockPath, 'the owner process is still running on this host');
  }
  if (status !== 'dead') {
    throw lockUnavailable(lockPath, 'the owner process could not be proven dead');
  }

  const recheckedOwner = await readBoundedLockOwner(lockPath);
  if (recheckedOwner !== ownerText) {
    throw lockUnavailable(lockPath, 'ownership changed before stale-lock recovery');
  }

  const quarantinedPath = `${lockPath}.stale-${newOwnerToken}`;
  try {
    await options.renameStaleLock(lockPath, quarantinedPath);
  } catch (error) {
    throw lockUnavailable(lockPath, 'another writer changed the lock during stale-lock recovery', error);
  }

  const quarantinedOwner = await readBoundedLockOwner(quarantinedPath);
  if (quarantinedOwner !== ownerText) {
    const restored = await restoreCompetingOwner(quarantinedPath, lockPath);
    throw lockUnavailable(
      lockPath,
      restored
        ? 'a competing owner won during stale-lock recovery and its lock was restored'
        : `a competing owner won during stale-lock recovery; inspect ${basename(quarantinedPath)} before manual recovery`,
    );
  }
  await rm(quarantinedPath, { force: true }).catch(() => undefined);
}

export async function acquireSiblingLock(
  documentPath: string,
  options: LockAcquisitionOptions = {},
): Promise<FileLock> {
  const lockPath = `${documentPath}.lock`;
  const now = options.now ?? Date.now;
  const currentHostname = options.hostname ?? hostname;
  const localHostname = currentHostname();
  const pid = options.pid ?? process.pid;
  const createToken = options.createToken ?? (() => randomBytes(16).toString('hex'));
  const processStatus = options.processStatus ?? defaultProcessStatus;
  const renameStaleLock = options.renameStaleLock ?? rename;
  const owner: LockOwner = {
    version: LOCK_OWNER_VERSION,
    pid,
    token: createToken(),
    hostname: localHostname,
    createdAt: new Date(now()).toISOString(),
  };
  const ownerText = `${JSON.stringify(owner)}\n`;

  let created = await createOwnedLock(lockPath, ownerText);
  if (created.kind === 'exists') {
    const existingOwnerText = await readBoundedLockOwner(lockPath);
    if (existingOwnerText === undefined) {
      created = await createOwnedLock(lockPath, ownerText);
    } else if (existingOwnerText === LOCK_OWNER_TOO_LARGE) {
      throw lockUnavailable(lockPath, 'the owner metadata exceeds the supported size limit', created.cause);
    } else {
      const existingOwner = parseLockOwner(existingOwnerText);
      if (!existingOwner) {
        throw lockUnavailable(lockPath, 'the owner metadata is legacy, malformed, or unsupported', created.cause);
      }
      await reclaimStaleLock(lockPath, existingOwnerText, existingOwner, owner.token, {
        now,
        hostname: () => localHostname,
        processStatus,
        renameStaleLock,
      });
      created = await createOwnedLock(lockPath, ownerText);
    }
  }
  if (created.kind === 'exists') {
    throw lockUnavailable(lockPath, 'another writer acquired the lock first', created.cause);
  }

  const handle = created.handle;
  activeLockOwners.set(lockPath, ownerText);
  return {
    async release() {
      await handle.close().catch(() => undefined);
      if (activeLockOwners.get(lockPath) === ownerText) activeLockOwners.delete(lockPath);
      const currentOwner = await readBoundedLockOwner(lockPath);
      if (currentOwner === ownerText) {
        await rm(lockPath, { force: true }).catch(() => undefined);
      }
    },
  };
}

async function assertActiveLockOwnership(documentPath: string): Promise<void> {
  const lockPath = `${documentPath}.lock`;
  const expectedOwner = activeLockOwners.get(lockPath);
  if (expectedOwner === undefined) return;
  const currentOwner = await readBoundedLockOwner(lockPath);
  if (currentOwner !== expectedOwner) {
    throw lockUnavailable(lockPath, 'ownership changed before the document write');
  }
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
    await assertActiveLockOwnership(documentPath);
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await assertActiveLockOwnership(documentPath);
    await replaceFile(tempPath, documentPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await rm(tempPath, { force: true }).catch(() => undefined);
    if (error instanceof IoError) throw error;
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
