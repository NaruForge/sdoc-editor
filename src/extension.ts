import * as vscode from 'vscode';
import { SdocEditorProvider } from './SdocEditorProvider';
import { exportToHtml } from './commands/exportToHtml';

export function activate(context: vscode.ExtensionContext) {
  console.log('Structured Doc Editor extension is now active');

  // Register the custom editor provider
  context.subscriptions.push(SdocEditorProvider.register(context));

  // Register export to HTML command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToHtml',
      () => exportToHtml(context)
    )
  );
}

export function deactivate() {}
