import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assignAutoIds,
  createEmptySdoc,
  normalizeDocument,
  queryDocumentStructure,
  syncCrossReferences,
  unwrapSdoc,
  wrapSdoc,
} from '../shared/document/sdocUtils';
import type { TiptapNode } from '../shared/types';
import {
  assertPersistedDocument,
  parseDocumentContract,
  validateDocumentSettings,
} from '../shared/document/documentContract';

interface ContractFixture {
  legacyMigration: {
    input: TiptapNode;
    expectedAttrs: Record<string, unknown>;
  };
  idAssignment: {
    doc: TiptapNode;
    expectedIds: string[];
  };
  normalization: {
    options: {
      equationNumbering: 'sequential' | 'hierarchical';
      captionStyle: 'ieee' | 'iso' | 'modern' | 'korean';
      crossRefIncludeCaption: boolean;
    };
    doc: TiptapNode;
    expectedIds: string[];
    expectedReferenceTexts: string[];
  };
  envelope: {
    input: unknown;
  };
}

const contract = JSON.parse(
  readFileSync(new URL('./fixtures/document-contract.json', import.meta.url), 'utf8'),
) as ContractFixture;

const semanticIds = (doc: TiptapNode): string[] =>
  (doc.content ?? [])
    .filter((node) => ['heading', 'image', 'table', 'mathBlock'].includes(node.type))
    .map((node) => String(node.attrs?.id ?? ''));

const referenceTexts = (doc: TiptapNode): string[] => {
  const result: string[] = [];
  const visit = (node: TiptapNode): void => {
    if (node.type === 'text' && node.marks?.some((mark) => mark.type === 'link')) {
      result.push(node.text ?? '');
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return result;
};

const text = (value: string, href?: string): TiptapNode => ({
  type: 'text',
  text: value,
  ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
});

describe('sdoc envelope', () => {
  it('uses precompiled validators that are compatible with the Tauri CSP', () => {
    const source = readFileSync(
      new URL('../shared/document/documentContract.ts', import.meta.url),
      'utf8',
    );
    const generated = readFileSync(
      new URL('../shared/document/generated/documentValidators.js', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/import\s+(?!type\b)[^;]+from ['"]ajv['"]/);
    expect(source).toContain("from './generated/documentValidators.js'");
    expect(generated).not.toMatch(/\b(?:eval|Function)\s*\(/);
  });

  it('keeps executable scripts strict while allowing bundled data fonts', () => {
    const config = JSON.parse(readFileSync(
      new URL('../tauri-app/src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    )) as { app: { security: { csp: string } } };
    expect(config.app.security.csp).toContain("script-src 'self'");
    expect(config.app.security.csp).not.toContain("'unsafe-eval'");
    expect(config.app.security.csp).toContain("font-src 'self' data:");
  });

  it('deduplicates React when shared editor modules are bundled by either host', () => {
    for (const configPath of [
      '../tauri-app/vite.config.ts',
      '../webview-ui/vite.config.ts',
    ]) {
      const config = readFileSync(new URL(configPath, import.meta.url), 'utf8');
      expect(config).toContain("dedupe: ['react', 'react-dom']");
    }
  });

  it('fails closed for malformed and unsupported future documents', () => {
    expect(parseDocumentContract({ unexpected: true })).toMatchObject({ ok: false, kind: 'malformed' });
    expect(parseDocumentContract({
      sdoc: '2.0', meta: {}, doc: { type: 'doc', content: [] },
    })).toMatchObject({ ok: false, kind: 'unsupported-version' });
  });

  it('rejects malformed external document settings without casting', () => {
    expect(validateDocumentSettings({ captionStyle: 'korean', pdfScale: 80 })).toBe(true);
    expect(validateDocumentSettings({ captionStyle: 'unknown' })).toBe(false);
    expect(validateDocumentSettings({ headingNumbering: 'yes' })).toBe(false);
    expect(parseDocumentContract({
      sdoc: '1.0',
      meta: { title: 123, settings: { captionStyle: 'unknown' }, review: { status: 'draft' } },
      doc: { type: 'doc', content: [] },
    })).toMatchObject({ ok: false, kind: 'malformed' });
  });

  it('preserves schema-valid metadata extensions through round-trip', () => {
    const parsed = parseDocumentContract({
      sdoc: '1.0',
      meta: { title: 'Extended', review: { status: 'approved' } },
      doc: { type: 'doc', content: [] },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const wrapped = wrapSdoc(parsed.envelope.doc, parsed.envelope.meta);
    expect(wrapped.meta.review).toEqual({ status: 'approved' });
  });
  it('unwraps legacy documents and recursively migrates data attributes', () => {
    const legacy: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { 'data-caption': 'Architecture', 'data-align': 'center', 'data-width': '80%' },
        },
      ],
    };

    const { meta, doc } = unwrapSdoc(legacy);
    expect(meta).toEqual({});
    expect(doc.content?.[0].attrs).toEqual({
      caption: 'Architecture',
      align: 'center',
      width: '80%',
    });
    const strict = parseDocumentContract(legacy);
    expect(strict.ok && strict.envelope.doc.content?.[0].attrs).toEqual({
      caption: 'Architecture', align: 'center', width: '80%',
    });
  });

  it('preserves metadata settings through wrapping', () => {
    const document = createEmptySdoc({
      title: 'Guide',
      author: 'Author',
      settings: { captionStyle: 'korean' },
    });
    const wrapped = wrapSdoc(document.doc, document.meta);
    expect(wrapped.sdoc).toBe('1.0');
    expect(wrapped.meta.title).toBe('Guide');
    expect(wrapped.meta.settings).toEqual({ captionStyle: 'korean' });
    expect(wrapped.doc.content?.[0].type).toBe('heading');
  });

  it('returns an empty document for malformed input', () => {
    expect(unwrapSdoc({ unexpected: true }).doc).toEqual({ type: 'doc', content: [] });
  });

  it('preserves metadata and settings from the shared contract fixture', () => {
    const { meta, doc } = unwrapSdoc(contract.envelope.input);
    expect(meta).toMatchObject({
      title: 'Contract',
      author: 'Tester',
      version: '2.0',
      settings: { captionStyle: 'korean', equationNumbering: 'hierarchical' },
    });
    expect(doc).toEqual({ type: 'doc', content: [] });
  });

  it('recursively migrates attributes from the shared contract fixture', () => {
    const { doc } = unwrapSdoc(contract.legacyMigration.input);
    expect(doc.content?.[0].content?.[0].attrs).toEqual(contract.legacyMigration.expectedAttrs);
  });
});

describe('document structure', () => {
  it('preserves literal code block whitespace exactly', () => {
    const normalized = normalizeDocument({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'text' }, content: [{ type: 'text', text: '  a\t \n' }] }],
    });
    expect(normalized.content?.[0].content?.[0].text).toBe('  a\t \n');
  });

  it('validates persisted editor marks, rules, images, and equations against the schema', () => {
    const envelope = wrapSdoc(normalizeDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{
          type: 'text', text: 'colored', marks: [
            { type: 'textStyle', attrs: { color: '#123456' } },
            { type: 'highlight', attrs: { color: '#ffff00' } },
          ],
        }] },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { src: './images/nested/a.png', id: 'figure-a', width: '80%' } },
        { type: 'mathBlock', attrs: { latex: 'x=1', id: 'eq-a' } },
      ],
    }), {});
    expect(() => assertPersistedDocument(envelope)).not.toThrow();
  });
  it('assigns stable unique IDs for duplicate headings and numbered blocks', () => {
    const doc = assignAutoIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Overview')] },
        { type: 'heading', attrs: { level: 1 }, content: [text('Overview')] },
        { type: 'image', attrs: { caption: 'System' } },
        { type: 'table', attrs: { caption: 'Ports' } },
        { type: 'mathBlock', attrs: { latex: 'x=1' } },
      ],
    });

    expect(doc.content?.map((node) => node.attrs?.id)).toEqual([
      'overview',
      'overview-2',
      'figure-1',
      'table-1',
      'eq-1',
    ]);
  });

  it('synchronizes labels and reports missing cross-reference targets', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, id: 'intro' }, content: [text('Introduction')] },
        { type: 'image', attrs: { id: 'system', caption: 'System view' } },
        { type: 'paragraph', content: [text('old label', '#system'), text('missing', '#unknown')] },
      ],
    };

    const synchronized = syncCrossReferences(doc, 'sequential', 'modern', true);
    expect(synchronized.content?.[2].content?.[0].text).toBe('Figure 1: System view');

    const query = queryDocumentStructure(synchronized);
    expect(query.headings[0]).toMatchObject({ id: 'intro', level: 1, numbering: '1' });
    expect(query.crossReferences).toEqual([
      { href: '#system', text: 'Figure 1: System view', targetExists: true },
      { href: '#unknown', text: 'missing', targetExists: false },
    ]);
  });

  it('preserves reserved IDs and resolves duplicate existing IDs deterministically', () => {
    const doc = assignAutoIds(contract.idAssignment.doc);
    expect(semanticIds(doc)).toEqual(contract.idAssignment.expectedIds);
  });

  it('normalizes IDs and configured reference labels from the shared contract fixture', () => {
    const normalized = normalizeDocument(contract.normalization.doc, contract.normalization.options);

    expect(semanticIds(normalized)).toEqual(contract.normalization.expectedIds);
    expect(referenceTexts(normalized)).toEqual(contract.normalization.expectedReferenceTexts);
    expect(() => assertPersistedDocument(wrapSdoc(normalized, {}))).not.toThrow();
  });

  it('assigns persistent ids to nested referenceable nodes in document order', () => {
    const doc = assignAutoIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Top')] },
        { type: 'blockquote', content: [{ type: 'image', attrs: { caption: 'Nested' } }] },
        { type: 'table', attrs: { caption: 'Top table' } },
      ],
    });
    expect(doc.content?.[0].attrs?.id).toBe('top');
    expect(doc.content?.[1].content?.[0].attrs?.id).toBe('figure-1');
    expect(doc.content?.[2].attrs?.id).toBe('table-1');
    expect(queryDocumentStructure(doc).figures).toEqual([
      { id: 'figure-1', caption: 'Nested', number: 1 },
    ]);
  });

  it('keeps a heading identity and reference when the heading is renamed', () => {
    const normalized = normalizeDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, id: 'intro' }, content: [text('Overview')] },
        { type: 'paragraph', content: [text('old title', '#intro')] },
      ],
    });

    expect(normalized.content?.[0].attrs?.id).toBe('intro');
    expect(normalized.content?.[1].content?.[0].marks?.[0].attrs?.href).toBe('#intro');
    expect(normalized.content?.[1].content?.[0].text).toBe('1. Overview');
  });

  it('keeps figure and table identities attached to their objects after reorder', () => {
    const normalized = normalizeDocument({
      type: 'doc',
      content: [
        { type: 'table', attrs: { id: 'ports', caption: 'Ports' } },
        { type: 'image', attrs: { id: 'system', caption: 'System' } },
        { type: 'paragraph', content: [text('old figure', '#system'), text('old table', '#ports')] },
      ],
    });

    expect(normalized.content?.[0].attrs).toMatchObject({ id: 'ports', caption: 'Ports' });
    expect(normalized.content?.[1].attrs).toMatchObject({ id: 'system', caption: 'System' });
    expect(normalized.content?.[2].content?.map((node) => node.marks?.[0].attrs?.href)).toEqual([
      '#system', '#ports',
    ]);
    expect(normalized.content?.[2].content?.map((node) => node.text)).toEqual(['Figure 1', 'Table 1']);
  });
});
