/** Stable safety bounds shared by the visual editor, book core, and CLI adapters. */
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const MAX_AGGREGATE_ASSET_BYTES = 256 * 1024 * 1024;
export const MAX_EMBEDDED_ASSET_COUNT = 1_024;
export const RESOURCE_LOAD_CONCURRENCY = 4;

export class ResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceLimitError';
  }
}

export function assertEmbeddedAssetBudget(
  byteLengths: readonly number[],
  referenceCount: number,
): void {
  if (referenceCount > MAX_EMBEDDED_ASSET_COUNT) {
    throw new ResourceLimitError(
      `Export contains ${referenceCount.toLocaleString('en-US')} embedded asset references; the limit is ${MAX_EMBEDDED_ASSET_COUNT.toLocaleString('en-US')}.`,
    );
  }
  const oversized = byteLengths.find((size) => size > MAX_ASSET_BYTES);
  if (oversized !== undefined) {
    throw new ResourceLimitError(
      `An embedded asset is ${oversized.toLocaleString('en-US')} bytes; the per-asset limit is ${MAX_ASSET_BYTES.toLocaleString('en-US')} bytes.`,
    );
  }
  const aggregate = byteLengths.reduce((sum, size) => sum + size, 0);
  if (aggregate > MAX_AGGREGATE_ASSET_BYTES) {
    throw new ResourceLimitError(
      `Embedded assets total ${aggregate.toLocaleString('en-US')} bytes; the aggregate limit is ${MAX_AGGREGATE_ASSET_BYTES.toLocaleString('en-US')} bytes.`,
    );
  }
}
