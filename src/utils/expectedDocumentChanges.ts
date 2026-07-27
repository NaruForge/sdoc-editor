export type DocumentEndOfLine = '\n' | '\r\n';

export const normalizeDocumentEndOfLines = (
  text: string,
  endOfLine: DocumentEndOfLine,
): string => text.replace(/\r\n|\r|\n/g, endOfLine);

/**
 * Tracks exact full-document snapshots produced by this extension so matching
 * VS Code change events are not reported back to the editor as external.
 */
export class ExpectedDocumentChanges {
  private readonly pending = new Map<string, string[]>();

  public expect(uri: string, text: string, endOfLine: DocumentEndOfLine): string {
    const expectedText = normalizeDocumentEndOfLines(text, endOfLine);
    const snapshots = this.pending.get(uri) ?? [];
    snapshots.push(expectedText);
    this.pending.set(uri, snapshots);
    return expectedText;
  }

  public consume(uri: string, actualText: string): boolean {
    const snapshots = this.pending.get(uri) ?? [];
    const index = snapshots.indexOf(actualText);
    if (index < 0) return false;
    snapshots.splice(index, 1);
    if (snapshots.length === 0) this.pending.delete(uri);
    return true;
  }

  public remove(uri: string, expectedText: string): void {
    const snapshots = this.pending.get(uri) ?? [];
    const index = snapshots.indexOf(expectedText);
    if (index >= 0) snapshots.splice(index, 1);
    if (snapshots.length === 0) this.pending.delete(uri);
  }

  public clear(uri: string): void {
    this.pending.delete(uri);
  }
}
