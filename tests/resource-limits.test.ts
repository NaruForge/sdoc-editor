import { describe, expect, it } from 'vitest';
import {
  assertEmbeddedAssetBudget,
  MAX_AGGREGATE_ASSET_BYTES,
  MAX_ASSET_BYTES,
  MAX_EMBEDDED_ASSET_COUNT,
} from '../shared/resourceLimits';

describe('shared resource limits', () => {
  it('accepts values at every documented boundary', () => {
    expect(() => assertEmbeddedAssetBudget(
      Array.from({ length: MAX_AGGREGATE_ASSET_BYTES / MAX_ASSET_BYTES }, () => MAX_ASSET_BYTES),
      MAX_EMBEDDED_ASSET_COUNT,
    )).not.toThrow();
  });

  it('rejects an oversized asset, aggregate, and reference count', () => {
    expect(() => assertEmbeddedAssetBudget([MAX_ASSET_BYTES + 1], 1)).toThrow(/per-asset limit/);
    expect(() => assertEmbeddedAssetBudget(
      Array.from({ length: MAX_AGGREGATE_ASSET_BYTES / MAX_ASSET_BYTES + 1 }, () => MAX_ASSET_BYTES),
      9,
    )).toThrow(/aggregate limit/);
    expect(() => assertEmbeddedAssetBudget([], MAX_EMBEDDED_ASSET_COUNT + 1)).toThrow(/references/);
  });
});
