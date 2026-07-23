import { describe, expect, it } from 'vitest';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { walkDocument } from '../shared/document/walker';
import {
  BUILTIN_TEMPLATES,
  buildTemplateStructuralPreview,
  buildTemplateCatalog,
  createPersonalTemplateSnapshot,
  instantiateTemplate,
  updatePersonalTemplateMetadata,
  type TemplateCandidate,
} from '../shared/template';

const PERSONAL_TEMPLATE_ID = 'user:550e8400-e29b-41d4-a716-446655440000';

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

const personalCandidate = (
  value: unknown,
  fileName = 'personal-design.sdoc',
  id = PERSONAL_TEMPLATE_ID,
): TemplateCandidate => ({
  id,
  source: 'user',
  sourceLabel: 'personal',
  fileName,
  value,
});

const withPersonalMetadata = (
  id: string | null = PERSONAL_TEMPLATE_ID,
): unknown => {
  const envelope = validEnvelope() as {
    meta: { template: Record<string, unknown> };
  };
  if (id === null) {
    delete envelope.meta.template.id;
  } else {
    envelope.meta.template.id = id;
  }
  return envelope;
};

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

  it('requires a namespaced UUID identity for personal templates while preserving workspace compatibility', () => {
    const catalog = buildTemplateCatalog({
      builtIn: [],
      workspaceCandidates: [candidate(validEnvelope(), 'legacy-workspace.sdoc')],
      userCandidates: [
        personalCandidate(withPersonalMetadata(), 'valid-personal.sdoc'),
        personalCandidate(withPersonalMetadata(null), 'missing-id.sdoc'),
        personalCandidate(withPersonalMetadata('workspace:stolen'), 'wrong-namespace.sdoc'),
      ],
    });

    expect(catalog.templates.map(({ descriptor }) => descriptor.id)).toEqual([
      'workspace:sample:legacy-workspace.sdoc',
      PERSONAL_TEMPLATE_ID,
    ]);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-template-id',
        targetPath: 'missing-id.sdoc',
        path: '/meta/template/id',
      }),
      expect.objectContaining({
        code: 'invalid-template-id',
        targetPath: 'wrong-namespace.sdoc',
        path: '/meta/template/id',
      }),
    ]);
  });

  it('fails every candidate closed when template identities are duplicated', () => {
    const secondId = 'user:123e4567-e89b-42d3-a456-426614174000';
    const catalog = buildTemplateCatalog({
      builtIn: [],
      userCandidates: [
        personalCandidate(withPersonalMetadata(), 'duplicate-a.sdoc'),
        personalCandidate(withPersonalMetadata(), 'duplicate-b.sdoc'),
        personalCandidate(withPersonalMetadata(secondId), 'unique.sdoc', secondId),
      ],
    });

    expect(catalog.templates.map(({ descriptor }) => descriptor.id)).toEqual([secondId]);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        code: 'duplicate-template-id',
        targetPath: 'duplicate-a.sdoc',
      }),
      expect.objectContaining({
        code: 'duplicate-template-id',
        targetPath: 'duplicate-b.sdoc',
      }),
    ]);
  });

  it('isolates a personal template whose persisted identity differs from its storage identity', () => {
    const storageId = 'user:123e4567-e89b-42d3-a456-426614174000';
    const catalog = buildTemplateCatalog({
      builtIn: [],
      userCandidates: [
        personalCandidate(withPersonalMetadata(), 'mismatched.sdoc', storageId),
      ],
    });

    expect(catalog.templates).toEqual([]);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-template-id',
        targetPath: 'mismatched.sdoc',
        path: '/meta/template/id',
      }),
    ]);
  });

  it('requires a non-empty persisted name for personal templates', () => {
    const missingName = withPersonalMetadata() as {
      meta: { template: Record<string, unknown> };
    };
    delete missingName.meta.template.name;
    const blankName = withPersonalMetadata() as {
      meta: { template: Record<string, unknown> };
    };
    blankName.meta.template.name = '   ';

    const catalog = buildTemplateCatalog({
      builtIn: [],
      userCandidates: [
        personalCandidate(missingName, 'missing-name.sdoc'),
        personalCandidate(blankName, 'blank-name.sdoc'),
      ],
    });

    expect(catalog.templates).toEqual([]);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid-template-metadata', path: '/meta/template/name' }),
      expect.objectContaining({ code: 'invalid-template-metadata', path: '/meta/template/name' }),
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

describe('personal template snapshots', () => {
  it('creates an immutable, schema-valid content snapshot without document identity metadata', () => {
    const input = validEnvelope() as {
      meta: Record<string, unknown> & { settings: Record<string, unknown> };
    };
    input.meta.settings.slideCssPath = 'C:\\Users\\me\\theme.css';
    input.meta.settings.htmlCssPath = './local-theme.css';
    input.meta.settings.outputDir = 'C:\\exports';
    const original = structuredClone(input);

    const snapshot = createPersonalTemplateSnapshot(input, {
      id: PERSONAL_TEMPLATE_ID,
      name: '개인 설계 템플릿',
      description: '설계 본문만 재사용',
      category: 'design',
      titleNodeId: 'document-title',
      sourceLabel: '내 템플릿',
    });

    expect(input).toEqual(original);
    expect(snapshot.descriptor).toEqual({
      id: PERSONAL_TEMPLATE_ID,
      name: '개인 설계 템플릿',
      description: '설계 본문만 재사용',
      category: 'design',
      source: 'user',
      sourceLabel: '내 템플릿',
      titleNodeId: 'document-title',
    });
    expect(snapshot.envelope.meta).toEqual({
      title: '원본',
      settings: {
        captionStyle: 'korean',
        slideCssPath: 'C:\\Users\\me\\theme.css',
        htmlCssPath: './local-theme.css',
        outputDir: 'C:\\exports',
      },
      template: {
        id: PERSONAL_TEMPLATE_ID,
        name: '개인 설계 템플릿',
        description: '설계 본문만 재사용',
        category: 'design',
        titleNodeId: 'document-title',
      },
    });
    expect(snapshot.envelope.doc).toEqual((input as { doc?: unknown }).doc);
    expect(snapshot.envelope.doc).not.toBe((input as { doc?: unknown }).doc);
    expect(() => assertPersistedDocument(snapshot.envelope)).not.toThrow();
  });

  it('rejects invalid personal IDs and nested asset references', () => {
    expect(() => createPersonalTemplateSnapshot(validEnvelope(), {
      id: 'user:not-a-uuid',
      name: '잘못된 ID',
    })).toThrow(/user:<uuid>/);

    const withNestedAsset = validEnvelope() as {
      doc: { content: unknown[] };
    };
    withNestedAsset.doc.content.push({
      type: 'blockquote',
      content: [{
        type: 'image',
        attrs: { src: './images/private.png', id: 'private-image' },
      }],
    });
    expect(() => createPersonalTemplateSnapshot(withNestedAsset, {
      id: PERSONAL_TEMPLATE_ID,
      name: '자산 포함 템플릿',
    })).toThrow(/이미지|Draw\.io/);
  });

  it('updates metadata without changing the personal ID or document snapshot', () => {
    const snapshot = createPersonalTemplateSnapshot(validEnvelope(), {
      id: PERSONAL_TEMPLATE_ID,
      name: '이전 이름',
      description: '이전 설명',
      category: 'old',
      titleNodeId: 'document-title',
    });
    const original = structuredClone(snapshot);

    const updated = updatePersonalTemplateMetadata(snapshot, {
      name: '새 이름',
      description: '새 설명',
      category: 'new',
    });

    expect(snapshot).toEqual(original);
    expect(updated.descriptor).toMatchObject({
      id: PERSONAL_TEMPLATE_ID,
      name: '새 이름',
      description: '새 설명',
      category: 'new',
    });
    expect(updated.envelope.meta.template).toMatchObject({
      id: PERSONAL_TEMPLATE_ID,
      name: '새 이름',
      description: '새 설명',
      category: 'new',
      titleNodeId: 'document-title',
    });
    expect(updated.envelope.doc).toEqual(snapshot.envelope.doc);
    expect(updated.envelope.doc).not.toBe(snapshot.envelope.doc);
    expect(() => assertPersistedDocument(updated.envelope)).not.toThrow();
  });
});

describe('template structural preview', () => {
  it('summarizes structure without returning document content and caps large outlines', () => {
    const catalog = buildTemplateCatalog({
      builtIn: [],
      workspaceCandidates: [candidate(validEnvelope())],
    });
    const template = catalog.templates[0];
    expect(template).toBeDefined();
    if (!template) return;

    for (let index = 0; index < 105; index += 1) {
      template.envelope.doc.content?.push({
        type: 'heading',
        attrs: { level: 3, id: `generated-${index}` },
        content: [{
          type: 'text',
          text: index === 0 ? `긴 제목 ${'가'.repeat(300)}` : `생성 제목 ${index}`,
        }],
      });
    }
    template.envelope.doc.content?.push(
      { type: 'table', attrs: { id: 'table-1' } },
      { type: 'mathBlock', attrs: { id: 'equation-1', latex: 'x=1' } },
      { type: 'diagram', attrs: { id: 'diagram-1' } },
      { type: 'codeBlock', attrs: { language: 'text' } },
    );

    const preview = buildTemplateStructuralPreview(template);

    expect(preview.templateId).toBe(template.descriptor.id);
    expect(preview.outline).toHaveLength(100);
    expect(preview.outline[0]).toMatchObject({
      id: 'document-title',
      level: 1,
      text: '원본 제목',
      isTitle: true,
    });
    expect(preview.outline[2]?.text.length).toBeLessThanOrEqual(160);
    expect(preview.counts).toMatchObject({
      headings: 107,
      paragraphs: 1,
      tables: 1,
      equations: 1,
      diagrams: 1,
      codeBlocks: 1,
    });
    expect(preview.settingsKeys).toEqual(['captionStyle']);
    expect(preview.truncated).toBe(true);
    expect(preview).not.toHaveProperty('document');
    expect(preview).not.toHaveProperty('envelope');
  });
});
