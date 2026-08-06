import { resolveDiagramLanguage } from './languages';

const MAX_PENDING_INTENTS = 32;

function intentKey(language: unknown, code: string): string {
  return `${resolveDiagramLanguage(language)}\u0000${code}`;
}

/**
 * Carries a user-initiated preview intent across dialog confirmation into the
 * NodeView created by insertion. The intent is session-only and consumed once.
 */
export class DiagramRenderIntentStore {
  private readonly pending = new Set<string>();

  mark(language: unknown, code: string): void {
    const key = intentKey(language, code);
    this.pending.delete(key);
    this.pending.add(key);
    while (this.pending.size > MAX_PENDING_INTENTS) {
      const oldest = this.pending.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }

  consume(language: unknown, code: string): boolean {
    const key = intentKey(language, code);
    if (!this.pending.has(key)) return false;
    this.pending.delete(key);
    return true;
  }

  discard(language: unknown, code: string): void {
    this.pending.delete(intentKey(language, code));
  }
}
