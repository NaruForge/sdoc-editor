import * as vscode from 'vscode';
import { SdocEditorProvider } from './SdocEditorProvider';
import { exportToHtml } from './commands/exportToHtml';
import { exportToAdoc } from './commands/exportToAdoc';
import { exportToMarkdown } from './commands/exportToMarkdown';

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

  // Register export to AsciiDoc command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToAdoc',
      () => exportToAdoc(context)
    )
  );

  // Register export to Markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToMarkdown',
      () => exportToMarkdown(context)
    )
  );
}

export function deactivate() {}
