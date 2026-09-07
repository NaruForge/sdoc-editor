import { afterEach, describe, expect, it, vi } from 'vitest';
import * as detailed from '../shared/document/generated/documentValidators.js';
import * as fast from '../shared/document/generated/fastDocumentValidators.js';

vi.mock('../shared/document/generated/documentValidators.js', async (original) => {
  const validators = await original<typeof detailed>();
  return Object.fromEntries(Object.entries(validators).map(([name, validate]) => {
    const mock = vi.fn((value: unknown) => {
      const valid = validate(value);
      Object.assign(mock, { errors: validate.errors });
      return valid;
    });
    return [name, mock];
  }));
});
import * as routed from '../shared/document/documentValidation';

afterEach(() => vi.clearAllMocks());

describe('fast validation and diagnostic fallback', () => {
  const cases = [
    ['validateEnvelope', { sdoc: '1.0', meta: {}, doc: { type: 'doc', content: [] } }],
    ['validateDoc', { type: 'doc', content: [] }],
    ['validateMetadataSchema', { title: 'Valid' }],
    ['validateSettingsSchema', { pdfScale: 100 }],
  ] as const;
  it.each(cases)('%s skips detailed validation on success and clears stale errors', (name, valid) => {
    expect(routed[name](valid)).toBe(true);
    expect(detailed[name]).not.toHaveBeenCalled();
    expect(routed[name](null)).toBe(false);
    expect(detailed[name]).toHaveBeenCalledExactlyOnceWith(null);
    expect(routed[name].errors).toEqual(detailed[name].errors);
    expect(routed[name].errors?.length).toBeGreaterThan(0);
    expect(routed[name](valid)).toBe(true);
    expect(routed[name].errors).toBeNull();
    expect(detailed[name].errors).toBeNull();
    expect(detailed[name]).toHaveBeenCalledTimes(1);
  });
  it.each(cases)('%s agrees with the detailed oracle on root-shape mutations', (name, valid) => {
    for (const value of [valid, null, [], false, 1, '', {}, { ...valid, extra: true }]) {
      expect(fast[name](value)).toBe(detailed[name](value));
    }
  });
});
