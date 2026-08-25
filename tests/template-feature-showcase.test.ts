import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  composeBook,
  measureBookUtf8Bytes,
  type BookDocumentLoader,
} from '../shared/book';
import {
  convertJsonToAdoc,
  convertJsonToHtml,
  convertJsonToMarkdown,
  convertJsonToSlides,
} from '../shared/converter';
import { assertPersistedDocument } from '../shared/document/documentContract';
import {
  inspectDocumentBytes,
  validateDocumentBytes,
} from '../shared/document/operations';
import { walkDocument } from '../shared/document/walker';
import { createTiptapExtensions } from '../shared/editor/extensions/tiptapExtensions';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '../shared/editor/extensionRuntime';
import { buildDocumentStructureIndex } from '../shared/editor/structureIndex';
import { resolveEditorSettings } from '../shared/settingsResolver';
import {
  BUILTIN_TEMPLATES,
  getBuiltInTemplates,
  instantiateTemplate,
} from '../shared/template';
import type { TiptapNode } from '../shared/types';

const SHOWCASE_ID = 'builtin:feature-showcase';

type CoverageKind = 'included' | 'limited' | 'excluded';

interface CoverageRow {
  feature: string;
  kind: CoverageKind;
  followUp?: string;
}

/** Phase 0 feature-coverage table for #139. */
const FEATURE_SHOWCASE_COVERAGE: readonly CoverageRow[] = [
  { feature: 'heading-h1-h6', kind: 'included' },
  { feature: 'unnumbered-heading', kind: 'included' },
  { feature: 'paragraph-and-marks', kind: 'included' },
  { feature: 'hard-break', kind: 'included' },
  { feature: 'bullet-list', kind: 'included' },
  { feature: 'ordered-list', kind: 'included' },
  { feature: 'task-list', kind: 'included' },
  { feature: 'table-caption-merged-cells', kind: 'included' },
  { feature: 'math-inline', kind: 'included' },
  { feature: 'math-block', kind: 'included' },
  { feature: 'code-block', kind: 'included' },
  { feature: 'mermaid-diagram', kind: 'included' },
  { feature: 'blockquote', kind: 'included' },
  { feature: 'callout', kind: 'included' },
  { feature: 'horizontal-rule', kind: 'included' },
  { feature: 'cross-references', kind: 'included' },
  { feature: 'endnotes', kind: 'included' },
  { feature: 'document-settings', kind: 'included' },
  { feature: 'image', kind: 'excluded', followUp: '#26' },
  { feature: 'drawio', kind: 'excluded', followUp: '#26' },
  { feature: 'plantuml-d2-graphviz', kind: 'excluded', followUp: 'ADR 0011' },
  { feature: 'remote-template-catalog', kind: 'excluded', followUp: '#27' },
  { feature: 'slides-with-endnotes', kind: 'limited' },
  { feature: 'sdocbook-with-endnotes', kind: 'limited' },
];

const SCHEMA_BLOCK_TYPES = [
  'heading', 'paragraph', 'bulletList', 'orderedList', 'taskList',
  'codeBlock', 'table', 'image', 'mathBlock', 'diagram', 'blockquote',
  'callout', 'horizontalRule', 'hardBreak',
] as const;

const getShowcase = () => {
  const template = BUILTIN_TEMPLATES.find((candidate) => candidate.descriptor.id === SHOWCASE_ID);
  expect(template).toBeDefined();
  return template!;
};

const nodeText = (node: TiptapNode): string => {
  const parts: string[] = [];
  const collect = (current: TiptapNode): void => {
    if (typeof current.text === 'string') parts.push(current.text);
    current.content?.forEach(collect);
  };
  collect(node);
  return parts.join('');
};

const memoryLoader = (files: Record<string, unknown>): BookDocumentLoader => ({
  async load(path) {
    const value = files[path];
    if (value === undefined) throw new Error(`missing ${path}`);
    return {
      value,
      byteLength: measureBookUtf8Bytes(typeof value === 'string' ? value : JSON.stringify(value)),
    };
  },
});

describe('builtin:feature-showcase', () => {
  it('records every schema block type as included, limited, or excluded with a follow-up', () => {
    const classified = new Set(FEATURE_SHOWCASE_COVERAGE.map((row) => row.feature));
    expect(classified.size).toBe(FEATURE_SHOWCASE_COVERAGE.length);
    for (const row of FEATURE_SHOWCASE_COVERAGE) {
      if (row.kind === 'excluded') expect(row.followUp).toMatch(/^(#\d+|ADR \d+)$/);
    }
    expect(SCHEMA_BLOCK_TYPES).toEqual([
      'heading', 'paragraph', 'bulletList', 'orderedList', 'taskList',
      'codeBlock', 'table', 'image', 'mathBlock', 'diagram', 'blockquote',
      'callout', 'horizontalRule', 'hardBreak',
    ]);
    expect(FEATURE_SHOWCASE_COVERAGE.some((row) => row.feature === 'image' && row.followUp === '#26')).toBe(true);
    expect(FEATURE_SHOWCASE_COVERAGE.some((row) => row.feature === 'drawio' && row.followUp === '#26')).toBe(true);
    expect(FEATURE_SHOWCASE_COVERAGE.some((row) => row.feature === 'remote-template-catalog' && row.followUp === '#27')).toBe(true);
  });

  it('is schema-valid, has unique IDs, and does not duplicate the canonical title as a body H1', () => {
    const template = getShowcase();
    expect(() => assertPersistedDocument(template.envelope)).not.toThrow();
    expect(template.descriptor.titleNodeId).toBeUndefined();
    expect(template.envelope.meta.template?.category).toBe('showcase');

    const ids: string[] = [];
    for (const { node } of walkDocument(template.envelope.doc)) {
      const id = node.attrs?.id;
      if (typeof id === 'string' && id.length > 0) ids.push(id);
    }
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith('provisional:'))).toBe(false);
    expect([...walkDocument(template.envelope.doc)].some(({ node }) =>
      node.type === 'heading'
      && node.content?.map((child) => child.text ?? '').join('') === template.envelope.meta.title,
    )).toBe(false);
  });

  it('includes self-contained examples and keeps excluded assets and external diagram languages out', () => {
    const template = getShowcase();
    const types = new Set([...walkDocument(template.envelope.doc)].map(({ node }) => node.type));
    for (const required of [
      'heading', 'paragraph', 'bulletList', 'orderedList', 'taskList', 'table',
      'mathInline', 'mathBlock', 'codeBlock', 'diagram', 'blockquote', 'callout',
      'horizontalRule', 'hardBreak', 'endnote',
    ]) {
      expect(types.has(required), `missing ${required}`).toBe(true);
    }
    expect(types.has('image')).toBe(false);

    const headingLevels = new Set(
      [...walkDocument(template.envelope.doc)]
        .filter(({ node }) => node.type === 'heading')
        .map(({ node }) => node.attrs?.level),
    );
    expect(headingLevels).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect([...walkDocument(template.envelope.doc)].some(({ node }) =>
      node.type === 'heading' && node.attrs?.numbered === false)).toBe(true);

    const diagrams = [...walkDocument(template.envelope.doc)]
      .filter(({ node }) => node.type === 'diagram');
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0]?.node.attrs).toMatchObject({
      language: 'mermaid',
      code: expect.stringContaining('flowchart LR'),
    });

    const table = [...walkDocument(template.envelope.doc)].find(({ node }) => node.type === 'table');
    expect(table?.node.attrs).toMatchObject({
      id: 'feature-matrix',
      caption: expect.stringContaining('문서 원본'),
    });
    const merged = [...walkDocument(table!.node)].filter(({ node }) =>
      (node.type === 'tableCell' || node.type === 'tableHeader')
      && ((node.attrs?.colspan ?? 1) > 1 || (node.attrs?.rowspan ?? 1) > 1));
    expect(merged.length).toBeGreaterThanOrEqual(2);

    expect(template.envelope.meta.settings).toMatchObject({
      headingNumbering: true,
      captionStyle: 'korean',
      captionNumbering: 'hierarchical',
      equationNumbering: 'hierarchical',
      crossRefIncludeCaption: true,
    });
  });

  it('keeps every authored cross-reference resolvable after instantiate', () => {
    const original = structuredClone(getShowcase());
    const instantiated = instantiateTemplate(getShowcase(), {
      title: '둘러보기 사본',
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    });
    expect(getShowcase().envelope).toEqual(original.envelope);
    expect(instantiated.meta).toMatchObject({
      title: '둘러보기 사본',
      author: '',
      version: '0.1',
      created: '2026-08-25T00:00:00.000Z',
      settings: original.envelope.meta.settings,
    });
    expect(instantiated.meta).not.toHaveProperty('template');
    expect(instantiated.doc).toEqual(original.envelope.doc);

    const bytes = `${JSON.stringify(instantiated)}\n`;
    const validated = validateDocumentBytes(bytes);
    expect(validated.ok).toBe(true);
    const inspected = inspectDocumentBytes(bytes);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.needsIdNormalization).toBe(false);
    expect(inspected.references.length).toBeGreaterThan(0);
    expect(inspected.references.every((reference) => reference.targetExists)).toBe(true);
    expect(inspected.endnotes.map((note) => note.id)).toEqual([
      'endnote-slides-limit',
      'endnote-book-limit',
    ]);
    expect(inspected.warnings.filter((warning) =>
      warning.code === 'DANGLING_REFERENCE' || warning.code === 'NONPORTABLE_ASSET',
    )).toEqual([]);
  });

  it('loads in the shared editor schema and keeps heading, table, equation, and footnote structure keyboard-addressable', () => {
    const template = getShowcase();
    const schema = getSchema(createTiptapExtensions(NOOP_EDITOR_EXTENSION_RUNTIME));
    const doc = schema.nodeFromJSON(template.envelope.doc);
    expect(doc.childCount).toBe(template.envelope.doc.content?.length);
    const index = buildDocumentStructureIndex(
      doc,
      resolveEditorSettings(template.envelope.meta.settings),
    );
    const headingIds = index.headings.map((entry) => entry.id);
    expect(headingIds).toEqual(expect.arrayContaining([
      'how-to-use',
      'headings-and-numbers',
      'heading-h6',
      'cross-references',
      'footnotes',
      'not-included',
    ]));
    expect(index.tables.some((entry) => entry.id === 'feature-matrix')).toBe(true);
    expect(index.equations.some((entry) => entry.id === 'energy-equation')).toBe(true);
    expect(index.endnotes.map((entry) => entry.id)).toEqual([
      'endnote-slides-limit',
      'endnote-book-limit',
    ]);
    expect(index.references.every((reference) => index.byId.has(reference.targetId))).toBe(true);

    const foldPlugin = createTiptapExtensions(NOOP_EDITOR_EXTENSION_RUNTIME)
      .find((extension) => extension.name === 'sectionFold');
    const plugins = foldPlugin?.config.addProseMirrorPlugins?.call(foldPlugin) ?? [];
    const state = EditorState.create({ schema, plugins, doc });
    const decorations = plugins[0]?.props.decorations?.(state);
    expect((decorations?.find().length ?? 0)).toBeGreaterThan(0);
  });

  it('preserves supported export meaning and fails closed for Slides and Book composition', async () => {
    const instantiated = instantiateTemplate(getShowcase(), {
      title: 'Export tour',
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    });
    const settings = instantiated.meta.settings;
    const html = convertJsonToHtml(instantiated.doc, undefined, settings, instantiated.meta);
    const markdown = convertJsonToMarkdown(instantiated.doc, settings, instantiated.meta);
    const adoc = convertJsonToAdoc(instantiated.doc, settings, instantiated.meta);

    expect(html).toContain('id="how-to-use"');
    expect(html).toContain('data-numbered="false"');
    expect(html).toContain('id="feature-matrix"');
    expect(html).toContain('colspan="3"');
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('flowchart LR');
    expect(html).not.toContain('data-language="plantuml"');
    expect(html).toContain('id="energy-equation"');
    expect(html).toContain('id="endnote-ref-endnote-slides-limit" href="#endnote-endnote-slides-limit"');
    expect(html).toContain('id="endnote-endnote-slides-limit"');
    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain('class="callout callout-warning"');
    expect(html).not.toContain('<img');

    expect(markdown).toContain('[^1]:');
    expect(markdown).toContain('```mermaid');
    expect(adoc).toContain('[[endnote-ref-endnote-slides-limit]]');
    expect(adoc).toContain('[mermaid]');

    expect(() => convertJsonToSlides(instantiated.doc, undefined, settings)).toThrow(
      /does not support endnotes/i,
    );

    const book = await composeBook({
      sdocBook: '1.0',
      documents: [{ path: './tour.sdoc' }],
    }, memoryLoader({ './tour.sdoc': instantiated }));
    expect(book.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'ENDNOTES_UNSUPPORTED',
      documentPath: './tour.sdoc',
    }));
  });

  it('is created as a new document from the same catalog source in VS Code and CLI', () => {
    const fromCatalog = getBuiltInTemplates().find((template) => template.descriptor.id === SHOWCASE_ID);
    expect(fromCatalog?.descriptor).toMatchObject({
      id: SHOWCASE_ID,
      name: '기능 둘러보기',
      source: 'builtin',
    });
    expect(fromCatalog?.envelope.doc).toEqual(getShowcase().envelope.doc);
    expect(nodeText(getShowcase().envelope.doc)).toContain('새 문서');
    expect(nodeText(getShowcase().envelope.doc)).not.toMatch(/PlantUML[\s\S]*```/);
  });
});
