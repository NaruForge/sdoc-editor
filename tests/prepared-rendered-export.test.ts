import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { host, uri, slideThemes } = vi.hoisted(() => {
  const state = {
    bytes: new Uint8Array(),
    writePaths: [] as string[],
    order: [] as string[],
    createDirectory: vi.fn(async () => { state.order.push('mkdir'); }),
    writeFile: vi.fn(async (target: { fsPath: string }, bytes: Uint8Array) => {
      state.order.push('write-staging');
      state.writePaths.push(target.fsPath);
      state.bytes = bytes;
    }),
    rename: vi.fn(async () => { state.order.push('commit'); }),
    delete: vi.fn(async () => { state.order.push('cleanup'); }),
    stat: vi.fn(async () => ({ size: state.bytes.byteLength })),
  };
  const makeUri = (fsPath: string): object => ({
    fsPath,
    path: fsPath.replace(/\\/g, '/'),
    toString: () => `file:///${fsPath.replace(/\\/g, '/')}`,
    with(change: { path: string }) { return makeUri(change.path); },
  });
  return { host: state, uri: makeUri, slideThemes: [] as Record<string, unknown>[] };
});

vi.mock('vscode', () => ({
  Uri: { file: uri },
  workspace: { fs: host, getWorkspaceFolder: vi.fn(() => undefined) },
}));

vi.mock('../shared/converter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/converter')>();
  return {
    ...actual,
    convertJsonToSlides: vi.fn((
      _doc: unknown,
      theme: Record<string, unknown>,
    ) => {
      slideThemes.push(theme);
      return '<!doctype html><title>slides snapshot</title>';
    }),
  };
});

vi.mock('../src/utils/fontUtils', () => ({
  loadBundledFontsAsBase64: vi.fn(async () => []),
}));

import {
  PORTABLE_EXPORT_THEME_V1_PRIMARY_COLOR,
  projectStandaloneExportSettings,
  resolveContainedExportTarget,
  VsCodeExportService,
  type PreparedDocumentExport,
  type PreparedRenderedExport,
} from '../src/services/VsCodeExportService';
import { resolveDocumentSettingsSnapshot } from '../shared/settingsResolver';

describe('prepared rendered export execution', () => {
  beforeEach(() => {
    host.bytes = new Uint8Array();
    host.writePaths.length = 0;
    host.order.length = 0;
    slideThemes.length = 0;
    vi.clearAllMocks();
  });

  it('keeps the Slides theme on its versioned built-in color when document heading colors change', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sdoc-slide-theme-'));
    try {
      const sourceText = JSON.stringify({
        sdoc: '1.0',
        meta: { title: 'Slides', settings: { headingH1Color: '#C026D3' } },
        doc: { type: 'doc', content: [] },
      });
      const document = {
        uri: uri(path.join(root, 'slides.sdoc')),
        version: 3,
        getText: () => sourceText,
      } as never;
      const service = new VsCodeExportService({
        extensionUri: uri(root), extensionPath: root,
      } as never);

      const prepared = await service.prepareDocumentExport(document, 'slides');

      expect(new TextDecoder().decode(prepared.outputBytes)).toContain('slides snapshot');
      expect(slideThemes).toHaveLength(1);
      expect(slideThemes[0].primaryColor).toBe(PORTABLE_EXPORT_THEME_V1_PRIMARY_COLOR);
      expect(slideThemes[0].primaryColor).not.toBe('#C026D3');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('projects only settings that apply to the standalone export target', () => {
    const snapshot = resolveDocumentSettingsSnapshot({
      context: 'standalone',
      documentSettings: {
        headingDecoration: false,
        headingH1Color: '#C026D3',
        htmlCssPath: './html.css',
        pdfScale: 90,
        slideCssPath: './slides.css',
      },
    });
    const keysFor = (format: 'markdown' | 'adoc' | 'slides') =>
      projectStandaloneExportSettings(snapshot, format).items.map((item) => item.key);

    for (const format of ['markdown', 'adoc'] as const) {
      const keys = keysFor(format);
      expect(keys).toContain('headingNumbering');
      expect(keys).toContain('captionStyle');
      expect(keys).toContain('outputDir');
      expect(keys).not.toContain('headingDecoration');
      expect(keys).not.toContain('headingH1Color');
      expect(keys).not.toContain('htmlCssPath');
      expect(keys).not.toContain('pdfScale');
      expect(keys).not.toContain('slideCssPath');
    }

    const slideKeys = keysFor('slides');
    expect(slideKeys).toContain('slideCssPath');
    expect(slideKeys).toContain('slideBreakLevel');
    expect(slideKeys).toContain('selfContained');
    expect(slideKeys).not.toContain('headingDecoration');
    expect(slideKeys).not.toContain('headingH1Color');
    expect(slideKeys).not.toContain('htmlCssPath');
    expect(slideKeys).not.toContain('pdfScale');
  });

  it('commits the preflight HTML snapshot without consulting source or asset readers', async () => {
    const readSource = vi.fn(() => '<h1>preflight source</h1>');
    const readCss = vi.fn(() => 'h1{color:#123456}');
    const readDiagram = vi.fn(() => 'data:image/png;base64,c25hcHNob3Q=');
    const prepared: PreparedRenderedExport = Object.freeze({
      sourceUri: uri('C:\\book\\guide.sdocbook') as never,
      format: 'html',
      htmlContent: `<style>${readCss()}</style>${readSource()}<img src="${readDiagram()}">`,
      outputUri: uri('C:\\book\\guide.html') as never,
      outputRootPath: 'C:\\book',
      targetFingerprint: 'missing',
      targetExists: false,
      pdfFallback: false,
    });
    readSource.mockClear();
    readCss.mockClear();
    readDiagram.mockClear();
    const validateBeforeWrite = vi.fn(async () => { host.order.push('validate-before-write'); });
    const validateTarget = vi.fn(async () => { host.order.push('validate-target'); });

    const service = new VsCodeExportService({} as never);
    const result = await service.executePreparedRenderedExport(prepared, {
      validateBeforeWrite,
      validateTarget,
    });

    expect(readSource).not.toHaveBeenCalled();
    expect(readCss).not.toHaveBeenCalled();
    expect(readDiagram).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(host.bytes)).toBe(prepared.htmlContent);
    expect(host.order).toEqual([
      'validate-before-write', 'mkdir', 'write-staging', 'validate-target', 'commit', 'cleanup',
    ]);
    expect(path.dirname(host.writePaths[0]).replace(/\\/g, '/'))
      .toBe(prepared.outputRootPath.replace(/\\/g, '/'));
    expect(host.writePaths[0]).not.toContain('guide.html.sdoc-export-');
    expect(result).toMatchObject({ outcome: 'completed', sizeBytes: prepared.htmlContent.length });
  });

  it('commits prepared standalone bytes without consulting the document or render dependencies', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sdoc-standalone-output-'));
    try {
      const outputPath = path.join(root, 'report.html');
      const prepared: PreparedDocumentExport = Object.freeze({
        sourceUri: uri(path.join(root, 'report.sdoc')) as never,
        format: 'html',
        sourceText: '{"sdoc":"1.0"}',
        sourceVersion: 4,
        sourceFingerprint: '4:sha256:source',
        settingsSnapshot: {} as never,
        outputUri: uri(outputPath) as never,
        outputBytes: new TextEncoder().encode('<h1>immutable</h1>'),
        outputScope: 'document',
        outputRootPath: root,
        outputRelativePath: './report.html',
        targetFingerprint: 'missing',
        targetExists: false,
        outcome: 'completed',
        openKind: 'html',
        warnings: Object.freeze([]),
        diagramFallbackCount: 0,
      });
      const service = new VsCodeExportService({} as never);
      const validateBeforeWrite = vi.fn(async () => { host.order.push('validate-before-write'); });
      const validateTarget = vi.fn(async () => { host.order.push('validate-target'); });

      const result = await service.executePreparedExport(prepared, {
        validateBeforeWrite,
        validateTarget,
        onCommitStart: () => { host.order.push('commit-start'); },
      });

      expect(new TextDecoder().decode(host.bytes)).toBe('<h1>immutable</h1>');
      expect(host.order).toEqual([
        'validate-before-write', 'mkdir', 'write-staging', 'validate-target',
        'commit-start', 'commit', 'cleanup',
      ]);
      expect(result).toMatchObject({ outcome: 'completed' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('contained export targets', () => {
  it('accepts a workspace-relative target and returns a trusted relative summary', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sdoc-output-root-'));
    try {
      const target = await resolveContainedExportTarget(root, './dist', 'report.html', 'workspace');
      expect(target.scope).toBe('workspace');
      expect(target.relativePath).toBe('./dist/report.html');
      expect(target.targetPath).toBe(path.join(root, 'dist', 'report.html'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects absolute, traversal, and junction-backed output directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sdoc-output-root-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'sdoc-output-outside-'));
    try {
      await expect(resolveContainedExportTarget(root, outside, 'report.html', 'workspace'))
        .rejects.toThrow(/relative|scope/i);
      await expect(resolveContainedExportTarget(root, 'C:drive-relative', 'report.html', 'workspace'))
        .rejects.toThrow(/relative|portable|scope/i);
      await expect(resolveContainedExportTarget(root, 'nested\\windows-only', 'report.html', 'workspace'))
        .rejects.toThrow(/portable|scope/i);
      await expect(resolveContainedExportTarget(root, '../outside', 'report.html', 'workspace'))
        .rejects.toThrow(/scope/i);

      const link = path.join(root, 'linked');
      await mkdir(path.join(root, 'safe'));
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(resolveContainedExportTarget(root, './linked', 'report.html', 'workspace'))
        .rejects.toThrow(/scope/i);
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});
