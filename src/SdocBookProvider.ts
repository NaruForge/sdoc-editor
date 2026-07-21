import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { convertJsonToHtml } from '../shared/converter';
import { detectBrowser, printToPdf } from './utils/browserDetect';
import { loadBundledFontsAsBase64 } from './utils/fontUtils';
import { embedImagesAsBase64 } from './utils/imageUtils';
import { resolveCompanyLogo, readFontWeights, buildHtmlTheme, readExportSettings } from './utils/themeUtils';
import { withTemporaryDirectory } from './utils/temporaryDirectory';
import {
  BookDocumentLoadError,
  composeBook,
  diagnosticsForDocument,
  hasBookErrors,
  isBookWebviewMessage,
  normalizeBookDocumentPath,
  parseBook,
  type BookCompositionResult,
  type BookDiagnostic,
  type BookDocumentLoader,
  type ResolvedBookDocument,
  type SdocBook,
} from '../shared/book';

export class SdocBookProvider implements vscode.CustomTextEditorProvider {
  private static readonly VIEW_TYPE = 'structuredDocEditor.sdocBook';

  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      SdocBookProvider.VIEW_TYPE,
      new SdocBookProvider(context),
      { supportsMultipleEditorsPerDocument: false }
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };

    let updateSequence = 0;
    let disposed = false;
    const updateWebview = async (): Promise<void> => {
      const sequence = ++updateSequence;
      const result = await this.loadBook(document);
      if (disposed || sequence !== updateSequence) return;
      if (!result.book) {
        webviewPanel.webview.html = this.getErrorHtml(result.diagnostics[0]?.message ?? 'Invalid .sdocbook file');
        return;
      }
      const docs = result.composition?.documents ?? result.book.documents.map((entry) => ({
        path: entry.path,
        label: entry.label || path.basename(entry.path, '.sdoc'),
        status: 'invalid' as const,
      }));
      webviewPanel.webview.html = this.getHtml(
        webviewPanel.webview,
        result.book,
        docs,
        result.diagnostics,
      );
    };

    void updateWebview();

    const projectDir = path.dirname(document.uri.fsPath);
    const isProjectDocument = (candidate: vscode.TextDocument): boolean => {
      if (candidate.uri.toString() === document.uri.toString()) return true;
      if (candidate.uri.scheme !== 'file' || !candidate.uri.fsPath.toLowerCase().endsWith('.sdoc')) return false;
      const relative = path.relative(projectDir, candidate.uri.fsPath);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (isProjectDocument(event.document)) void updateWebview();
    });
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(projectDir), '**/*.sdoc'),
    );
    const watcherSubscriptions = [
      watcher.onDidCreate(() => void updateWebview()),
      watcher.onDidChange(() => void updateWebview()),
      watcher.onDidDelete(() => void updateWebview()),
    ];

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
      watcherSubscriptions.forEach((subscription) => subscription.dispose());
      watcher.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isBookWebviewMessage(message)) return;
      switch (message.type) {
        case 'openDocument': {
          const parsed = parseBook(document.getText());
          const target = parsed.book?.documents[message.index];
          if (!target) break;
          const targetPath = path.resolve(projectDir, target.path);
          const targetUri = vscode.Uri.file(targetPath);
          try {
            await vscode.commands.executeCommand('vscode.open', targetUri);
          } catch {
            vscode.window.showWarningMessage(`File not found: ${target.path}`);
          }
          break;
        }
        case 'addDocument': {
          const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: true,
            filters: { 'Sdoc Files': ['sdoc'] },
            defaultUri: vscode.Uri.file(path.dirname(document.uri.fsPath)),
          });
          if (files && files.length > 0) {
            const project = this.getEditableBook(document);
            if (!project) break;
            for (const f of files) {
              const rel = path.relative(projectDir, f.fsPath).replace(/\\/g, '/');
              const bookPath = normalizeBookDocumentPath(rel);
              if (!bookPath) {
                vscode.window.showWarningMessage(`Book documents must stay inside the book folder: ${f.fsPath}`);
                continue;
              }
              if (!project.documents.some(d => d.path === bookPath)) {
                project.documents.push({ path: bookPath });
              }
            }
            await this.updateProjectFile(document, project);
          }
          break;
        }
        case 'removeDocument': {
          const project = this.getEditableBook(document);
          if (!project) break;
          project.documents.splice(message.index, 1);
          await this.updateProjectFile(document, project);
          break;
        }
        case 'moveDocument': {
          const project = this.getEditableBook(document);
          if (!project) break;
          const { from, to } = message;
          if (from >= 0 && from < project.documents.length && to >= 0 && to < project.documents.length) {
            const [item] = project.documents.splice(from, 1);
            project.documents.splice(to, 0, item);
            await this.updateProjectFile(document, project);
          }
          break;
        }
        case 'updateMeta': {
          const project = this.getEditableBook(document);
          if (!project) break;
          project[message.key] = message.value;
          await this.updateProjectFile(document, project);
          break;
        }
        case 'exportProject': {
          await this.exportProject(document, message.format);
          break;
        }
        case 'refreshBook':
          await updateWebview();
          break;
      }
    });
  }

  private createDocumentLoader(bookDocument: vscode.TextDocument): BookDocumentLoader {
    const projectDir = path.dirname(bookDocument.uri.fsPath);
    return {
      load: async (bookPath: string): Promise<unknown> => {
        const requestedPath = path.resolve(projectDir, bookPath);
        let canonicalRoot: string;
        let canonicalTarget: string;
        try {
          [canonicalRoot, canonicalTarget] = await Promise.all([
            fs.promises.realpath(projectDir),
            fs.promises.realpath(requestedPath),
          ]);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') throw new BookDocumentLoadError('not-found', bookPath);
          throw new BookDocumentLoadError('read-failed', error instanceof Error ? error.message : String(error));
        }
        const relative = path.relative(canonicalRoot, canonicalTarget);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new BookDocumentLoadError('read-failed', `Document resolves outside the book root: ${bookPath}`);
        }
        const uri = vscode.Uri.file(canonicalTarget);
        const openDocument = vscode.workspace.textDocuments.find(
          (candidate) => candidate.uri.toString() === uri.toString(),
        );
        if (openDocument) return openDocument.getText();
        try {
          return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch (error) {
          if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            throw new BookDocumentLoadError('not-found', bookPath);
          }
          throw new BookDocumentLoadError(
            'read-failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    };
  }

  private async loadBook(document: vscode.TextDocument): Promise<{
    book?: SdocBook;
    composition?: BookCompositionResult;
    diagnostics: BookDiagnostic[];
  }> {
    const parsed = parseBook(document.getText());
    if (!parsed.book) return { diagnostics: parsed.diagnostics };
    const composition = await composeBook(
      parsed.book,
      this.createDocumentLoader(document),
      parsed.diagnostics,
    );
    return { book: parsed.book, composition, diagnostics: composition.diagnostics };
  }

  private async updateProjectFile(document: vscode.TextDocument, project: SdocBook): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      JSON.stringify(project, null, 2) + '\n'
    );
    await vscode.workspace.applyEdit(edit);
  }

  private getEditableBook(document: vscode.TextDocument): SdocBook | undefined {
    const parsed = parseBook(document.getText());
    const unsafeRewrite = parsed.diagnostics.find((diagnostic) =>
      diagnostic.code === 'BOOK_INVALID'
      || diagnostic.code === 'BOOK_VERSION_UNSUPPORTED'
      || diagnostic.code === 'BOOK_PROPERTY_UNSUPPORTED'
      || diagnostic.code === 'DOCUMENT_PATH_INVALID'
      || diagnostic.code === 'DOCUMENT_PATH_OUTSIDE_BOOK'
    );
    if (!parsed.book || unsafeRewrite) {
      vscode.window.showErrorMessage(
        `Fix the .sdocbook manifest before editing it in the visual editor.${unsafeRewrite ? ` ${unsafeRewrite.message}` : ''}`,
      );
      return undefined;
    }
    return parsed.book;
  }

  async exportProject(
    document: vscode.TextDocument,
    format: 'html' | 'pdf'
  ): Promise<void> {
    const result = await this.loadBook(document);
    if (!result.book || !result.composition || hasBookErrors(result.diagnostics)) {
      const errors = result.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .slice(0, 3)
        .map((diagnostic) => diagnostic.message)
        .join('\n');
      vscode.window.showErrorMessage(`Book export blocked until errors are fixed.${errors ? `\n${errors}` : ''}`);
      return;
    }
    const projectDir = path.dirname(document.uri.fsPath);
    const config = vscode.workspace.getConfiguration('structuredDocEditor');

    // Embed images
    const selfContained = config.get<string>('export.selfContained', 'images-only');
    let finalDoc = result.composition.doc;
    if (selfContained !== 'none') {
      finalDoc = await embedImagesAsBase64(finalDoc, projectDir);
    }

    // Build theme
    const companyLogo = await resolveCompanyLogo(
      config.get<string>('theme.companyLogo') || '',
      this.context.extensionPath,
    );
    const fontWeights = readFontWeights(config);
    const usedWeights = new Set(Object.values(fontWeights));
    const embeddedFonts = await loadBundledFontsAsBase64(this.context.extensionUri, usedWeights);
    const theme = buildHtmlTheme(config, companyLogo, fontWeights, embeddedFonts);

    const exportSettings: Record<string, unknown> = {
      ...readExportSettings(config),
      selfContained,
      counterResetPaths: result.composition.counterResetPaths,
    };

    let htmlContent = convertJsonToHtml(finalDoc, theme, exportSettings, result.composition.meta);

    if (format === 'pdf') {
      const browserPath = detectBrowser();
      if (!browserPath) {
        vscode.window.showErrorMessage('Chrome, Edge, or Chromium is required for PDF export.');
        return;
      }

      const pdfScale = config.get<number>('export.pdfScale', 70) / 100;
      htmlContent = htmlContent.replace('</head>', `<style>body{zoom:${pdfScale};}</style>\n</head>`);

      const pdfPath = document.uri.fsPath.replace(/\.sdocbook$/, '.pdf');
      await withTemporaryDirectory('sdocbook-pdf-', async (tempDir) => {
        const tempHtmlPath = path.join(tempDir, 'document.html');
        await fs.promises.writeFile(tempHtmlPath, htmlContent, 'utf-8');
        await printToPdf(browserPath, tempHtmlPath, pdfPath);
      });

      const action = await vscode.window.showInformationMessage(
        `Project PDF exported: ${pdfPath}`,
        'Open PDF'
      );
      if (action === 'Open PDF') {
        await vscode.env.openExternal(vscode.Uri.file(pdfPath));
      }
    } else {
      const htmlPath = document.uri.fsPath.replace(/\.sdocbook$/, '.html');
      await fs.promises.writeFile(htmlPath, htmlContent, 'utf-8');

      const action = await vscode.window.showInformationMessage(
        `Project HTML exported: ${htmlPath}`,
        'Open HTML'
      );
      if (action === 'Open HTML') {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(htmlPath));
      }
    }
  }

  private getHtml(
    webview: vscode.Webview,
    project: SdocBook,
    docs: ResolvedBookDocument[],
    diagnostics: BookDiagnostic[],
  ): string {
    const nonce = randomBytes(16).toString('base64');
    const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
    const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
    const exportDisabled = errorCount > 0 ? ' disabled' : '';
    const docRows = docs.map((d, i) => `
      <div class="doc-row ${d.status}">
        <span class="doc-num">${i + 1}</span>
        <button class="doc-label" data-open-index="${i}" title="${this.escHtml(d.path)}">${this.escHtml(d.label)}</button>
        <span class="doc-path">${this.escHtml(d.path)}</span>
        ${d.status === 'missing' ? '<span class="doc-status error">not found</span>' : ''}
        ${d.status === 'invalid' ? '<span class="doc-status error">invalid</span>' : ''}
        ${diagnosticsForDocument(diagnostics, d.path)
          .filter((item) => item.code !== 'DOCUMENT_MISSING' && item.code !== 'DOCUMENT_INVALID')
          .map((item) => `<span class="doc-status ${item.severity}" title="${this.escHtml(item.message)}">${this.escHtml(item.code)}</span>`)
          .join('')}
        <span class="doc-actions">
          ${i > 0 ? `<button data-move-from="${i}" data-move-to="${i - 1}" title="Move up">↑</button>` : ''}
          ${i < docs.length - 1 ? `<button data-move-from="${i}" data-move-to="${i + 1}" title="Move down">↓</button>` : ''}
          <button data-remove-index="${i}" title="Remove">✕</button>
        </span>
      </div>
    `).join('');

    const diagnosticRows = diagnostics.map((item) => `
      <li class="diagnostic ${item.severity}">
        <span class="diagnostic-code">${this.escHtml(item.code)}</span>
        <span>${this.escHtml(item.message)}</span>
      </li>
    `).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5em; margin-bottom: 8px; }
  .meta { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .meta label { font-size: 12px; color: var(--vscode-descriptionForeground); display: block; margin-bottom: 2px; }
  .meta input { padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); border-radius: 3px; font-size: 13px; width: 200px; }
  .meta input.version { width: 80px; }
  .toolbar { margin-bottom: 12px; display: flex; gap: 8px; }
  .toolbar button { padding: 6px 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 13px; }
  .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
  .toolbar button:disabled { cursor: not-allowed; opacity: 0.45; }
  .toolbar button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .doc-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
  .doc-row:hover { background: var(--vscode-list-hoverBackground); }
  .doc-row.missing, .doc-row.invalid { background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.08)); }
  .doc-num { width: 24px; text-align: right; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .doc-label { cursor: pointer; color: var(--vscode-textLink-foreground); flex: 1; border: 0; background: transparent; padding: 0; text-align: left; font: inherit; }
  .doc-label:hover { text-decoration: underline; }
  .doc-path { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .doc-status { border-radius: 10px; padding: 1px 6px; font-size: 10px; }
  .doc-status.error { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); }
  .doc-status.warning { color: var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); }
  .doc-actions button { background: none; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 4px; font-size: 14px; opacity: 0.6; }
  .doc-actions button:hover { opacity: 1; }
  .validation-summary { border: 1px solid var(--vscode-panel-border, #444); border-radius: 5px; padding: 10px 12px; margin-bottom: 14px; }
  .validation-summary.ok { border-color: var(--vscode-testing-iconPassed, #73c991); }
  .validation-title { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
  .validation-counts { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .diagnostics { margin: 8px 0 0; padding-left: 20px; font-size: 12px; }
  .diagnostic { margin: 4px 0; }
  .diagnostic.error { color: var(--vscode-errorForeground); }
  .diagnostic.warning { color: var(--vscode-editorWarning-foreground); }
  .diagnostic-code { font-family: var(--vscode-editor-font-family, monospace); margin-right: 8px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px; text-align: center; }
</style></head><body>
  <h1>📚 ${this.escHtml(project.title || 'Untitled Project')}</h1>
  <div class="meta">
    <div><label>Title</label><input data-meta-key="title" value="${this.escHtml(project.title || '')}"></div>
    <div><label>Author</label><input data-meta-key="author" value="${this.escHtml(project.author || '')}"></div>
    <div><label>Version</label><input class="version" data-meta-key="version" value="${this.escHtml(project.version || '')}"></div>
  </div>
  <div class="validation-summary${diagnostics.length === 0 ? ' ok' : ''}">
    <div class="validation-title">
      <span>${diagnostics.length === 0 ? 'Book is valid' : 'Book validation'}</span>
      <span class="validation-counts">${errorCount} errors · ${warningCount} warnings</span>
    </div>
    ${diagnosticRows ? `<ul class="diagnostics">${diagnosticRows}</ul>` : ''}
  </div>
  <div class="toolbar">
    <button data-action="add">+ Add Document</button>
    <button class="secondary" data-action="refresh">Validate Book</button>
    <button class="secondary" data-export="html"${exportDisabled}>Export HTML</button>
    <button class="secondary" data-export="pdf"${exportDisabled}>Export PDF</button>
  </div>
  <div class="doc-list">
    ${docs.length > 0 ? docRows : '<div class="empty">No documents added. Click "Add Document" to start.</div>'}
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.querySelector('[data-action="add"]').addEventListener('click', () => vscode.postMessage({ type: 'addDocument' }));
  document.querySelector('[data-action="refresh"]').addEventListener('click', () => vscode.postMessage({ type: 'refreshBook' }));
  document.querySelectorAll('[data-open-index]').forEach((element) => element.addEventListener('click', () => {
    vscode.postMessage({ type: 'openDocument', index: Number(element.dataset.openIndex) });
  }));
  document.querySelectorAll('[data-remove-index]').forEach((element) => element.addEventListener('click', () => {
    vscode.postMessage({ type: 'removeDocument', index: Number(element.dataset.removeIndex) });
  }));
  document.querySelectorAll('[data-move-from]').forEach((element) => element.addEventListener('click', () => {
    vscode.postMessage({ type: 'moveDocument', from: Number(element.dataset.moveFrom), to: Number(element.dataset.moveTo) });
  }));
  document.querySelectorAll('[data-meta-key]').forEach((element) => element.addEventListener('change', () => {
    vscode.postMessage({ type: 'updateMeta', key: element.dataset.metaKey, value: element.value });
  }));
  document.querySelectorAll('[data-export]').forEach((element) => element.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportProject', format: element.dataset.export });
  }));
</script>
</body></html>`;
  }

  private getErrorHtml(msg: string): string {
    return `<!DOCTYPE html><html><body><h2>Error</h2><p>${this.escHtml(msg)}</p></body></html>`;
  }

  private escHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
