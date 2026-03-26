import * as vscode from 'vscode';
import { convertJsonToAdoc } from '../converter/jsonToAdoc';

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

  // Check if it's a .sdoc file
  if (!documentUri.path.endsWith('.sdoc')) {
    vscode.window.showErrorMessage('This command only works with .sdoc files');
    return;
  }

  try {
    // Read the document
    const documentBytes = await vscode.workspace.fs.readFile(documentUri);
    const text = new TextDecoder().decode(documentBytes);
    
    // Parse JSON
    let parsed = JSON.parse(text);

    // Unwrap sdoc envelope if present
    let json = (parsed.sdoc && parsed.doc) ? parsed.doc : parsed;

    // Convert webview URIs back to relative paths for export
    json = convertWebviewUrisToRelativePaths(json);

    // Get caption settings
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const exportSettings = {
      imageCaptionPrefix: config.get<string>('caption.imagePrefix', 'Image'),
      tableCaptionPrefix: config.get<string>('caption.tablePrefix', 'Table'),
      captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
    };

    // Convert to AsciiDoc
    const adocContent = convertJsonToAdoc(json, exportSettings);

    // Generate .adoc file in the same directory
    const adocUri = documentUri.with({
      path: documentUri.path.replace(/\.sdoc$/, '.adoc'),
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

// Helper function to convert webview URIs back to relative paths
function convertWebviewUrisToRelativePaths(node: any): any {
  if (!node || typeof node !== 'object') {
    return node;
  }

  // Clone to avoid mutating original
  const cloned = Array.isArray(node) ? [...node] : { ...node };

  // If this is an image node with a webview URI, convert it to relative path
  if (cloned.type === 'image' && cloned.attrs?.src) {
    const src = cloned.attrs.src;
    // Check if it's a webview URI (contains vscode-webview-resource or similar)
    if (src.includes('vscode-webview') || src.includes('vscode-resource')) {
      // Extract the filename from the URI
      const match = src.match(/images\/([^?#]+)/);
      if (match) {
        const fileName = match[1];
        cloned.attrs = {
          ...cloned.attrs,
          src: `./images/${fileName}`,
        };
      }
    }
  }

  // Recursively process content
  if (cloned.content && Array.isArray(cloned.content)) {
    cloned.content = cloned.content.map((child: any) =>
      convertWebviewUrisToRelativePaths(child)
    );
  }

  return cloned;
}
