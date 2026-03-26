import * as vscode from 'vscode';
import { convertJsonToHtml } from '../converter/jsonToHtml';

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

    // Get theme configuration from VS Code settings
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const theme = {
      companyLogo: config.get<string>('theme.companyLogo'),
      companyName: config.get<string>('theme.companyName') || '',
      primaryColor: config.get<string>('theme.primaryColor') || '#2563eb',
      accentColor: config.get<string>('theme.accentColor') || '#1e40af',
      fontFamily: config.get<string>('theme.fontFamily') || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      customStyles: config.get<string>('theme.customStyles') || '',
    };

    const exportSettings = {
      imageCaptionPrefix: config.get<string>('caption.imagePrefix', 'Image'),
      tableCaptionPrefix: config.get<string>('caption.tablePrefix', 'Table'),
      captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
      exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
    };

    // Convert JSON to HTML directly
    const htmlContent = convertJsonToHtml(json, theme, exportSettings);

    // Generate .html file in the same directory
    const htmlUri = documentUri.with({
      path: documentUri.path.replace(/\.sdoc$/, '.html'),
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

// Convert webview URIs back to relative paths for export
function convertWebviewUrisToRelativePaths(node: any): any {
  if (!node || typeof node !== 'object') {
    return node;
  }

  // Clone to avoid mutating original
  const cloned = Array.isArray(node) ? [...node] : { ...node };

  // If this is an image node with a webview URI, convert it to relative path
  if (cloned.type === 'image' && cloned.attrs?.src) {
    const src = cloned.attrs.src;
    // Check if it's a webview URI
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
