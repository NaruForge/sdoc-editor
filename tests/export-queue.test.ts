import { describe, expect, it } from 'vitest';
import { DocumentExportQueue } from '../shared/export/DocumentExportQueue';
import { runExportAfterFlush } from '../shared/export/runExportAfterFlush';
import { RecoverableSerialQueue } from '../shared/persistence/RecoverableSerialQueue';
import { stat } from 'node:fs/promises';
import { withTemporaryDirectory } from '../src/utils/temporaryDirectory';

describe('document export queue', () => {
  it('serializes exports for one document without poisoning the next job after failure', async () => {
    const queue = new DocumentExportQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.run('doc-a', async () => {
      events.push('first:start');
      await gate;
      events.push('first:fail');
      throw new Error('export failed');
    });
    const second = queue.run('doc-a', async () => {
      events.push('second:start');
      return 'ok';
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await expect(first).rejects.toThrow('export failed');
    await expect(second).resolves.toBe('ok');
    expect(events).toEqual(['first:start', 'first:fail', 'second:start']);
  });

  it('allows different documents to export independently', async () => {
    const queue = new DocumentExportQueue();
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    let bFinished = false;

    const a = queue.run('doc-a', () => gateA);
    await queue.run('doc-b', async () => { bFinished = true; });
    expect(bFinished).toBe(true);
    releaseA();
    await a;
  });
});

describe('temporary export workspace', () => {
  it('removes the unique directory when export work fails', async () => {
    let temporaryPath = '';
    await expect(withTemporaryDirectory('sdoc-test-', async (directory) => {
      temporaryPath = directory;
      throw new Error('print failed');
    })).rejects.toThrow('print failed');
    await expect(stat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('export flush barrier', () => {
  it('waits for the latest editor state before starting conversion', async () => {
    const events: string[] = [];
    await runExportAfterFlush(
      async () => { events.push('flush'); },
      async () => { events.push('export'); },
    );
    expect(events).toEqual(['flush', 'export']);
  });

  it('does not export when the editor flush fails', async () => {
    let exported = false;
    await expect(runExportAfterFlush(
      async () => { throw new Error('flush rejected'); },
      async () => { exported = true; },
    )).rejects.toThrow('flush rejected');
    expect(exported).toBe(false);
  });

  it('allows a flush edit acknowledgement to pass through the editor message queue', async () => {
    const messages = new RecoverableSerialQueue();
    let acknowledge!: () => void;
    const flushAcknowledged = new Promise<void>((resolve) => { acknowledge = resolve; });
    let exported = false;

    const exportOutsideQueue = runExportAfterFlush(
      () => flushAcknowledged,
      async () => { exported = true; },
    );
    messages.enqueue(async () => { acknowledge(); });

    await exportOutsideQueue;
    expect(exported).toBe(true);
  });
});
