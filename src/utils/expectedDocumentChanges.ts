export type DocumentEndOfLine = '\n' | '\r\n';

export const normalizeDocumentEndOfLines = (
  text: string,
  endOfLine: DocumentEndOfLine,
): string => text.replace(/\r\n|\r|\n/g, endOfLine);

/**
 * VS Code also emits document-change events for state-only transitions such as
 * dirty to saved. Those events do not represent an external content change.
 */
export const hasTextDocumentContentChanges = (
  contentChanges: readonly unknown[],
): boolean => contentChanges.length > 0;

export interface ExpectedDocumentChange {
  readonly text: string;
  consumedRevision?: number;
}

/**
 * Tracks exact full-document snapshots produced by this extension so matching
 * VS Code change events are not reported back to the editor as external.
 */
export class ExpectedDocumentChanges {
  private readonly pending = new Map<string, ExpectedDocumentChange[]>();

  public expect(
    uri: string,
    text: string,
    endOfLine: DocumentEndOfLine,
  ): ExpectedDocumentChange {
    const expected = { text: normalizeDocumentEndOfLines(text, endOfLine) };
    const snapshots = this.pending.get(uri) ?? [];
    snapshots.push(expected);
    this.pending.set(uri, snapshots);
    return expected;
  }

  public consume(uri: string, actualText: string, revision?: number): boolean {
    const snapshots = this.pending.get(uri) ?? [];
    const index = snapshots.findIndex((snapshot) => snapshot.text === actualText);
    if (index < 0) return false;
    const [consumed] = snapshots.splice(index, 1);
    consumed.consumedRevision = revision;
    if (snapshots.length === 0) this.pending.delete(uri);
    return true;
  }

  public remove(uri: string, expected: ExpectedDocumentChange): void {
    const snapshots = this.pending.get(uri) ?? [];
    const index = snapshots.indexOf(expected);
    if (index >= 0) snapshots.splice(index, 1);
    if (snapshots.length === 0) this.pending.delete(uri);
  }

  public has(uri: string, expected: ExpectedDocumentChange): boolean {
    return (this.pending.get(uri) ?? []).includes(expected);
  }

  public clear(uri: string): void {
    this.pending.delete(uri);
  }
}

export const shouldReportExternalDocumentChange = (
  contentChanges: readonly unknown[],
  expectedChanges: ExpectedDocumentChanges,
  uri: string,
  actualText: string,
  revision?: number,
): boolean => hasTextDocumentContentChanges(contentChanges)
  && !expectedChanges.consume(uri, actualText, revision);
