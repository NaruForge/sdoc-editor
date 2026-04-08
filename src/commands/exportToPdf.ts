import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { convertJsonToHtml } from '../../shared/converter';
import { detectBrowser, printToPdf } from '../utils/browserDetect';

export async function exportToPdf(context: vscode.ExtensionContext) {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

  if (!activeTab || !activeTab.input) {
    vscode.window.showErrorMessage('No active document found');
    return;
  }

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

  // Detect browser
  const browserPath = detectBrowser();
  if (!browserPath) {
    vscode.window.showErrorMessage(
      'Chrome, Edge, or Chromium is required for PDF export. Please install one of these browsers.'
    );
    return;
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Exporting to PDF...', cancellable: false },
      async () => {
        const documentBytes = await vscode.workspace.fs.readFile(documentUri!);
        const text = new TextDecoder().decode(documentBytes);
        let parsed = JSON.parse(text);

        const meta = (parsed.sdoc && parsed.meta) ? parsed.meta : undefined;
        let json = (parsed.sdoc && parsed.doc) ? parsed.doc : parsed;

        // Embed images as base64 for self-contained HTML
        json = await embedImagesForPdf(json, path.dirname(documentUri!.fsPath));

        // Get theme configuration
        const config = vscode.workspace.getConfiguration('structuredDocEditor');
        let companyLogo = config.get<string>('theme.companyLogo') || '';
        if (companyLogo && !companyLogo.startsWith('data:') && !companyLogo.startsWith('http')) {
          try {
            const logoPath = path.join(context.extensionPath, 'media', companyLogo);
            const logoUri = vscode.Uri.file(logoPath);
            const logoData = await vscode.workspace.fs.readFile(logoUri);
            const base64 = Buffer.from(logoData).toString('base64');
            const ext = path.extname(companyLogo).toLowerCase().replace('.', '');
            const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext || 'png'}`;
            companyLogo = `data:${mime};base64,${base64}`;
          } catch {
            companyLogo = '';
          }
        }

        const theme = {
          companyLogo,
          companyName: config.get<string>('theme.companyName') || '',
          primaryColor: config.get<string>('theme.primaryColor') || '#A50034',
          accentColor: config.get<string>('theme.accentColor') || '#6b6b6b',
          fontFamily: config.get<string>('theme.fontFamily') || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          customStyles: config.get<string>('theme.customStyles') || '',
        };

        const exportSettings = {
          imageCaptionPrefix: config.get<string>('caption.imagePrefix', 'Image'),
          tableCaptionPrefix: config.get<string>('caption.tablePrefix', 'Table'),
          captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
          selfContained: 'images-only' as const,
        };

        let htmlContent = convertJsonToHtml(json, theme, exportSettings, meta);

        // Inject zoom CSS for PDF scale
        const pdfScale = config.get<number>('export.pdfScale', 70) / 100;
        htmlContent = htmlContent.replace('</head>', `<style>body{zoom:${pdfScale};}</style>\n</head>`);

        // Write temp HTML file
        const tempHtmlPath = documentUri!.fsPath.replace(/(\.tiptap\.json|\.sdoc)$/, '.tmp.html');
        fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');

        // Generate PDF
        const pdfPath = documentUri!.fsPath.replace(/(\.tiptap\.json|\.sdoc)$/, '.pdf');
        try {
          await printToPdf(browserPath, tempHtmlPath, pdfPath);
        } finally {
          // Clean up temp HTML
          try { fs.unlinkSync(tempHtmlPath); } catch { /* ignore */ }
        }

        const pdfUri = vscode.Uri.file(pdfPath);
        const action = await vscode.window.showInformationMessage(
          `PDF exported successfully: ${pdfUri.fsPath}`,
          'Open PDF',
          'Reveal in Explorer'
        );

        if (action === 'Open PDF') {
          await vscode.env.openExternal(pdfUri);
        } else if (action === 'Reveal in Explorer') {
          await vscode.commands.executeCommand('revealFileInOS', pdfUri);
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to export to PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

async function embedImagesForPdf(node: any, documentDir: string): Promise<any> {
  if (!node || typeof node !== 'object') return node;

  const cloned = Array.isArray(node) ? [...node] : { ...node };

  if (cloned.type === 'image' && cloned.attrs?.src) {
    const src: string = cloned.attrs.src;
    if (!src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
      try {
        const imagePath = path.resolve(documentDir, src);
        const imageUri = vscode.Uri.file(imagePath);
        const imageData = await vscode.workspace.fs.readFile(imageUri);
        const base64 = Buffer.from(imageData).toString('base64');
        const ext = path.extname(src).toLowerCase().replace('.', '');
        const mime = getMimeType(ext);
        cloned.attrs = { ...cloned.attrs, src: `data:${mime};base64,${base64}` };
      } catch { /* keep original */ }
    }
    // Also convert webview URIs
    if (src.includes('vscode-webview') || src.includes('vscode-resource')) {
      const match = src.match(/images\/([^?#]+)/);
      if (match) {
        try {
          const imagePath = path.resolve(documentDir, 'images', match[1]);
          const imageUri = vscode.Uri.file(imagePath);
          const imageData = await vscode.workspace.fs.readFile(imageUri);
          const base64 = Buffer.from(imageData).toString('base64');
          const ext = path.extname(match[1]).toLowerCase().replace('.', '');
          const mime = getMimeType(ext);
          cloned.attrs = { ...cloned.attrs, src: `data:${mime};base64,${base64}` };
        } catch { /* keep original */ }
      }
    }
  }

  if (cloned.content && Array.isArray(cloned.content)) {
    cloned.content = await Promise.all(
      cloned.content.map((child: any) => embedImagesForPdf(child, documentDir))
    );
  }

  return cloned;
}
