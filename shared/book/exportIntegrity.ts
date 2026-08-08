import { computeRevision } from '../document/operations/sha256';

export interface BookExportIntegrityFile {
  kind: 'chapter' | 'css' | 'image';
  bookPath: string;
  canonicalPath: string;
  byteLength: number;
  contentHash: string;
  openBufferRevision?: number;
}

export interface BookExportIntegrityInput {
  canonicalRoot: string;
  manifestCanonicalPath: string;
  manifestRevision: number;
  manifestHash: string;
  settingsFingerprint: string;
  files: readonly BookExportIntegrityFile[];
}

/** Stable authoritative digest for every input that can affect a Book export. */
export function fingerprintBookExportIntegrity(input: BookExportIntegrityInput): string {
  return computeRevision(JSON.stringify({
    ...input,
    files: [...input.files].sort((left, right) =>
      `${left.kind}:${left.bookPath}`.localeCompare(`${right.kind}:${right.bookPath}`)),
  }));
}
