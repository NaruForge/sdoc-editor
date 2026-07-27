/**
 * Ensures that only the newest desktop document session may apply an async
 * asset-hydration result.
 */
export class DocumentHydrationCoordinator<T> {
  private generation = 0;
  private activeSessionId: string | null = null;
  private activePromise: Promise<void> | null = null;

  public hydrate(
    sessionId: string,
    load: () => Promise<T>,
    apply: (value: T) => void,
  ): Promise<void> {
    if (this.activeSessionId === sessionId && this.activePromise) {
      return this.activePromise;
    }

    const generation = ++this.generation;
    this.activeSessionId = sessionId;
    const operation = load().then((value) => {
      if (this.generation !== generation || this.activeSessionId !== sessionId) return;
      apply(value);
    }).finally(() => {
      if (this.generation === generation) this.activePromise = null;
    });
    this.activePromise = operation;
    return operation;
  }

  public cancel(): void {
    this.generation += 1;
    this.activeSessionId = null;
    this.activePromise = null;
  }
}
