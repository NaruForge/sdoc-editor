import * as vscode from 'vscode';
import * as path from 'path';
import { convertJsonToSlides } from '../../shared/converter';
import { convertWebviewUrisToRelativePaths, embedImagesAsBase64 } from '../utils/imageUtils';
import { resolveCompanyLogo, readFontWeights, buildHtmlTheme, readExportSettings } from '../utils/themeUtils';
import { loadBundledFontsAsBase64 } from '../utils/fontUtils';

export async function exportToSlides(context: vscode.ExtensionContext) {
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

  try {
    const documentBytes = await vscode.workspace.fs.readFile(documentUri);
    const text = new TextDecoder().decode(documentBytes);
    let parsed = JSON.parse(text);

    const meta = (parsed.sdoc && parsed.meta) ? parsed.meta : undefined;
    let json = (parsed.sdoc && parsed.doc) ? parsed.doc : parsed;

    // Convert webview URIs back to relative paths
    json = convertWebviewUrisToRelativePaths(json);

    // Embed images as base64
    const documentDir = path.dirname(documentUri.fsPath);
    json = await embedImagesAsBase64(json, documentDir);

    // Get settings
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const companyLogo = await resolveCompanyLogo(
      config.get<string>('theme.companyLogo') || '',
      context.extensionPath,
    );
    const fontWeights = readFontWeights(config);
    const usedWeights = new Set(Object.values(fontWeights));
    const embeddedFonts = await loadBundledFontsAsBase64(context.extensionUri, usedWeights);
    const theme = {
      ...buildHtmlTheme(config, companyLogo, fontWeights, embeddedFonts),
      primaryColor: config.get<string>('slide.primaryColor') || config.get<string>('theme.primaryColor') || '#A50034',
      accentColor: config.get<string>('slide.accentColor') || config.get<string>('theme.accentColor') || '#6b6b6b',
    };

    const slideSettings = {
      ...readExportSettings(config),
      slideBreak: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
      showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
      transition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
    };

    const htmlContent = convertJsonToSlides(json, theme, slideSettings, meta);

    const slideUri = documentUri.with({
      path: documentUri.path.replace(/(\.tiptap\.json|\.sdoc)$/, '.slides.html'),
    });

    await vscode.workspace.fs.writeFile(slideUri, new TextEncoder().encode(htmlContent));

    const action = await vscode.window.showInformationMessage(
      `Slides exported: ${slideUri.fsPath}`,
      'Open in Browser'
    );

    if (action === 'Open in Browser') {
      await vscode.env.openExternal(slideUri);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to export slides: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
