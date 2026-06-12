import * as vscode from 'vscode';
import * as path from 'path';
import * as https from 'https';
import { convertJsonToHtml } from '../../shared/converter';
import { convertWebviewUrisToRelativePaths, embedImagesAsBase64 } from '../utils/imageUtils';
import { resolveCompanyLogo } from '../utils/themeUtils';
import { resolveCustomCss } from '../utils/cssUtils';
import type { DocumentSettings } from '../../shared/types';

export async function exportToHtml(context: vscode.ExtensionContext) {
  // Get the active tab's input
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

  if (!activeTab || !activeTab.input) {
    vscode.window.showErrorMessage('No active document found');
    return;
  }

  // Get the URI from the tab input
  let documentUri: vscode.Uri | undefined;

  if (activeTab.input instanceof vscode.TabInputCustom) {
    documentUri = activeTab.input.uri;
  } else if (activeTab.input instanceof vscode.TabInputText) {
    documentUri = activeTab.input.uri;
  }

  if (!documentUri) {
    vscode.window.showErrorMessage('Could not determine active document');
    return;
  }

  if (!documentUri.path.endsWith('.sdoc') && !documentUri.path.endsWith('.tiptap.json')) {
    vscode.window.showErrorMessage('This command only works with .sdoc or .tiptap.json files');
    return;
  }

  try {
    // Read the document
    const documentBytes = await vscode.workspace.fs.readFile(documentUri);
    const text = new TextDecoder().decode(documentBytes);

    // Parse JSON
    let parsed = JSON.parse(text);

    // Unwrap sdoc envelope if present
    const meta = (parsed.sdoc && parsed.meta) ? parsed.meta : undefined;
    let json = (parsed.sdoc && parsed.doc) ? parsed.doc : parsed;

    // Convert webview URIs back to relative paths for export
    json = convertWebviewUrisToRelativePaths(json);

    // Get theme configuration from VS Code settings
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const companyLogo = await resolveCompanyLogo(
      config.get<string>('theme.companyLogo') || '',
      context.extensionPath,
    );

    // Resolve custom HTML CSS: file path (meta.settings) takes priority over settings string
    const docSettings = meta?.settings as Partial<DocumentSettings> | undefined;
    const workspacePath = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath
      ?? path.dirname(documentUri.fsPath);
    const fallbackCustomCss = config.get<string>('theme.customStyles') || '';
    const resolvedHtmlCss = await resolveCustomCss(
      docSettings?.htmlCssPath,
      workspacePath,
      fallbackCustomCss,
    );

    const theme = {
      companyLogo,
      companyName: config.get<string>('theme.companyName') || '',
      primaryColor: config.get<string>('theme.primaryColor') || '#A50034',
      accentColor: config.get<string>('theme.accentColor') || '#6b6b6b',
      fontFamily: config.get<string>('theme.fontFamily') || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      customStyles: resolvedHtmlCss,
    };

    const exportSettings = {
      imageCaptionPrefix: config.get<string>('caption.imagePrefix', ''),
      tableCaptionPrefix: config.get<string>('caption.tablePrefix', ''),
      equationCaptionPrefix: config.get<string>('caption.equationPrefix', ''),
      captionSeparator: config.get<string>('caption.separator', ' '),
      captionImageSeparator: config.get<string>('caption.imageSeparator', ' '),
      captionTableSeparator: config.get<string>('caption.tableSeparator', ' '),
      captionEquationSeparator: config.get<string>('caption.equationSeparator', ''),
      captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
      equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
      exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
      selfContained: config.get<'none' | 'images-only' | 'full'>('export.selfContained', 'images-only'),
      embeddedAssets: undefined as any,
    };

    // Embed images as base64 when selfContained is enabled
    const documentDir = path.dirname(documentUri.fsPath);
    if (exportSettings.selfContained !== 'none') {
      json = await embedImagesAsBase64(json, documentDir);
    }

    // For full mode, fetch and embed CDN scripts inline
    if (exportSettings.selfContained === 'full') {
      try {
        exportSettings.embeddedAssets = await fetchCdnAssets(context);
      } catch {
        vscode.window.showWarningMessage(
          'Could not fetch CDN assets for full embedding. Falling back to CDN links.'
        );
      }
    }

    // Convert JSON to HTML directly
    const htmlContent = convertJsonToHtml(json, theme, exportSettings, meta);

    // Generate .html file in the same directory
    const htmlUri = documentUri.with({
      path: documentUri.path.replace(/(\.tiptap\.json|\.sdoc)$/, '.html'),
    });

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(
      htmlUri,
      encoder.encode(htmlContent)
    );

    // Show success message with option to open
    const action = await vscode.window.showInformationMessage(
      `HTML exported successfully: ${htmlUri.fsPath}`,
      'Open HTML',
      'Open in Browser'
    );

    if (action === 'Open HTML') {
      await vscode.commands.executeCommand('vscode.open', htmlUri);
    } else if (action === 'Open in Browser') {
      await vscode.env.openExternal(htmlUri);
    }

  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to export to HTML: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

const CDN_URLS = {
  katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
  katexJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
  autoRenderJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js',
  mermaidJs: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
};

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function fetchCdnAssets(context: vscode.ExtensionContext) {
  const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, 'cdn-cache');
  try { await vscode.workspace.fs.createDirectory(cacheDir); } catch { /* exists */ }

  async function getCached(key: string, url: string): Promise<string> {
    const cacheFile = vscode.Uri.joinPath(cacheDir, key);
    try {
      const cached = await vscode.workspace.fs.readFile(cacheFile);
      return new TextDecoder().decode(cached);
    } catch {
      const content = await fetchText(url);
      await vscode.workspace.fs.writeFile(cacheFile, new TextEncoder().encode(content));
      return content;
    }
  }

  const [katexCss, katexJs, autoRenderJs, mermaidJs] = await Promise.all([
    getCached('katex.min.css', CDN_URLS.katexCss),
    getCached('katex.min.js', CDN_URLS.katexJs),
    getCached('auto-render.min.js', CDN_URLS.autoRenderJs),
    getCached('mermaid.min.js', CDN_URLS.mermaidJs),
  ]);

  return { katexCss, katexJs, autoRenderJs, mermaidJs };
}
