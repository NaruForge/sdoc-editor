import * as vscode from 'vscode';
import { convertJsonToAdoc } from '../converter/jsonToAdoc';

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
    let json = JSON.parse(text);

    // Convert webview URIs back to relative paths for export
    json = convertWebviewUrisToRelativePaths(json);

    // Convert to AsciiDoc
    const adocContent = convertJsonToAdoc(json);

    // Lazy load Asciidoctor to avoid activation issues
    let htmlContent: string;
    try {
      const Asciidoctor = require('asciidoctor');
      const asciidoctor = Asciidoctor();
      
      // Convert AsciiDoc to HTML using Asciidoctor
      htmlContent = asciidoctor.convert(adocContent, {
        safe: 'safe',
        standalone: true,
        attributes: {
          'sectnums': '',
          'sectnumlevels': 4,
          'stylesheet': 'default',
          'linkcss': false, // Embed CSS in HTML
          'imagesdir': './images', // Relative path to images
        }
      });
    } catch (asciidoctorError) {
      // If Asciidoctor fails, just save the AsciiDoc content as HTML
      vscode.window.showWarningMessage(
        `Asciidoctor conversion failed: ${asciidoctorError instanceof Error ? asciidoctorError.message : 'Unknown error'}. Saving raw AsciiDoc instead.`
      );
      htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AsciiDoc Content</title>
  <style>
    body { font-family: monospace; white-space: pre-wrap; padding: 20px; }
  </style>
</head>
<body>${adocContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body>
</html>`;
    }

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
