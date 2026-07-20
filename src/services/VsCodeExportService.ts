import * as vscode from 'vscode';
import * as path from 'path';
import { convertJsonToHtml, convertJsonToAdoc, convertJsonToMarkdown, convertJsonToSlides } from '../../shared/converter';
import { detectBrowser, printToPdf } from '../utils/browserDetect';
import { loadBundledFontsAsBase64 } from '../utils/fontUtils';
import { convertWebviewUrisToRelativePaths, embedImagesAsBase64 } from '../utils/imageUtils';
import { resolveCompanyLogo, readFontWeights, buildHtmlTheme } from '../utils/themeUtils';
import { resolveCustomCss } from '../utils/cssUtils';
import { resolveSettings, getCaptionPreset } from '../../shared/settingsResolver';
import { unwrapSdoc as sharedUnwrapSdoc } from '../../shared/document/sdocUtils';
import type { CaptionStyleName, DocumentSettings } from '../../shared/types';

export class VsCodeExportService {
  private readonly exportInProgress = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async exportDocument(
    document: vscode.TextDocument,
    format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides',
    webview: vscode.Webview
  ): Promise<void> {
    const docKey = document.uri.toString();

    // Guard: prevent duplicate concurrent exports for the same document
    if (this.exportInProgress.has(docKey)) {
      vscode.window.showWarningMessage('이미 내보내기가 진행 중입니다. 잠시 기다려 주세요.');
      return;
    }

    const formatLabels: Record<string, string> = {
      html: 'HTML', pdf: 'PDF', markdown: 'Markdown', adoc: 'AsciiDoc', slides: 'Slides',
    };
    const label = formatLabels[format] ?? format.toUpperCase();

    this.exportInProgress.add(docKey);
    webview.postMessage({ type: 'exportStarted', format });

    // ExportResult: info needed to show completion message AFTER withProgress closes
    type ExportResult = {
      successMsg: string;
      actionLabel: string;
      openUri: vscode.Uri;
      openKind: 'external' | 'html' | 'text';
    } | null;

    let result: ExportResult = null;
    try {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `내보내기 중 (${label})`,
          cancellable: false,
        },
        async (progress) => {
          return await this._doExport(document, format, label, progress);
        }
      );
    } finally {
      this.exportInProgress.delete(docKey);
      webview.postMessage({ type: 'exportDone' });
    }

    // Show success notification AFTER progress notification has closed
    if (result) {
      const action = await vscode.window.showInformationMessage(
        result.successMsg,
        result.actionLabel,
        'Reveal in Explorer'
      );
      if (action === result.actionLabel) {
        if (result.openKind === 'external') {
          await vscode.env.openExternal(result.openUri);
        } else if (result.openKind === 'html') {
          await vscode.commands.executeCommand('vscode.open', result.openUri);
        } else {
          const openedDoc = await vscode.workspace.openTextDocument(result.openUri);
          await vscode.window.showTextDocument(openedDoc, { preview: false });
        }
      } else if (action === 'Reveal in Explorer') {
        await vscode.commands.executeCommand('revealFileInOS', result.openUri);
      }
    }
  }

  private async _doExport(
    document: vscode.TextDocument,
    format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides',
    label: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<{
    successMsg: string;
    actionLabel: string;
    openUri: vscode.Uri;
    openKind: 'external' | 'html' | 'text';
  } | null> {
    try {
      progress.report({ message: '문서 읽는 중...', increment: 5 });
      const text = document.getText();
      const parsed = text.trim() ? JSON.parse(text) : { sdoc: '1.0', meta: {}, doc: { type: 'doc', content: [] } };

      // Unwrap envelope
      const { doc, meta } = sharedUnwrapSdoc(parsed);

      // Convert webview URIs back to relative paths
      let convertedDoc = convertWebviewUrisToRelativePaths(doc);

      // Read export settings — merge doc-level settings over VS Code defaults
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      const vscodeDefaults: Partial<DocumentSettings> = {
        captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
        captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
        equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
        selfContained: config.get<'none' | 'images-only' | 'full'>('export.selfContained', 'images-only'),
        pdfScale: config.get<number>('export.pdfScale', 70),
        outputDir: config.get<string>('export.outputDir', ''),
        slideBreakLevel: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
        slideTransition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
        showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
      };
      const resolved = resolveSettings(meta.settings as Partial<DocumentSettings> | undefined, vscodeDefaults);
      const preset = getCaptionPreset(resolved.captionStyle);
      const exportSettings: Record<string, unknown> = {
        imageCaptionPrefix: preset.figurePrefix,
        tableCaptionPrefix: preset.tablePrefix,
        equationCaptionPrefix: preset.equationPrefix,
        captionSeparator: preset.separator,
        tableNumberStyle: preset.tableNumberStyle,
        equationParens: preset.equationParens,
        captionNumbering: resolved.captionNumbering,
        equationNumbering: resolved.equationNumbering,
        exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
      };

      // For HTML, PDF, and slides, apply selfContained settings
      const needsSelfContained = format === 'html' || format === 'pdf' || format === 'slides';
      if (needsSelfContained && resolved.selfContained !== 'none') {
        progress.report({ message: '이미지 처리 중...', increment: 20 });
        const documentDir = path.dirname(document.uri.fsPath);
        convertedDoc = await embedImagesAsBase64(convertedDoc, documentDir);
        exportSettings.selfContained = resolved.selfContained;
      }
      // PDF always embeds images regardless of setting
      if (format === 'pdf' && resolved.selfContained === 'none') {
        progress.report({ message: '이미지 처리 중...', increment: 20 });
        const documentDir = path.dirname(document.uri.fsPath);
        convertedDoc = await embedImagesAsBase64(convertedDoc, documentDir);
        exportSettings.selfContained = 'images-only';
      }

      let content: string;
      let ext: string;

      switch (format) {
        case 'html':
        case 'pdf': {
          progress.report({ message: 'HTML 변환 중...', increment: 30 });
          const companyLogo = await resolveCompanyLogo(
            config.get<string>('theme.companyLogo') || '',
            this.context.extensionPath,
          );
          const fontWeights = readFontWeights(config);
          const usedWeights = new Set(Object.values(fontWeights));
          const embeddedFonts = await loadBundledFontsAsBase64(this.context.extensionUri, usedWeights);
          const theme = buildHtmlTheme(config, companyLogo, fontWeights, embeddedFonts);
          const customStyles = await resolveCustomCss(
            resolved.htmlCssPath,
            this.getWorkspaceBasePath(document),
            config.get<string>('theme.customStyles') || '',
          );

          content = convertJsonToHtml(convertedDoc, { ...theme, customStyles }, exportSettings, meta);

          if (format === 'pdf') {
            // PDF: generate via headless browser
            const browserPath = detectBrowser();
            if (!browserPath) {
              const fallbackUri = await this.writeExportFile(
                document,
                '.html',
                content,
                resolved.outputDir,
                progress,
              );
              if (!fallbackUri) return null;
              const action = await vscode.window.showWarningMessage(
                `PDF 내보내기에 필요한 Chrome/Edge/Chromium을 찾지 못해 HTML로 대신 내보냈습니다: ${fallbackUri.fsPath}`,
                'Open HTML',
                'Reveal in Explorer',
                'Install Guide'
              );
              if (action === 'Open HTML') {
                await vscode.commands.executeCommand('vscode.open', fallbackUri);
              } else if (action === 'Reveal in Explorer') {
                await vscode.commands.executeCommand('revealFileInOS', fallbackUri);
              } else if (action === 'Install Guide') {
                await vscode.env.openExternal(vscode.Uri.parse('https://www.google.com/chrome/'));
              }
              return null;
            }

          // Inject zoom CSS for PDF scale
          const pdfScale = resolved.pdfScale / 100;
          content = content.replace('</head>', `<style>body{zoom:${pdfScale};}</style>\n</head>`);

          const tempHtmlPath = document.uri.fsPath.replace(/(\.tiptap\.json|\.sdoc)$/, '.tmp.html');
          const pdfUri = this.buildExportUri(document, '.pdf', resolved.outputDir);
          const shouldOverwritePdf = await this.confirmOverwrite(pdfUri);
          if (!shouldOverwritePdf) return null;
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(pdfUri.fsPath)));

          progress.report({ message: 'PDF 인쇄 중...', increment: 40 });
          const tempHtmlUri = vscode.Uri.file(tempHtmlPath);
          await vscode.workspace.fs.writeFile(tempHtmlUri, new TextEncoder().encode(content));
          try {
            await printToPdf(browserPath, tempHtmlPath, pdfUri.fsPath);
          } finally {
            try {
              await vscode.workspace.fs.delete(tempHtmlUri);
            } catch {
              // intentionally ignored: best-effort cleanup for transient export HTML
            }
          }

          return {
            successMsg: `PDF exported: ${pdfUri.fsPath}`,
            actionLabel: 'Open PDF',
              openUri: pdfUri,
              openKind: 'external',
            };
          }

          ext = '.html';
          break;
        }
        case 'slides': {
          progress.report({ message: '슬라이드 변환 중...', increment: 30 });
          const slideLogo = await resolveCompanyLogo(
            config.get<string>('theme.companyLogo') || '',
            this.context.extensionPath,
          );
          const slideFontWeights = readFontWeights(config);
          const usedSlideWeights = new Set(Object.values(slideFontWeights));
          const slideEmbeddedFonts = await loadBundledFontsAsBase64(this.context.extensionUri, usedSlideWeights);
          const slideTheme = {
            ...buildHtmlTheme(config, slideLogo, slideFontWeights, slideEmbeddedFonts),
            primaryColor: config.get<string>('slide.primaryColor') || config.get<string>('theme.primaryColor') || '#A50034',
            accentColor: config.get<string>('slide.accentColor') || config.get<string>('theme.accentColor') || '#6b6b6b',
            customStyles: await resolveCustomCss(
              resolved.slideCssPath,
              this.getWorkspaceBasePath(document),
              config.get<string>('theme.customStyles') || '',
            ),
          };

          const slideSettings = {
            ...exportSettings,
            slideBreak: resolved.slideBreakLevel,
            slideBreakLevel: resolved.slideBreakLevel,
            showTitleSlide: resolved.showTitleSlide,
            transition: resolved.slideTransition,
            slideTransition: resolved.slideTransition,
          };

          content = convertJsonToSlides(convertedDoc, slideTheme, slideSettings, meta);

          const slideUri = await this.writeExportFile(
            document,
            '.slides.html',
            content,
            resolved.outputDir,
            progress,
          );
          if (!slideUri) return null;

          return {
            successMsg: `Slides exported: ${slideUri.fsPath}`,
            actionLabel: 'Open in Browser',
            openUri: slideUri,
            openKind: 'external',
          };
        }
        case 'adoc':
          progress.report({ message: 'AsciiDoc 변환 중...', increment: 50 });
          content = convertJsonToAdoc(convertedDoc, exportSettings, meta);
          ext = '.adoc';
          break;
        case 'markdown':
          progress.report({ message: 'Markdown 변환 중...', increment: 50 });
          content = convertJsonToMarkdown(convertedDoc, exportSettings, meta);
          ext = '.md';
          break;
      }

      progress.report({ message: '파일 쓰는 중...', increment: 20 });
      const outputUri = await this.writeExportFile(
        document,
        ext,
        content,
        resolved.outputDir,
        progress,
      );
      if (!outputUri) return null;

      return {
        successMsg: `${label} exported: ${outputUri.fsPath}`,
        actionLabel: 'Open File',
        openUri: outputUri,
        openKind: format === 'html' ? 'html' : 'text',
      };
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to export: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }

  private getWorkspaceBasePath(document: vscode.TextDocument): string {
    return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath);
  }

  private buildExportUri(
    document: vscode.TextDocument,
    extension: string,
    outputDir: string,
  ): vscode.Uri {
    const baseName = path.basename(document.uri.fsPath).replace(/(\.tiptap\.json|\.sdoc)$/, '');
    const outputFileName = `${baseName}${extension}`;
    const trimmedOutputDir = outputDir.trim();
    if (!trimmedOutputDir) {
      return document.uri.with({ path: document.uri.path.replace(/(\.tiptap\.json|\.sdoc)$/, extension) });
    }

    const basePath = this.getWorkspaceBasePath(document);
    const resolvedOutputDir = path.isAbsolute(trimmedOutputDir)
      ? trimmedOutputDir
      : path.resolve(basePath, trimmedOutputDir);
    return vscode.Uri.file(path.join(resolvedOutputDir, outputFileName));
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

  private async writeExportFile(
    document: vscode.TextDocument,
    extension: string,
    content: string,
    outputDir: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<vscode.Uri | null> {
    const outputUri = this.buildExportUri(document, extension, outputDir);
    const shouldOverwrite = await this.confirmOverwrite(outputUri);
    if (!shouldOverwrite) {
      return null;
    }
    progress.report({ message: '파일 쓰는 중...', increment: 20 });
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(outputUri.fsPath)));
    await vscode.workspace.fs.writeFile(outputUri, new TextEncoder().encode(content));
    return outputUri;
  }

  /**
   * Unwrap an .sdoc file: supports both the new envelope format and legacy (bare doc).
   * Also migrates legacy attribute names (data-caption → caption, etc.).
   */
}
