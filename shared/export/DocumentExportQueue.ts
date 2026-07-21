export class DocumentExportQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(documentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(documentId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(documentId, tail);
    void tail.finally(() => {
      if (this.tails.get(documentId) === tail) this.tails.delete(documentId);
    });
    return result;
  }
}
