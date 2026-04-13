import * as vscode from 'vscode';
import { convertJsonToAdoc } from '../../shared/converter';
import { convertWebviewUrisToRelativePaths } from '../utils/imageUtils';

export async function exportToAdoc(context: vscode.ExtensionContext) {
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

    // Get caption settings
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const exportSettings = {
      imageCaptionPrefix: config.get<string>('caption.imagePrefix', ''),
      tableCaptionPrefix: config.get<string>('caption.tablePrefix', ''),
      captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
      equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
    };

    // Convert to AsciiDoc
    const adocContent = convertJsonToAdoc(json, exportSettings, meta);

    // Generate .adoc file in the same directory
    const adocUri = documentUri.with({
      path: documentUri.path.replace(/(\.tiptap\.json|\.sdoc)$/, '.adoc'),
    });

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(
      adocUri,
      encoder.encode(adocContent)
    );

    // Show success message with option to open
    const action = await vscode.window.showInformationMessage(
      `AsciiDoc exported successfully: ${adocUri.fsPath}`,
      'Open File'
    );

    if (action === 'Open File') {
      // Open the generated .adoc file
      const doc = await vscode.workspace.openTextDocument(adocUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to export to AsciiDoc: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
