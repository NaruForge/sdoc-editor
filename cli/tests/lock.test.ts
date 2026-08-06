import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireSiblingLock,
  atomicReplace,
  IoError,
  type LockAcquisitionOptions,
} from '../src/io.js';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const HOSTNAME = 'test-host';
const CURRENT_PID = 9001;
const CURRENT_TOKEN = 'b'.repeat(32);
const STALE_TOKEN = 'a'.repeat(32);
const temporaryDirectories: string[] = [];

interface LockOwnerInput {
  pid?: number;
  token?: string;
  hostname?: string;
  createdAt?: string;
}

function lockOwner(input: LockOwnerInput = {}): string {
  return `${JSON.stringify({
    version: 1,
    pid: input.pid ?? 8080,
    token: input.token ?? STALE_TOKEN,
    hostname: input.hostname ?? HOSTNAME,
    createdAt: input.createdAt ?? new Date(NOW - 60_000).toISOString(),
  })}\n`;
}

function options(overrides: LockAcquisitionOptions = {}): LockAcquisitionOptions {
  return {
    now: () => NOW,
    hostname: () => HOSTNAME,
    pid: CURRENT_PID,
    createToken: () => CURRENT_TOKEN,
    processStatus: () => 'dead',
    ...overrides,
  };
}

async function fixture(): Promise<{ directory: string; documentPath: string; lockPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'sdoc-lock-'));
  temporaryDirectories.push(directory);
  const documentPath = join(directory, 'document.sdoc');
  return { directory, documentPath, lockPath: `${documentPath}.lock` };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

describe('acquireSiblingLock', () => {
  it('writes structured owner metadata and releases only its own lock', async () => {
    const { lockPath, documentPath } = await fixture();

    const lock = await acquireSiblingLock(documentPath, options());

    expect(JSON.parse(await readFile(lockPath, 'utf8')) as unknown).toEqual({
      version: 1,
      pid: CURRENT_PID,
      token: CURRENT_TOKEN,
      hostname: HOSTNAME,
      createdAt: new Date(NOW).toISOString(),
    });

    const competingOwner = lockOwner({ pid: 9002, token: 'c'.repeat(32) });
    await writeFile(lockPath, competingOwner);
    await lock.release();

    expect(await readFile(lockPath, 'utf8')).toBe(competingOwner);
  });

  it('re-checks ownership before publishing document bytes', async () => {
    const { directory, lockPath, documentPath } = await fixture();
    await writeFile(documentPath, 'original');
    const lock = await acquireSiblingLock(documentPath, options());
    const competingOwner = lockOwner({ pid: 9002, token: 'c'.repeat(32) });
    await writeFile(lockPath, competingOwner);

    await expect(atomicReplace(documentPath, Buffer.from('replacement'))).rejects.toMatchObject({
      code: 'CLI_LOCK_UNAVAILABLE',
      exitCode: 5,
    });

    expect(await readFile(documentPath, 'utf8')).toBe('original');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    await lock.release();
    expect(await readFile(lockPath, 'utf8')).toBe(competingOwner);
  });

  it('reclaims a conclusively dead same-host lock at the 60 second boundary', async () => {
    const { directory, lockPath, documentPath } = await fixture();
    await writeFile(lockPath, lockOwner());
    const processStatus = vi.fn(() => 'dead' as const);

    const lock = await acquireSiblingLock(documentPath, options({ processStatus }));

    expect(processStatus).toHaveBeenCalledWith(8080);
    expect(JSON.parse(await readFile(lockPath, 'utf8')) as unknown).toMatchObject({
      pid: CURRENT_PID,
      token: CURRENT_TOKEN,
    });
    expect((await readdir(directory)).filter((name) => name.includes('.lock.stale-'))).toEqual([]);

    await lock.release();
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a dead same-host lock blocked until it is at least 60 seconds old', async () => {
    const { lockPath, documentPath } = await fixture();
    const owner = lockOwner({ createdAt: new Date(NOW - 59_999).toISOString() });
    await writeFile(lockPath, owner);

    await expect(acquireSiblingLock(documentPath, options())).rejects.toMatchObject({
      code: 'CLI_LOCK_UNAVAILABLE',
      exitCode: 5,
    });

    expect(await readFile(lockPath, 'utf8')).toBe(owner);
  });

  it('does not reclaim a live same-host owner', async () => {
    const { lockPath, documentPath } = await fixture();
    const owner = lockOwner({ createdAt: new Date(NOW - 120_000).toISOString() });
    await writeFile(lockPath, owner);

    await expect(acquireSiblingLock(documentPath, options({ processStatus: () => 'alive' })))
      .rejects.toMatchObject({ code: 'CLI_LOCK_UNAVAILABLE', exitCode: 5 });

    expect(await readFile(lockPath, 'utf8')).toBe(owner);
  });

  it('does not reclaim when process death cannot be concluded', async () => {
    const { lockPath, documentPath } = await fixture();
    const owner = lockOwner({ createdAt: new Date(NOW - 120_000).toISOString() });
    await writeFile(lockPath, owner);

    await expect(acquireSiblingLock(documentPath, options({ processStatus: () => 'unknown' })))
      .rejects.toMatchObject({ code: 'CLI_LOCK_UNAVAILABLE', exitCode: 5 });

    expect(await readFile(lockPath, 'utf8')).toBe(owner);
  });

  it.each([
    ['different-host', lockOwner({ hostname: 'remote-host' })],
    ['legacy', '8080:legacy-token\n'],
    ['malformed', '{"version":1,"pid":"8080"}\n'],
  ])('leaves %s owner metadata blocked with manual recovery guidance', async (_label, owner) => {
    const { lockPath, documentPath } = await fixture();
    const processStatus = vi.fn(() => 'dead' as const);
    await writeFile(lockPath, owner);

    let error: unknown;
    try {
      await acquireSiblingLock(documentPath, options({ processStatus }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(IoError);
    expect(error).toMatchObject({ code: 'CLI_LOCK_UNAVAILABLE', exitCode: 5 });
    expect((error as Error).message).toMatch(/manually only after confirming no writer is active/i);
    expect((error as Error).message).toMatch(/re-inspect/i);
    expect(await readFile(lockPath, 'utf8')).toBe(owner);
    expect(processStatus).not.toHaveBeenCalled();
  });

  it('rejects oversized owner metadata without reading it as a reclaimable lock', async () => {
    const { lockPath, documentPath } = await fixture();
    const owner = 'x'.repeat(1024 * 1024);
    await writeFile(lockPath, owner);

    await expect(acquireSiblingLock(documentPath, options())).rejects.toMatchObject({
      code: 'CLI_LOCK_UNAVAILABLE',
      exitCode: 5,
    });
    expect((await readFile(lockPath)).byteLength).toBe(owner.length);
  });

  it('allows exactly one concurrent stale-lock reclaimer to become owner', async () => {
    const { lockPath, documentPath } = await fixture();
    await writeFile(lockPath, lockOwner());
    const tokens = ['b'.repeat(32), 'c'.repeat(32)];
    const sharedOptions = options({
      createToken: () => tokens.shift()!,
      processStatus: (pid) => pid === 8080 ? 'dead' : 'alive',
    });

    const results = await Promise.allSettled([
      acquireSiblingLock(documentPath, sharedOptions),
      acquireSiblingLock(documentPath, sharedOptions),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireSiblingLock>>> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: 'CLI_LOCK_UNAVAILABLE', exitCode: 5 },
    });

    const currentOwner = JSON.parse(await readFile(lockPath, 'utf8')) as unknown as { token: unknown };
    expect(['b'.repeat(32), 'c'.repeat(32)]).toContain(currentOwner.token);
    await fulfilled[0].value.release();
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores a competing owner if it wins immediately before stale quarantine', async () => {
    const { directory, lockPath, documentPath } = await fixture();
    await writeFile(lockPath, lockOwner());
    const competingOwner = lockOwner({
      pid: 9002,
      token: 'd'.repeat(32),
      createdAt: new Date(NOW).toISOString(),
    });

    await expect(acquireSiblingLock(documentPath, options({
      renameStaleLock: async (source, destination) => {
        await rm(source);
        await writeFile(source, competingOwner);
        await rename(source, destination);
      },
    }))).rejects.toMatchObject({ code: 'CLI_LOCK_UNAVAILABLE', exitCode: 5 });

    expect(await readFile(lockPath, 'utf8')).toBe(competingOwner);
    expect((await readdir(directory)).filter((name) => name.includes('.lock.stale-'))).toEqual([]);
  });
});
