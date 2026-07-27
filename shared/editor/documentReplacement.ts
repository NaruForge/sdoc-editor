export const EDITOR_REPLACEMENT_REASONS = [
  'initial-load',
  'user-reload',
  'user-import',
  'confirmed-template',
] as const;

export type EditorReplacementReason = typeof EDITOR_REPLACEMENT_REASONS[number];

const isReplacementReason = (value: string): value is EditorReplacementReason =>
  EDITOR_REPLACEMENT_REASONS.some((reason) => reason === value);

/**
 * The only boundary allowed to replace the full ProseMirror document.
 * Background persistence messages deliberately have no reason accepted here.
 */
export class EditorDocumentReplacementBoundary<TContent> {
  private hydrated = false;

  public get isHydrated(): boolean {
    return this.hydrated;
  }

  public replace(
    reason: EditorReplacementReason,
    content: TContent,
    apply: (content: TContent) => void,
  ): boolean {
    if (!isReplacementReason(reason)) {
      throw new Error(`Unsupported editor replacement reason: ${String(reason)}`);
    }
    if (reason === 'initial-load') {
      if (this.hydrated) return false;
      this.hydrated = true;
    } else if (!this.hydrated) {
      throw new Error(`Cannot replace editor before initial hydration (${reason}).`);
    }
    apply(content);
    return true;
  }
}
