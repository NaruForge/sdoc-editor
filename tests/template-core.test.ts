import { describe, expect, it } from 'vitest';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { walkDocument } from '../shared/document/walker';
import {
  BUILTIN_TEMPLATES,
  buildTemplateCatalog,
  instantiateTemplate,
  type TemplateCandidate,
} from '../shared/template';

const validEnvelope = (): unknown => ({
  sdoc: '1.0',
  meta: {
    title: '원본',
    author: 'Original Author',
    version: '4.2',
    created: '2025-01-01T00:00:00.000Z',
    modified: '2025-01-02T00:00:00.000Z',
    settings: { captionStyle: 'korean' },
    review: { status: 'draft' },
    template: {
      name: '사용자 설계서',
      description: '프로젝트 설계 양식',
      category: 'design',
      titleNodeId: 'document-title',
    },
  },
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, id: 'document-title' },
        content: [{ type: 'text', text: '원본 제목' }],
      },
      {
        type: 'heading',
        attrs: { level: 2, id: 'architecture' },
        content: [{ type: 'text', text: '구조' }],
      },
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: '구조 참조',
          marks: [{ type: 'link', attrs: { href: '#architecture' } }],
        }],
      },
    ],
  },
});

const candidate = (value: unknown, fileName = 'team-design.sdoc'): TemplateCandidate => ({
  id: `workspace:sample:${fileName}`,
  source: 'workspace',
  sourceLabel: 'sample',
  fileName,
  value,
});

describe('template catalog', () => {
  it('provides schema-valid built-ins in stable blank/report/design/verification order', () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.descriptor.id)).toEqual([
      'builtin:blank',
      'builtin:technical-report',
      'builtin:design-specification',
      'builtin:verification-report',
    ]);
    expect(BUILTIN_TEMPLATES.map((template) => template.descriptor.name)).toEqual([
      '빈 문서',
      '기술 보고서',
      '설계 명세서',
      '시험·검증 보고서',
    ]);
    for (const template of BUILTIN_TEMPLATES) {
      expect(() => assertPersistedDocument(template.envelope)).not.toThrow();
      expect([...walkDocument(template.envelope.doc)].some(({ node }) =>
        node.type === 'heading' && node.attrs?.id === template.descriptor.titleNodeId)).toBe(true);
    }
  });

  it('validates unknown candidates and isolates malformed, future, and legacy documents', () => {
    const catalog = buildTemplateCatalog({
      builtIn: [],
      workspaceCandidates: [
        candidate(validEnvelope(), 'valid.sdoc'),
        candidate({ unexpected: true }, 'malformed.sdoc'),
        candidate({ sdoc: '2.0', meta: {}, doc: { type: 'doc', content: [] } }, 'future.sdoc'),
        candidate({ type: 'doc', content: [] }, 'legacy.sdoc'),
      ],
    });

    expect(catalog.templates.map((template) => template.descriptor.name)).toEqual(['사용자 설계서']);
    expect(catalog.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'malformed-document',
      'unsupported-version',
      'legacy-document',
    ]);
  });

  it('uses the filename as a name fallback and narrows optional template metadata', () => {
    const withoutMetadata = validEnvelope() as {
      meta: Record<string, unknown>;
    };
    delete withoutMetadata.meta.template;

    const catalog = buildTemplateCatalog({
      builtIn: [],
      workspaceCandidates: [
        candidate(withoutMetadata, 'technical.review.sdoc'),
        candidate({
          ...(validEnvelope() as object),
          meta: { template: { name: 42 } },
        }, 'invalid-meta.sdoc'),
        candidate({
          ...(validEnvelope() as object),
          meta: { template: { name: '잘못된 제목 노드', titleNodeId: 'missing-heading' } },
        }, 'invalid-title-node.sdoc'),
      ],
    });

    expect(catalog.templates[0]?.descriptor).toMatchObject({
      name: 'technical.review',
      source: 'workspace',
      sourceLabel: 'sample',
    });
    expect(catalog.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'invalid-template-metadata',
      'invalid-title-node',
    ]);
  });

  it('rejects workspace templates that reference unbundled image or Draw.io assets', () => {
    const withAsset = validEnvelope() as {
      doc: { content: unknown[] };
    };
    withAsset.doc.content.push({
      type: 'image',
      attrs: { src: './drawio/system.drawio.svg', id: 'system-diagram' },
    });

    const catalog = buildTemplateCatalog({
      builtIn: [],
      workspaceCandidates: [candidate(withAsset, 'asset-template.sdoc')],
    });

    expect(catalog.templates).toEqual([]);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        code: 'unsupported-assets',
        targetPath: 'asset-template.sdoc',
      }),
    ]);
  });
});

describe('template instantiation', () => {
  it('creates an independent persisted document while preserving document semantics', () => {
    const input = validEnvelope();
    const snapshot = structuredClone(input);
    const catalog = buildTemplateCatalog({
      builtIn: [],
      workspaceCandidates: [candidate(input)],
    });
    const template = catalog.templates[0];
    expect(template).toBeDefined();
    if (!template) return;

    const instantiated = instantiateTemplate(template, {
      title: '신규 시스템 설계',
      now: () => new Date('2026-07-22T01:02:03.000Z'),
    });

    expect(input).toEqual(snapshot);
    expect(instantiated.meta).toMatchObject({
      title: '신규 시스템 설계',
      author: '',
      version: '0.1',
      created: '2026-07-22T01:02:03.000Z',
      modified: '2026-07-22T01:02:03.000Z',
      settings: { captionStyle: 'korean' },
      review: { status: 'draft' },
    });
    expect(instantiated.meta).not.toHaveProperty('template');
    expect(instantiated.doc.content?.[0]).toEqual({
      type: 'heading',
      attrs: { level: 1, id: 'document-title' },
      content: [{ type: 'text', text: '신규 시스템 설계' }],
    });
    expect(instantiated.doc.content?.[1].attrs?.id).toBe('architecture');
    expect(instantiated.doc.content?.[2].content?.[0].marks?.[0].attrs?.href).toBe('#architecture');
    expect(() => assertPersistedDocument(instantiated)).not.toThrow();
  });
});
