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
    await expect(queue.whenIdle()).rejects.toThrow('transient failure');
  });

  it('reports the latest failed save to a flush barrier', async () => {
    const queue = new RecoverableSerialQueue();
    queue.enqueue(async () => { throw new Error('disk full'); }, () => {});

    await expect(queue.whenIdle()).rejects.toThrow('disk full');
  });
});
