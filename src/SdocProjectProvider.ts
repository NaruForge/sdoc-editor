import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { convertJsonToHtml } from './converter/jsonToHtml';
import { detectBrowser, printToPdf } from './utils/browserDetect';

interface SdocProject {
  sdocProject: string;
  title?: string;
  author?: string;
  version?: string;
  documents: Array<{ path: string; label?: string }>;
}

export class SdocProjectProvider implements vscode.CustomTextEditorProvider {
  private static readonly VIEW_TYPE = 'structuredDocEditor.sdocProject';

  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      SdocProjectProvider.VIEW_TYPE,
      new SdocProjectProvider(context),
      { supportsMultipleEditorsPerDocument: false }
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };

    const updateWebview = () => {
      try {
        const text = document.getText();
        const project: SdocProject = text.trim() ? JSON.parse(text) : {
          sdocProject: '1.0',
          title: '',
          documents: [],
        };
        const projectDir = path.dirname(document.uri.fsPath);

        // Check which files exist
        const docs = project.documents.map(d => ({
          ...d,
          exists: fs.existsSync(path.resolve(projectDir, d.path)),
          label: d.label || path.basename(d.path, '.sdoc'),
        }));

        webviewPanel.webview.html = this.getHtml(project, docs);
      } catch {
        webviewPanel.webview.html = this.getErrorHtml('Invalid JSON in .sdoc-project file');
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => changeSubscription.dispose());

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'openDocument': {
          const projectDir = path.dirname(document.uri.fsPath);
          const targetPath = path.resolve(projectDir, message.path);
          const targetUri = vscode.Uri.file(targetPath);
          try {
            await vscode.commands.executeCommand('vscode.open', targetUri);
          } catch {
            vscode.window.showWarningMessage(`File not found: ${message.path}`);
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
            const projectDir = path.dirname(document.uri.fsPath);
            const text = document.getText();
            const project: SdocProject = text.trim() ? JSON.parse(text) : { sdocProject: '1.0', documents: [] };
            for (const f of files) {
              const rel = path.relative(projectDir, f.fsPath).replace(/\\/g, '/');
              const relPath = rel.startsWith('.') ? rel : `./${rel}`;
              if (!project.documents.some(d => d.path === relPath)) {
                project.documents.push({ path: relPath });
              }
            }
            await this.updateProjectFile(document, project);
          }
          break;
        }
        case 'removeDocument': {
          const text = document.getText();
          const project: SdocProject = JSON.parse(text);
          project.documents.splice(message.index, 1);
          await this.updateProjectFile(document, project);
          break;
        }
        case 'moveDocument': {
          const text = document.getText();
          const project: SdocProject = JSON.parse(text);
          const { from, to } = message;
          if (from >= 0 && from < project.documents.length && to >= 0 && to < project.documents.length) {
            const [item] = project.documents.splice(from, 1);
            project.documents.splice(to, 0, item);
            await this.updateProjectFile(document, project);
          }
          break;
        }
        case 'updateMeta': {
          const text = document.getText();
          const project: SdocProject = JSON.parse(text);
          if (message.title !== undefined) project.title = message.title;
          if (message.author !== undefined) project.author = message.author;
          if (message.version !== undefined) project.version = message.version;
          await this.updateProjectFile(document, project);
          break;
        }
        case 'exportProject': {
          await this.exportProject(document, message.format);
          break;
        }
      }
    });
  }

  private async updateProjectFile(document: vscode.TextDocument, project: SdocProject): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      JSON.stringify(project, null, 2) + '\n'
    );
    await vscode.workspace.applyEdit(edit);
  }

  async exportProject(
    document: vscode.TextDocument,
    format: 'html' | 'pdf'
  ): Promise<void> {
    const text = document.getText();
    const project: SdocProject = JSON.parse(text);
    const projectDir = path.dirname(document.uri.fsPath);
    const config = vscode.workspace.getConfiguration('structuredDocEditor');

    // Collect all document paths for cross-doc link resolution
    const docPaths = new Set(project.documents.map(d => d.path));

    // Merge all documents into one doc tree
    const mergedContent: any[] = [];
    for (const entry of project.documents) {
      const filePath = path.resolve(projectDir, entry.path);
      const docDir = path.dirname(filePath);
      try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const doc = (parsed.sdoc && parsed.doc) ? parsed.doc : parsed;
        if (doc.content) {
          // Rebase image paths relative to the project directory
          const rebased = doc.content.map((node: any) =>
            this.rebaseImagePaths(node, docDir, projectDir)
          );
          mergedContent.push(...rebased);
        }
      } catch (err) {
        vscode.window.showWarningMessage(`Skipped ${entry.path}: ${(err as Error).message}`);
      }
    }

    let mergedDoc: any = { type: 'doc', content: mergedContent };

    // Resolve cross-doc links: ./file.sdoc#id → #id (since all content is merged)
    mergedDoc = this.resolveCrossDocLinks(mergedDoc, docPaths);

    // Embed images
    const selfContained = config.get<string>('export.selfContained', 'images-only');
    let finalDoc = mergedDoc;
    if (selfContained !== 'none') {
      finalDoc = await this.embedImages(mergedDoc, projectDir);
    }

    // Build theme
    let companyLogo = config.get<string>('theme.companyLogo') || '';
    if (companyLogo && !companyLogo.startsWith('data:') && !companyLogo.startsWith('http')) {
      try {
        const logoPath = path.join(this.context.extensionPath, 'media', companyLogo);
        const logoData = await fs.promises.readFile(logoPath);
        const base64 = logoData.toString('base64');
        const ext = path.extname(companyLogo).toLowerCase().replace('.', '');
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext || 'png'}`;
        companyLogo = `data:${mime};base64,${base64}`;
      } catch { companyLogo = ''; }
    }

    const theme = {
      companyLogo,
      companyName: config.get<string>('theme.companyName') || '',
      primaryColor: config.get<string>('theme.primaryColor') || '#A50034',
      accentColor: config.get<string>('theme.accentColor') || '#6b6b6b',
      fontFamily: config.get<string>('theme.fontFamily') || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      customStyles: config.get<string>('theme.customStyles') || '',
    };

    const exportSettings: Record<string, any> = {
      imageCaptionPrefix: config.get<string>('caption.imagePrefix', 'Image'),
      tableCaptionPrefix: config.get<string>('caption.tablePrefix', 'Table'),
      captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
      selfContained: selfContained,
    };

    const meta = {
      title: project.title,
      author: project.author,
      version: project.version,
    };

    let htmlContent = convertJsonToHtml(finalDoc, theme, exportSettings, meta);

    if (format === 'pdf') {
      const browserPath = detectBrowser();
      if (!browserPath) {
        vscode.window.showErrorMessage('Chrome, Edge, or Chromium is required for PDF export.');
        return;
      }

      const pdfScale = config.get<number>('export.pdfScale', 70) / 100;
      htmlContent = htmlContent.replace('</head>', `<style>body{zoom:${pdfScale};}</style>\n</head>`);

      const pdfPath = document.uri.fsPath.replace(/\.sdoc-project$/, '.pdf');
      const tempHtmlPath = document.uri.fsPath.replace(/\.sdoc-project$/, '.tmp.html');

      fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');
      try {
        await printToPdf(browserPath, tempHtmlPath, pdfPath);
      } finally {
        try { fs.unlinkSync(tempHtmlPath); } catch { /* ignore */ }
      }

      const action = await vscode.window.showInformationMessage(
        `Project PDF exported: ${pdfPath}`,
        'Open PDF'
      );
      if (action === 'Open PDF') {
        await vscode.env.openExternal(vscode.Uri.file(pdfPath));
      }
    } else {
      const htmlPath = document.uri.fsPath.replace(/\.sdoc-project$/, '.html');
      fs.writeFileSync(htmlPath, htmlContent, 'utf-8');

      const action = await vscode.window.showInformationMessage(
        `Project HTML exported: ${htmlPath}`,
        'Open HTML'
      );
      if (action === 'Open HTML') {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(htmlPath));
      }
    }
  }

  private static readonly MIME_MAP: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };

  private async embedImages(node: any, baseDir: string): Promise<any> {
    if (!node || typeof node !== 'object') return node;
    const cloned = Array.isArray(node) ? [...node] : { ...node };

    if (cloned.type === 'image' && cloned.attrs?.src) {
      const src: string = cloned.attrs.src;
      if (!src.startsWith('data:') && !src.startsWith('http')) {
        try {
          const imgPath = path.resolve(baseDir, src);
          const data = await fs.promises.readFile(imgPath);
          const ext = path.extname(src).toLowerCase().replace('.', '');
          const mime = SdocProjectProvider.MIME_MAP[ext] || 'application/octet-stream';
          cloned.attrs = { ...cloned.attrs, src: `data:${mime};base64,${data.toString('base64')}` };
        } catch { /* keep original */ }
      }
    }

    if (cloned.content && Array.isArray(cloned.content)) {
      cloned.content = await Promise.all(
        cloned.content.map((child: any) => this.embedImages(child, baseDir))
      );
    }
    return cloned;
  }

  /** Rebase image src paths from document-relative to project-relative */
  private rebaseImagePaths(node: any, docDir: string, projectDir: string): any {
    if (!node || typeof node !== 'object') return node;
    const cloned = Array.isArray(node) ? [...node] : { ...node };

    if (cloned.type === 'image' && cloned.attrs?.src) {
      const src: string = cloned.attrs.src;
      if (!src.startsWith('data:') && !src.startsWith('http')) {
        const absPath = path.resolve(docDir, src);
        const rebasedPath = path.relative(projectDir, absPath).replace(/\\/g, '/');
        cloned.attrs = { ...cloned.attrs, src: rebasedPath };
      }
    }

    if (cloned.content && Array.isArray(cloned.content)) {
      cloned.content = cloned.content.map((child: any) =>
        this.rebaseImagePaths(child, docDir, projectDir)
      );
    }
    return cloned;
  }

  /** Resolve cross-doc links: ./file.sdoc#id → #id for merged output */
  private resolveCrossDocLinks(node: any, docPaths: Set<string>): any {
    if (!node || typeof node !== 'object') return node;
    const cloned = Array.isArray(node) ? [...node] : { ...node };

    if (cloned.marks && Array.isArray(cloned.marks)) {
      cloned.marks = cloned.marks.map((mark: any) => {
        if (mark.type === 'link' && mark.attrs?.href) {
          const href: string = mark.attrs.href;
          // Match ./file.sdoc#anchor or ./file.sdoc
          const match = href.match(/^\.\/([^#]+\.sdoc)(#.+)?$/);
          if (match) {
            const filePart = `./${match[1]}`;
            if (docPaths.has(filePart)) {
              // This doc is in the project — resolve to just anchor
              return {
                ...mark,
                attrs: { ...mark.attrs, href: match[2] || '' },
              };
            }
          }
        }
        return mark;
      });
    }

    if (cloned.content && Array.isArray(cloned.content)) {
      cloned.content = cloned.content.map((child: any) =>
        this.resolveCrossDocLinks(child, docPaths)
      );
    }
    return cloned;
  }

  private getHtml(project: SdocProject, docs: Array<{ path: string; label: string; exists: boolean }>): string {
    const docRows = docs.map((d, i) => `
      <div class="doc-row${d.exists ? '' : ' missing'}">
        <span class="doc-num">${i + 1}</span>
        <span class="doc-label" onclick="openDoc('${this.escHtml(d.path)}')" title="${this.escHtml(d.path)}">${this.escHtml(d.label)}</span>
        <span class="doc-path">${this.escHtml(d.path)}</span>
        ${!d.exists ? '<span class="doc-missing">⚠ not found</span>' : ''}
        <span class="doc-actions">
          ${i > 0 ? `<button onclick="move(${i}, ${i - 1})" title="Move up">↑</button>` : ''}
          ${i < docs.length - 1 ? `<button onclick="move(${i}, ${i + 1})" title="Move down">↓</button>` : ''}
          <button onclick="remove(${i})" title="Remove">✕</button>
        </span>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5em; margin-bottom: 8px; }
  .meta { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .meta label { font-size: 12px; color: var(--vscode-descriptionForeground); display: block; margin-bottom: 2px; }
  .meta input { padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); border-radius: 3px; font-size: 13px; width: 200px; }
  .toolbar { margin-bottom: 12px; display: flex; gap: 8px; }
  .toolbar button { padding: 6px 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 13px; }
  .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
  .toolbar button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .doc-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
  .doc-row:hover { background: var(--vscode-list-hoverBackground); }
  .doc-row.missing { opacity: 0.6; }
  .doc-num { width: 24px; text-align: right; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .doc-label { cursor: pointer; color: var(--vscode-textLink-foreground); flex: 1; }
  .doc-label:hover { text-decoration: underline; }
  .doc-path { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .doc-missing { color: var(--vscode-errorForeground); font-size: 12px; }
  .doc-actions button { background: none; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 4px; font-size: 14px; opacity: 0.6; }
  .doc-actions button:hover { opacity: 1; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px; text-align: center; }
</style></head><body>
  <h1>📚 ${this.escHtml(project.title || 'Untitled Project')}</h1>
  <div class="meta">
    <div><label>Title</label><input value="${this.escHtml(project.title || '')}" onchange="updateMeta('title', this.value)"></div>
    <div><label>Author</label><input value="${this.escHtml(project.author || '')}" onchange="updateMeta('author', this.value)"></div>
    <div><label>Version</label><input value="${this.escHtml(project.version || '')}" onchange="updateMeta('version', this.value)" style="width:80px;"></div>
  </div>
  <div class="toolbar">
    <button onclick="addDoc()">+ Add Document</button>
    <button class="secondary" onclick="exportProject('html')">Export HTML</button>
    <button class="secondary" onclick="exportProject('pdf')">Export PDF</button>
  </div>
  <div class="doc-list">
    ${docs.length > 0 ? docRows : '<div class="empty">No documents added. Click "Add Document" to start.</div>'}
  </div>
<script>
  const vscode = acquireVsCodeApi();
  function openDoc(p) { vscode.postMessage({ type: 'openDocument', path: p }); }
  function addDoc() { vscode.postMessage({ type: 'addDocument' }); }
  function remove(i) { vscode.postMessage({ type: 'removeDocument', index: i }); }
  function move(from, to) { vscode.postMessage({ type: 'moveDocument', from, to }); }
  function updateMeta(key, val) { vscode.postMessage({ type: 'updateMeta', [key]: val }); }
  function exportProject(fmt) { vscode.postMessage({ type: 'exportProject', format: fmt }); }
</script>
</body></html>`;
  }

  private getErrorHtml(msg: string): string {
    return `<!DOCTYPE html><html><body><h2>Error</h2><p>${msg}</p></body></html>`;
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
