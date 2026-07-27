export class RecoverableSerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastError: unknown | undefined;

  enqueue(task: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    const operation = this.tail.then(async () => {
      await task();
      this.lastError = undefined;
    });
    this.tail = operation.catch((error: unknown) => {
      this.lastError = error;
      onError(error);
    });
    return operation;
  }

  async whenIdle(): Promise<void> {
    // A completion callback may enqueue the coalesced next mutation while the
    // previously observed tail is settling. Follow the tail until it is stable.
    while (true) {
      const observed = this.tail;
      await observed;
      if (observed === this.tail) break;
    }
    if (this.lastError !== undefined) {
      const error = this.lastError;
      this.lastError = undefined;
      throw error;
    }
  }
}
