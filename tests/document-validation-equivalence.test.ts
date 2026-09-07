import { describe, expect, it } from 'vitest';
import * as detailed from '../shared/document/generated/documentValidators.js';
import * as fast from '../shared/document/generated/fastDocumentValidators.js';
import {
  assertPersistedDocument, assertPersistedDocumentComponents,
  assertPersistedDocumentMetadata, parseDocumentContract, validateDocumentSettings,
} from '../shared/document/documentContract';
import { createAcceptedPerformanceCorpus } from './performance/fixtures';
import type { TiptapNode } from '../shared/types';

const doc = { type: 'doc', content: [] };
const metadata: unknown[] = [
  {}, { title: '한글', custom: { nested: [1, null] } },
  { created: '2026-01-01T00:00:00Z' }, { created: 'invalid', title: 7 },
  { template: { id: 'x'.repeat(129), name: 42 } }, null, [],
];
const settings: unknown[] = [
  {}, { headingNumbering: true, pdfScale: 100 },
  { headingNumbering: 'true', pdfScale: 201, unexpected: true },
  { headingStartNumber: -1.5, headingH1Color: 'red', captionStyle: 'bad' },
  null, [],
];
const documents: unknown[] = [doc, null, {}, { type: 'paragraph' }, { type: 'doc', content: false }];
// Exercise every rich top-level type and nested node, including marks and attrs.
const blocks = createAcceptedPerformanceCorpus('rich-balanced-5k').envelope.doc.content!.slice(0, 30);
const mutate = (node: TiptapNode): unknown[] => {
  const variants: unknown[] = [node, { ...node, type: 'unknown' }, { ...node, unexpected: 1 },
    { ...node, attrs: { ...node.attrs, id: 'provisional:bad' } }, { ...node, content: null }];
  if (node.text !== undefined) variants.push({ ...node, text: 42 }, { ...node, marks: [{ type: 'unknown' }] });
  node.content?.forEach((child, index) => {
    mutate(child).forEach((replacement) => variants.push({
      ...node, content: node.content!.map((entry, offset) => offset === index ? replacement : entry),
    }));
  });
  return variants;
};
blocks.forEach((block) => mutate(block).forEach((value) => documents.push({ type: 'doc', content: [value] })));

const messages = (errors: typeof detailed.validateEnvelope.errors, prefix = '') =>
  (errors ?? []).slice(0, 100).map((error) => {
    const path = (error.instancePath || '/').slice(0, 1_000);
    return { path: `${prefix}${prefix && path === '/' ? '' : path}`,
      message: (error.message ?? 'invalid value').slice(0, 2_000) };
  });
const failure = (errors: ReturnType<typeof messages>) =>
  `Document violates sdoc.schema.json: ${errors.map((item) => `${item.path}: ${item.message}`).join('; ')}`;

describe('document validation equivalence to detailed standalone oracle', () => {
  it('preserves envelope acceptance and exact ordered diagnostics for rich node mutations', () => {
    for (const value of documents) {
      const envelope = { sdoc: '1.0', meta: {}, doc: value };
      const accepted = detailed.validateEnvelope(envelope);
      expect(fast.validateEnvelope(envelope)).toBe(accepted);
      const expected = failure(messages(detailed.validateEnvelope.errors));
      if (accepted) expect(() => assertPersistedDocument(envelope)).not.toThrow();
      else expect(() => assertPersistedDocument(envelope)).toThrowError(new Error(expected));
    }
  });

  it('preserves metadata, settings and component errors, including consecutive invalid/valid calls', () => {
    for (const value of settings) {
      expect(fast.validateSettingsSchema(value)).toBe(detailed.validateSettingsSchema(value));
      expect(validateDocumentSettings(value)).toBe(detailed.validateSettingsSchema(value));
    }
    for (const meta of [...metadata, ...settings.map((value) => ({ settings: value }))]) {
      const validMeta = detailed.validateMetadataSchema(meta);
      expect(fast.validateMetadataSchema(meta)).toBe(validMeta);
      const metaErrors = messages(detailed.validateMetadataSchema.errors, '/meta');
      if (validMeta) expect(() => assertPersistedDocumentMetadata(meta)).not.toThrow();
      else expect(() => assertPersistedDocumentMetadata(meta)).toThrowError(new Error(failure(metaErrors)));
      for (const value of documents.slice(0, 35)) {
        const validDoc = detailed.validateDoc(value);
        expect(fast.validateDoc(value)).toBe(validDoc);
        const docErrors = messages(detailed.validateDoc.errors, '/doc');
        expect(detailed.validateEnvelope({ sdoc: '1.0', meta, doc: value })).toBe(validMeta && validDoc);
        if (validMeta && validDoc) expect(() => assertPersistedDocumentComponents(meta, value)).not.toThrow();
        else expect(() => assertPersistedDocumentComponents(meta, value)).toThrowError(new Error(failure([...metaErrors, ...docErrors])));
      }
    }
  });

  it('preserves legacy migration and malformed public diagnostics', () => {
    const legacy = { type: 'doc', content: [{ type: 'image', attrs: { 'data-caption': 'Old' } }] };
    expect(parseDocumentContract(legacy)).toMatchObject({ ok: true, legacy: true,
      envelope: { doc: { content: [{ attrs: { caption: 'Old' } }] } } });
    for (const value of [{ sdoc: '1.0', meta: { title: 7, created: 'bad' }, doc },
      { sdoc: '1.0', meta: {}, doc, extra: true }, null, {}, { type: 'doc', content: [{ type: 'unknown' }] }]) {
      const isLegacy = typeof value === 'object' && value !== null && 'type' in value;
      const oracle = isLegacy ? detailed.validateDoc : detailed.validateEnvelope;
      expect(oracle(value)).toBe(false);
      expect(parseDocumentContract(value)).toEqual({ ok: false, kind: 'malformed', diagnostics: messages(oracle.errors) });
    }
  });
});
