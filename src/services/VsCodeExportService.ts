import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { lstat, readFile, realpath, writeFile } from 'fs/promises';
import { convertJsonToHtml, convertJsonToAdoc, convertJsonToMarkdown, convertJsonToSlides } from '../../shared/converter';
import { detectBrowser, printToPdf } from '../utils/browserDetect';
import { loadBundledFontsAsBase64 } from '../utils/fontUtils';
import { convertWebviewUrisToRelativePaths, embedImagesAsBase64 } from '../utils/imageUtils';
import { MAX_CUSTOM_CSS_BYTES } from '../utils/cssUtils';
import { readContainedTextFile } from '../utils/containedFile';
import { getCaptionPreset, resolveDocumentSettingsSnapshot } from '../../shared/settingsResolver';
import { parseDocumentTextContract, readDocumentSettings } from '../../shared/document/documentContract';
import type {
  DocumentSettingApplicationTarget,
  DocumentSettingKey,
  ResolvedDocumentSettingsSnapshot,
} from '../../shared/types';
import type { FileOperationEffectiveSettingsView } from '../../shared/editor/fileOperations';
import { DocumentExportQueue } from '../../shared/export/DocumentExportQueue';
import type { DiagramPreparationResult } from '../../shared/export/diagramPreparation';
import { withTemporaryDirectory } from '../utils/temporaryDirectory';
import { loadBundledExportAssets } from './BundledExportAssetService';
import { computeRevision } from '../../shared/document/operations/sha256';

export type ExportFormat = 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides';
export type ExportOperationResult = 'completed' | 'cancelled' | 'fallback';

export type ExportOutputScope = 'document' | 'workspace' | 'book';

/** Slides' v1 visual identity is independent from document heading-decoration settings. */
export const PORTABLE_EXPORT_THEME_V1_PRIMARY_COLOR = '#2563EB';

const EXPORT_APPLICATION_TARGET = {
  html: 'html',
  pdf: 'pdf',
  markdown: 'markdown',
  adoc: 'asciidoc',
  slides: 'slides',
} as const satisfies Record<ExportFormat, DocumentSettingApplicationTarget>;

export function projectStandaloneExportSettings(
  snapshot: ResolvedDocumentSettingsSnapshot,
  format: ExportFormat,
): FileOperationEffectiveSettingsView {
  const target = EXPORT_APPLICATION_TARGET[format];
  const items = (Object.keys(snapshot.entries) as DocumentSettingKey[])
    .filter((key) => snapshot.entries[key].appliesTo.includes(target))
    .map((key) => {
      const entry = snapshot.entries[key];
      return Object.freeze({ key, value: String(entry.value), source: entry.source });
    });
  return Object.freeze({
    fingerprint: snapshot.fingerprint,
    items: Object.freeze(items),
  });
}

export interface ContainedExportTarget {
  readonly rootPath: string;
  readonly targetPath: string;
  readonly scope: ExportOutputScope;
  readonly relativePath: string;
}

const isContainedOrEqual = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

const isSameResolvedPath = (left: string, right: string): boolean => {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
};

async function resolveCanonicalAncestor(candidate: string): Promise<string> {
  const missing: string[] = [];
  let cursor = candidate;
  while (true) {
    try {
      const canonical = await realpath(cursor);
      return path.resolve(canonical, ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

/** Resolve a portable export target and reject lexical and canonical root escapes. */
export async function resolveContainedExportTarget(
  rootPath: string,
  outputDir: string,
  outputFileName: string,
  scope: ExportOutputScope,
): Promise<ContainedExportTarget> {
  if (!outputFileName
    || outputFileName === '.'
    || outputFileName === '..'
    || /[\\/:\0]/.test(outputFileName)
    || path.basename(outputFileName) !== outputFileName) {
    throw new Error('The export filename must not contain a path.');
  }
  const trimmed = outputDir.trim();
  const portableDirectory = trimmed === '' || trimmed === '.'
    ? ''
    : trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
  if (path.isAbsolute(trimmed)
    || /[\\:\0]/.test(trimmed)
    || (portableDirectory !== ''
      && portableDirectory.split('/').some((segment) => !segment || segment === '.' || segment === '..'))) {
    throw new Error('The export output directory must be a portable relative path in its approved scope.');
  }
  const canonicalRoot = await realpath(path.resolve(rootPath));
  const lexicalDirectory = path.resolve(canonicalRoot, portableDirectory || '.');
  if (!isContainedOrEqual(canonicalRoot, lexicalDirectory)) {
    throw new Error('The export output directory escapes its approved scope.');
  }
  const canonicalDirectory = await resolveCanonicalAncestor(lexicalDirectory);
  if (!isContainedOrEqual(canonicalRoot, canonicalDirectory)) {
    throw new Error('The export output directory resolves outside its approved scope.');
  }
  const targetPath = path.join(canonicalDirectory, outputFileName);
  try {
    const info = await lstat(targetPath);
    if (info.isSymbolicLink()) {
      throw new Error('The export target must not be a symbolic link or junction.');
    }
    const canonicalTarget = await realpath(targetPath);
    if (!isContainedOrEqual(canonicalRoot, canonicalTarget)) {
      throw new Error('The export target resolves outside its approved scope.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const portable = path.relative(canonicalRoot, targetPath).replace(/\\/g, '/');
  return Object.freeze({
    rootPath: canonicalRoot,
    targetPath,
    scope,
    relativePath: `./${portable}`,
  });
}

export interface PreparedDocumentExport {
  readonly sourceUri: vscode.Uri;
  readonly format: ExportFormat;
  readonly sourceText: string;
  readonly sourceVersion: number;
  readonly sourceFingerprint: string;
  readonly settingsSnapshot: ResolvedDocumentSettingsSnapshot;
  readonly outputUri: vscode.Uri;
  readonly outputBytes: Uint8Array;
  readonly outputScope: ExportOutputScope;
  readonly outputRootPath: string;
  readonly outputRelativePath: string;
  readonly targetFingerprint: string;
  readonly targetExists: boolean;
  readonly outcome: Exclude<ExportOperationResult, 'cancelled'>;
  readonly openKind: 'external' | 'html' | 'text';
  readonly warnings: readonly string[];
  readonly diagramFallbackCount: number;
}

export interface PreparedExportExecutionResult {
  outcome: ExportOperationResult;
  outputUri?: vscode.Uri;
  sizeBytes?: number;
}

export interface PreparedExportExecutionOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  /** Re-check scope/integrity before creating the destination directory or staging file. */
  validateBeforeWrite?: () => Promise<void>;
  /** Re-check destination state after staging and immediately before atomic commit. */
  validateTarget?: () => Promise<void>;
  /** Called after final validation and cancellation checks, immediately before atomic rename. */
  onCommitStart?: () => void;
}

/**
 * Host-rendered HTML/PDF payload used by compound documents such as Books.
 * All source, settings, CSS, image and diagram reads happen before this value
 * is created; execution only prints/writes these immutable bytes.
 */
export interface PreparedRenderedExport {
  readonly sourceUri: vscode.Uri;
  readonly format: 'html' | 'pdf';
  readonly htmlContent: string;
  readonly outputUri: vscode.Uri;
  /** Canonical trusted scope root captured while resolving the rendered export target. */
  readonly outputRootPath: string;
  readonly targetFingerprint: string;
  readonly targetExists: boolean;
  readonly pdfFallback: boolean;
  readonly pdfBrowserPath?: string;
}

type DiagramPreparationInput =
  | Pick<DiagramPreparationResult,
    'resolveDiagramImage' | 'status' | 'fallbackOccurrenceCount' | 'fallbackChapterCount'>
  | ((signal: AbortSignal, document: import('../../shared/types').TiptapNode) => Promise<Pick<DiagramPreparationResult,
    'resolveDiagramImage' | 'status' | 'fallbackOccurrenceCount' | 'fallbackChapterCount'> | undefined>);

export interface PrepareDocumentExportOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  diagramPreparation?: DiagramPreparationInput;
}

export class VsCodeExportService {
  private readonly exportQueue = new DocumentExportQueue();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async prepareDocumentExport(
    document: vscode.TextDocument,
    format: ExportFormat,
    options: PrepareDocumentExportOptions = {},
  ): Promise<PreparedDocumentExport> {
    options.signal?.throwIfAborted();
    const sourceText = document.getText();
    const contract = parseDocumentTextContract(sourceText);
    if (!contract.ok) {
      throw new Error(contract.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; '));
    }
    const settingsSnapshot = resolveDocumentSettingsSnapshot({
      context: 'standalone',
      documentSettings: readDocumentSettings(contract.envelope),
    });
    const sourceVersion = document.version;
    const sourceFingerprint = this.readSourceFingerprint(document);
    const browserPath = format === 'pdf' ? await detectBrowser() : undefined;
    const pdfFallback = format === 'pdf' && !browserPath;
    const outputFileName = this.exportFileName(
      document,
      pdfFallback ? '.html' : this.extensionForFormat(format),
    );
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const outputScope = workspaceFolder ? 'workspace' as const : 'document' as const;
    const outputRootPath = workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    const outputTarget = await resolveContainedExportTarget(
      outputRootPath,
      settingsSnapshot.values.outputDir,
      outputFileName,
      outputScope,
    );
    const outputUri = vscode.Uri.file(outputTarget.targetPath);
    options.signal?.throwIfAborted();
    const rendered = await this.renderDocumentSnapshot(
      contract.envelope.doc,
      contract.envelope.meta,
      document,
      format,
      settingsSnapshot,
      browserPath,
      options,
    );
    options.signal?.throwIfAborted();
    if (this.readSourceFingerprint(document) !== sourceFingerprint) {
      throw new Error('The document changed while export preflight was being prepared.');
    }
    const finalOutputTarget = await resolveContainedExportTarget(
      outputRootPath,
      settingsSnapshot.values.outputDir,
      outputFileName,
      outputScope,
    );
    if (path.resolve(finalOutputTarget.targetPath) !== path.resolve(outputTarget.targetPath)) {
      throw new Error('The export destination changed while preflight was being prepared.');
    }
    const targetFingerprint = await this.readTargetFingerprint(outputUri);
    options.signal?.throwIfAborted();
    return Object.freeze({
      sourceUri: document.uri,
      format,
      sourceText,
      sourceVersion,
      sourceFingerprint,
      settingsSnapshot,
      outputUri,
      outputBytes: rendered.bytes,
      outputScope,
      outputRootPath: outputTarget.rootPath,
      outputRelativePath: outputTarget.relativePath,
      targetFingerprint,
      targetExists: targetFingerprint !== 'missing',
      outcome: rendered.outcome,
      openKind: rendered.openKind,
      warnings: Object.freeze([
        ...(targetFingerprint !== 'missing' ? ['The existing destination will be replaced.'] : []),
        ...rendered.warnings,
      ]),
      diagramFallbackCount: rendered.diagramFallbackCount,
    });
  }

  readSourceFingerprint(document: vscode.TextDocument): string {
    return `${document.version}:${computeRevision(document.getText())}`;
  }

  async readTargetFingerprint(uri: vscode.Uri): Promise<string> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return `${stat.type}:${stat.size}:${stat.mtime}:${stat.ctime}`;
    } catch {
      return 'missing';
    }
  }

  async executePreparedExport(
    prepared: PreparedDocumentExport,
    options: PreparedExportExecutionOptions = {},
  ): Promise<PreparedExportExecutionResult> {
    return this.exportQueue.run(prepared.sourceUri.toString(), async () => {
      options.signal?.throwIfAborted();
      options.onProgress?.('Writing immutable export snapshot…');
      await this.writeExportBytes(
        prepared.outputUri,
        prepared.outputBytes,
        options.signal,
        options.validateTarget,
        options.onCommitStart,
        prepared.outputRootPath,
        async () => {
          await this.validatePreparedOutputScope(prepared);
          await options.validateBeforeWrite?.();
        },
      );
      const stat = await vscode.workspace.fs.stat(prepared.outputUri);
      return {
        outcome: prepared.outcome,
        outputUri: prepared.outputUri,
        sizeBytes: stat.size,
      };
    });
  }

  async executePreparedRenderedExport(
    prepared: PreparedRenderedExport,
    options: PreparedExportExecutionOptions = {},
  ): Promise<PreparedExportExecutionResult> {
    return this.exportQueue.run(prepared.sourceUri.toString(), async () => {
      options.signal?.throwIfAborted();
      const outcome: ExportOperationResult = prepared.pdfFallback ? 'fallback' : 'completed';
      if (prepared.format === 'pdf' && !prepared.pdfFallback) {
        if (!prepared.pdfBrowserPath) {
          throw new Error('The PDF browser selected during preflight is unavailable.');
        }
        options.onProgress?.('Printing immutable PDF snapshot…');
        await withTemporaryDirectory('sdocbook-pdf-', async (tempDir) => {
          const tempHtmlPath = path.join(tempDir, 'document.html');
          const tempPdfPath = path.join(tempDir, 'document.pdf');
          await writeFile(tempHtmlPath, prepared.htmlContent, 'utf8');
          options.signal?.throwIfAborted();
          await printToPdf(prepared.pdfBrowserPath!, tempHtmlPath, tempPdfPath, options.signal);
          options.signal?.throwIfAborted();
          await this.writeExportBytes(
            prepared.outputUri,
            new Uint8Array(await readFile(tempPdfPath)),
            options.signal,
            options.validateTarget,
            options.onCommitStart,
            prepared.outputRootPath,
            options.validateBeforeWrite,
          );
        });
      } else {
        options.onProgress?.('Writing immutable export snapshot…');
        await this.writeExportBytes(
          prepared.outputUri,
          new TextEncoder().encode(prepared.htmlContent),
          options.signal,
          options.validateTarget,
          options.onCommitStart,
          prepared.outputRootPath,
          options.validateBeforeWrite,
        );
      }
      const stat = await vscode.workspace.fs.stat(prepared.outputUri);
      return { outcome, outputUri: prepared.outputUri, sizeBytes: stat.size };
    });
  }

  async exportDocument(
    document: vscode.TextDocument,
    format: ExportFormat,
    diagramPreparation?: DiagramPreparationInput,
  ): Promise<ExportOperationResult> {
    const controller = new AbortController();
    const prepared = await this.prepareDocumentExport(document, format, {
      signal: controller.signal,
      diagramPreparation,
    });
    if (prepared.targetExists && !await this.confirmOverwrite(prepared.outputUri)) return 'cancelled';
    if (this.readSourceFingerprint(document) !== prepared.sourceFingerprint) {
      throw new Error('The document changed after export preflight.');
    }
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `내보내기 중 (${this.formatLabel(format)})`,
        cancellable: true,
      },
      async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
          return await this.executePreparedExport(prepared, {
            signal: controller.signal,
            onProgress: (stage) => progress.report({ message: stage }),
            validateTarget: async () => {
              await this.validatePreparedOutputScope(prepared);
              if (await this.readTargetFingerprint(prepared.outputUri) !== prepared.targetFingerprint) {
                throw new Error('The export destination changed after confirmation.');
              }
            },
          });
        } catch (error) {
          if (controller.signal.aborted) return { outcome: 'cancelled' as const };
          throw error;
        } finally {
          cancellation.dispose();
        }
      },
    );
    if (result.outcome === 'cancelled' || !result.outputUri) return 'cancelled';
    const openLabel = prepared.openKind === 'external'
      ? 'Open File' : prepared.openKind === 'html' ? 'Open HTML' : 'Open File';
    const action = await vscode.window.showInformationMessage(
      `${this.formatLabel(format)} exported: ${result.outputUri.fsPath}`,
      openLabel,
      'Reveal in Explorer',
    );
    if (action === openLabel) {
      if (prepared.openKind === 'external') await vscode.env.openExternal(result.outputUri);
      else if (prepared.openKind === 'html') await vscode.commands.executeCommand('vscode.open', result.outputUri);
      else {
        const opened = await vscode.workspace.openTextDocument(result.outputUri);
        await vscode.window.showTextDocument(opened, { preview: false });
      }
    } else if (action === 'Reveal in Explorer') {
      await vscode.commands.executeCommand('revealFileInOS', result.outputUri);
    }
    for (const warning of prepared.warnings) void vscode.window.showWarningMessage(warning);
    return result.outcome;
  }

  async validatePreparedOutputScope(prepared: PreparedDocumentExport): Promise<void> {
    const portable = prepared.outputRelativePath.replace(/^\.\//, '');
    const checked = await resolveContainedExportTarget(
      prepared.outputRootPath,
      path.dirname(portable) === '.' ? '' : path.dirname(portable),
      path.basename(portable),
      prepared.outputScope,
    );
    if (!isSameResolvedPath(checked.targetPath, prepared.outputUri.fsPath)) {
      throw new Error('The export destination scope changed after preflight.');
    }
  }

  private async renderDocumentSnapshot(
    doc: import('../../shared/types').TiptapNode,
    meta: import('../../shared/types').SdocMeta,
    document: vscode.TextDocument,
    format: ExportFormat,
    settingsSnapshot: ResolvedDocumentSettingsSnapshot,
    browserPath: string | undefined,
    options: PrepareDocumentExportOptions,
  ): Promise<{
    bytes: Uint8Array;
    outcome: 'completed' | 'fallback';
    openKind: 'external' | 'html' | 'text';
    warnings: string[];
    diagramFallbackCount: number;
  }> {
    const signal = options.signal;
    const report = options.onProgress ?? (() => undefined);
    const diagramPreparation = typeof options.diagramPreparation === 'function'
      ? await options.diagramPreparation(signal ?? new AbortController().signal, doc)
      : options.diagramPreparation;
    signal?.throwIfAborted();
    const warnings: string[] = [];
    if (diagramPreparation?.status === 'fallback') {
      warnings.push(`${diagramPreparation.fallbackOccurrenceCount} diagram occurrence(s) will use source fallback.`);
    }
    const resolved = settingsSnapshot.values;
    const preset = getCaptionPreset(resolved.captionStyle);
    const exportSettings: Record<string, unknown> = {
      captionStyle: resolved.captionStyle,
      headingNumbering: resolved.headingNumbering,
      headingStartNumber: resolved.headingStartNumber,
      headingDecoration: resolved.headingDecoration,
      headingH1Color: resolved.headingH1Color,
      headingH2Color: resolved.headingH2Color,
      headingH3Color: resolved.headingH3Color,
      headingH4Color: resolved.headingH4Color,
      headingH5Color: resolved.headingH5Color,
      headingH6Color: resolved.headingH6Color,
      imageCaptionPrefix: preset.figurePrefix,
      tableCaptionPrefix: preset.tablePrefix,
      equationCaptionPrefix: preset.equationPrefix,
      captionSeparator: preset.separator,
      tableNumberStyle: preset.tableNumberStyle,
      equationParens: preset.equationParens,
      captionNumbering: resolved.captionNumbering,
      equationNumbering: resolved.equationNumbering,
      crossRefIncludeCaption: resolved.crossRefIncludeCaption,
      exportImagePath: 'relative',
    };
    let convertedDoc = convertWebviewUrisToRelativePaths(doc);
    const needsImages = (format === 'html' || format === 'pdf' || format === 'slides')
      && (resolved.selfContained !== 'none' || format === 'pdf');
    if (needsImages) {
      report('Embedding image snapshot…');
      convertedDoc = await embedImagesAsBase64(convertedDoc, path.dirname(document.uri.fsPath), signal);
      exportSettings.selfContained = format === 'pdf' && resolved.selfContained === 'none'
        ? 'images-only' : resolved.selfContained;
    }
    if ((format === 'html' || format === 'pdf') && resolved.selfContained === 'full') {
      report('Embedding export runtime snapshot…');
      exportSettings.embeddedAssets = await loadBundledExportAssets(this.context.extensionPath);
      signal?.throwIfAborted();
    }
    const encode = (content: string): Uint8Array => new TextEncoder().encode(content);
    const usedDiagramFallback = diagramPreparation?.status === 'fallback';
    const diagramFallbackCount = diagramPreparation?.fallbackOccurrenceCount ?? 0;

    if (format === 'adoc') {
      return {
        bytes: encode(convertJsonToAdoc(convertedDoc, exportSettings, meta)),
        outcome: usedDiagramFallback ? 'fallback' : 'completed', openKind: 'text', warnings,
        diagramFallbackCount,
      };
    }
    if (format === 'markdown') {
      return {
        bytes: encode(convertJsonToMarkdown(convertedDoc, exportSettings, meta)),
        outcome: usedDiagramFallback ? 'fallback' : 'completed', openKind: 'text', warnings,
        diagramFallbackCount,
      };
    }

    const fontWeights = { body: 400, bold: 700, h1: 700, h2: 600, h3: 600 };
    report('Embedding font snapshot…');
    const embeddedFonts = await loadBundledFontsAsBase64(
      this.context.extensionUri,
      new Set(Object.values(fontWeights)),
    );
    signal?.throwIfAborted();
    if (format === 'slides') {
      const css = await this.readPreparedCss(
        resolved.slideCssPath, this.getWorkspaceBasePath(document), warnings,
      );
      const slideSettings = {
        ...exportSettings,
        slideBreak: resolved.slideBreakLevel,
        slideBreakLevel: resolved.slideBreakLevel,
        showTitleSlide: resolved.showTitleSlide,
        transition: resolved.slideTransition,
        slideTransition: resolved.slideTransition,
      };
      const content = convertJsonToSlides(
        convertedDoc,
        {
          ...this.buildPortableTheme(
            PORTABLE_EXPORT_THEME_V1_PRIMARY_COLOR,
            fontWeights,
            embeddedFonts,
          ),
          customStyles: css,
        },
        slideSettings,
        meta,
        { resolveDiagramImage: diagramPreparation?.resolveDiagramImage },
      );
      return {
        bytes: encode(content), outcome: usedDiagramFallback ? 'fallback' : 'completed',
        openKind: 'external', warnings, diagramFallbackCount,
      };
    }

    const customStyles = await this.readPreparedCss(
      resolved.htmlCssPath, this.getWorkspaceBasePath(document), warnings,
    );
    let html = convertJsonToHtml(
      convertedDoc,
      { ...this.buildPortableTheme(resolved.headingH1Color, fontWeights, embeddedFonts), customStyles },
      exportSettings,
      meta,
      { resolveDiagramImage: diagramPreparation?.resolveDiagramImage },
    );
    if (format === 'html') {
      return {
        bytes: encode(html), outcome: usedDiagramFallback ? 'fallback' : 'completed',
        openKind: 'html', warnings, diagramFallbackCount,
      };
    }
    if (!browserPath) {
      warnings.push('PDF is unavailable; an HTML fallback will be created.');
      return {
        bytes: encode(html), outcome: 'fallback', openKind: 'html', warnings,
        diagramFallbackCount,
      };
    }
    html = html.replace(
      '</head>',
      `<style>body{zoom:${resolved.pdfScale / 100};}</style>\n</head>`,
    );
    report('Printing immutable PDF snapshot…');
    const bytes = await withTemporaryDirectory('sdoc-pdf-', async (tempDir) => {
      const tempHtmlPath = path.join(tempDir, 'document.html');
      const tempPdfPath = path.join(tempDir, 'document.pdf');
      await writeFile(tempHtmlPath, html, 'utf8');
      signal?.throwIfAborted();
      await printToPdf(browserPath, tempHtmlPath, tempPdfPath, signal);
      signal?.throwIfAborted();
      return new Uint8Array(await readFile(tempPdfPath));
    });
    return {
      bytes, outcome: usedDiagramFallback ? 'fallback' : 'completed',
      openKind: 'external', warnings, diagramFallbackCount,
    };
  }

  private async readPreparedCss(
    cssPath: string,
    rootPath: string,
    warnings: string[],
  ): Promise<string> {
    if (!cssPath) return '';
    try {
      return await readContainedTextFile(rootPath, cssPath, {
        extension: '.css', maximumBytes: MAX_CUSTOM_CSS_BYTES,
      });
    } catch {
      warnings.push('Custom CSS could not be read safely and was replaced with the built-in style.');
      return '';
    }
  }

  private getWorkspaceBasePath(document: vscode.TextDocument): string {
    return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath);
  }

  private formatLabel(format: ExportFormat): string {
    return ({ html: 'HTML', pdf: 'PDF', markdown: 'Markdown', adoc: 'AsciiDoc', slides: 'Slides' })[format];
  }

  private buildPortableTheme(
    primaryColor: string,
    fontWeights: { body: number; bold: number; h1: number; h2: number; h3: number },
    embeddedFonts: { weight: number; dataUri: string }[],
  ): Record<string, unknown> {
    return {
      companyLogo: '',
      companyName: '',
      primaryColor,
      accentColor: '#6b6b6b',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      customStyles: '',
      fontWeights,
      embeddedFonts,
    };
  }

  private extensionForFormat(format: ExportFormat): string {
    return ({ html: '.html', pdf: '.pdf', markdown: '.md', adoc: '.adoc', slides: '.slides.html' })[format];
  }

  private exportFileName(document: vscode.TextDocument, extension: string): string {
    const baseName = path.basename(document.uri.fsPath).replace(/(\.tiptap\.json|\.sdoc)$/, '');
    return `${baseName}${extension}`;
  }

  private async confirmOverwrite(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      return true;
    }

    const answer = await vscode.window.showWarningMessage(
      `이미 파일이 있습니다. 덮어쓰시겠습니까?\n${uri.fsPath}`,
      { modal: true },
      '덮어쓰기'
    );
    return answer === '덮어쓰기';
  }

  private async writeExportBytes(
    outputUri: vscode.Uri,
    content: Uint8Array,
    signal?: AbortSignal,
    validateTarget?: () => Promise<void>,
    onCommitStart?: () => void,
    stagingRootPath?: string,
    validateBeforeWrite?: () => Promise<void>,
  ): Promise<void> {
    const temporaryUri = stagingRootPath
      ? vscode.Uri.file(path.join(
        stagingRootPath,
        `.sdoc-export-${randomUUID()}.tmp`,
      ))
      : outputUri.with({
        path: `${outputUri.path}.sdoc-export-${randomUUID()}.tmp`,
      });
    await validateBeforeWrite?.();
    signal?.throwIfAborted();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(outputUri.fsPath)));
    signal?.throwIfAborted();
    try {
      await vscode.workspace.fs.writeFile(temporaryUri, content);
      signal?.throwIfAborted();
      await validateTarget?.();
      signal?.throwIfAborted();
      onCommitStart?.();
      await vscode.workspace.fs.rename(temporaryUri, outputUri, { overwrite: true });
    } finally {
      try {
        await vscode.workspace.fs.delete(temporaryUri);
      } catch {
        // The successful rename already removed the staging file.
      }
    }
  }
}
