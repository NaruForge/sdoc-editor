import { describe, expect, it, vi } from 'vitest';
import { RecoverableSerialQueue } from '../shared/persistence/RecoverableSerialQueue';

describe('recoverable persistence queue', () => {
  it('processes the next edit after one message fails', async () => {
    const queue = new RecoverableSerialQueue();
    const errors: unknown[] = [];
    const nextEdit = vi.fn(async () => {});

    queue.enqueue(async () => { throw new Error('transient failure'); }, (error) => errors.push(error));
    const recovered = queue.enqueue(nextEdit, (error) => errors.push(error));
    await recovered;

    expect(errors).toHaveLength(1);
    expect(nextEdit).toHaveBeenCalledOnce();
    await expect(queue.whenIdle()).resolves.toBeUndefined();
  });

  it('reports the latest failed save to a flush barrier', async () => {
    const queue = new RecoverableSerialQueue();
    queue.enqueue(async () => { throw new Error('disk full'); }, () => {});

    await expect(queue.whenIdle()).rejects.toThrow('disk full');
  });

  it('follows a mutation enqueued by the acknowledgement of the current tail', async () => {
    const queue = new RecoverableSerialQueue();
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let secondCompleted = false;
    void queue.enqueue(async () => {
      await first;
      void queue.enqueue(async () => {
        secondCompleted = true;
      }, () => {});
    }, () => {});

    const idle = queue.whenIdle();
    releaseFirst();
    await idle;
    expect(secondCompleted).toBe(true);
  });
});
