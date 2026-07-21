import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { SdocEditorProvider } from './SdocEditorProvider';
import { SdocBookProvider } from './SdocBookProvider';
import type { ExportFormat } from './services/VsCodeExportService';
import { createEmptySdoc } from '../shared/document/sdocUtils';

/**
 * Show What's New (CHANGELOG) when extension is updated to a new version
 */
async function showWhatsNewIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  try {
    const packageJsonPath = path.join(context.extensionPath, 'package.json');
    const packageJson: unknown = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    if (!packageJson || typeof packageJson !== 'object' || !('version' in packageJson)
      || typeof packageJson.version !== 'string') return;
    const currentVersion = packageJson.version;
    const previousVersion = context.globalState.get<string>('sdocEditor.version');

    if (previousVersion !== currentVersion) {
      await context.globalState.update('sdocEditor.version', currentVersion);

      // Show CHANGELOG only on update (not first install)
      if (previousVersion) {
        const changelogUri = vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md');
        await vscode.commands.executeCommand('markdown.showPreview', changelogUri);
      }
    }
  } catch (error) {
    // Fail silently to not interrupt extension activation
    console.error('Failed to check version for What\'s New:', error);
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Show What's New on version update
  showWhatsNewIfNeeded(context);

  // Register the custom editor providers
  context.subscriptions.push(SdocEditorProvider.register(context));
  context.subscriptions.push(SdocBookProvider.register(context));

  // Register export to HTML command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.newSdoc',
      () => createNewSdoc()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToHtml',
      () => dispatchExport('html')
    )
  );

  // Register export to AsciiDoc command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToAdoc',
      () => dispatchExport('adoc')
    )
  );

  // Register export to Markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToMarkdown',
      () => dispatchExport('markdown')
    )
  );

  // Register export to PDF command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToPdf',
      () => dispatchExport('pdf')
    )
  );

  // Register export to Slides command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToSlides',
      () => dispatchExport('slides')
    )
  );

}

async function dispatchExport(format: ExportFormat): Promise<void> {
  try {
    await SdocEditorProvider.exportActiveDocument(format);
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Failed to export: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function createNewSdoc(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const defaultUri = workspaceFolder
    ? vscode.Uri.joinPath(workspaceFolder.uri, 'Untitled.sdoc')
    : vscode.Uri.file('Untitled.sdoc');

  const targetUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'Structured Doc': ['sdoc'] },
    saveLabel: 'Create .sdoc Document',
    title: '새 .sdoc 문서 만들기',
  });

  if (!targetUri) return;

  const envelope = createEmptySdoc({ title: '' });
  await vscode.workspace.fs.writeFile(
    targetUri,
    new TextEncoder().encode(JSON.stringify(envelope, null, 2) + '\n')
  );
  await vscode.commands.executeCommand(
    'vscode.openWith',
    targetUri,
    'structuredDocEditor.sdoc',
    { preview: false }
  );
}

export function deactivate() {}
