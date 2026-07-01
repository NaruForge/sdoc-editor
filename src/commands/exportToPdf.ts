import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { convertJsonToHtml } from '../../shared/converter';
import { detectBrowser, printToPdf } from '../utils/browserDetect';
import { convertWebviewUrisToRelativePaths, embedImagesAsBase64 } from '../utils/imageUtils';
import { resolveCompanyLogo } from '../utils/themeUtils';

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
    const action = await vscode.window.showErrorMessage(
      'Chrome, Edge, or Chromium is required for PDF export. Please install one of these browsers.',
      'Install Guide'
    );
    if (action === 'Install Guide') {
      await vscode.env.openExternal(vscode.Uri.parse('https://www.google.com/chrome/'));
    }
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
        json = convertWebviewUrisToRelativePaths(json);
        json = await embedImagesAsBase64(json, path.dirname(documentUri!.fsPath));

        // Get theme configuration
        const config = vscode.workspace.getConfiguration('structuredDocEditor');
        const companyLogo = await resolveCompanyLogo(
          config.get<string>('theme.companyLogo') || '',
          context.extensionPath,
        );

        const theme = {
          companyLogo,
          companyName: config.get<string>('theme.companyName') || '',
          primaryColor: config.get<string>('theme.primaryColor') || '#A50034',
          accentColor: config.get<string>('theme.accentColor') || '#6b6b6b',
          fontFamily: config.get<string>('theme.fontFamily') || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          customStyles: config.get<string>('theme.customStyles') || '',
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
