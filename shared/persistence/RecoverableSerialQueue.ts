export class RecoverableSerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastError: unknown | undefined;

  enqueue(task: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    const operation = this.tail.then(async () => {
      await task();
    });
    this.tail = operation.catch((error: unknown) => {
      this.lastError = error;
      onError(error);
    });
    return operation;
  }

  async whenIdle(): Promise<void> {
    await this.tail;
    if (this.lastError !== undefined) {
      const error = this.lastError;
      this.lastError = undefined;
      throw error;
    }
  }
}
