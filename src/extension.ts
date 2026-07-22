import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { SdocEditorProvider } from './SdocEditorProvider';
import { SdocBookProvider } from './SdocBookProvider';
import type { ExportFormat } from './services/VsCodeExportService';
import {
  runNewSdocWorkflow,
  isFilesystemBackedScheme,
  validateDocumentTitle,
  VsCodeTemplateService,
  type NewSdocDiagnostic,
  type WorkspaceTemplateRoot,
} from './services/VsCodeTemplateService';

/** Show What's New (CHANGELOG) when extension is updated to a new version. */
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
      if (previousVersion) {
        const changelogUri = vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md');
        await vscode.commands.executeCommand('markdown.showPreview', changelogUri);
      }
    }
  } catch (error) {
    console.error('Failed to check version for What\'s New:', error);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  void showWhatsNewIfNeeded(context);

  context.subscriptions.push(SdocEditorProvider.register(context));
  context.subscriptions.push(SdocBookProvider.register(context));
  const templateOutputChannel = vscode.window.createOutputChannel('Structured Doc Templates');
  context.subscriptions.push(templateOutputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.newSdoc',
      () => createNewSdoc(templateOutputChannel),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToHtml',
      () => dispatchExport('html'),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToAdoc',
      () => dispatchExport('adoc'),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToMarkdown',
      () => dispatchExport('markdown'),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToPdf',
      () => dispatchExport('pdf'),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToSlides',
      () => dispatchExport('slides'),
    ),
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

const describeDiagnostic = (diagnostic: NewSdocDiagnostic): string =>
  `[${diagnostic.code}] ${diagnostic.targetPath}${'path' in diagnostic && diagnostic.path ? ` ${diagnostic.path}` : ''}: ${diagnostic.message}`;

async function createNewSdoc(outputChannel: vscode.OutputChannel): Promise<void> {
  const allWorkspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const workspaceRoots: WorkspaceTemplateRoot[] = allWorkspaceFolders
    .filter((folder) => isFilesystemBackedScheme(folder.uri.scheme))
    .map((folder) => ({
      identity: folder.uri.toString(),
      name: folder.name,
      rootPath: folder.uri.fsPath,
    }));
  const unsupportedWorkspaces = allWorkspaceFolders
    .filter((folder) => !isFilesystemBackedScheme(folder.uri.scheme));
  if (unsupportedWorkspaces.length > 0) {
    outputChannel.appendLine(
      `Workspace templates are unavailable for non-file workspaces: ${unsupportedWorkspaces.map((folder) => folder.name).join(', ')}`,
    );
  }

  const templateService = new VsCodeTemplateService();
  let selectedTargetUri: vscode.Uri | undefined;
  try {
    await runNewSdocWorkflow(templateService, workspaceRoots, {
      selectTemplate: async (templates) => {
        const selected = await vscode.window.showQuickPick(
          templates.map((template) => ({
            label: template.descriptor.name,
            description: template.descriptor.sourceLabel,
            detail: template.descriptor.description,
            template,
          })),
          {
            title: 'Create Structured Doc',
            placeHolder: 'Select a document template',
            matchOnDescription: true,
            matchOnDetail: true,
          },
        );
        return selected?.template;
      },
      requestTitle: async () => vscode.window.showInputBox({
        title: 'Create Structured Doc',
        prompt: 'Enter the document title',
        placeHolder: 'Document title',
        validateInput: validateDocumentTitle,
      }),
      selectTarget: async (defaultFileName) => {
        const defaultWorkspace = allWorkspaceFolders
          .find((folder) => isFilesystemBackedScheme(folder.uri.scheme));
        const defaultUri = defaultWorkspace
          ? vscode.Uri.joinPath(defaultWorkspace.uri, defaultFileName)
          : vscode.Uri.file(path.resolve(defaultFileName));
        const targetUri = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { 'Structured Doc': ['sdoc'] },
          saveLabel: 'Create .sdoc Document',
          title: 'Create .sdoc Document',
        });
        if (!targetUri) return undefined;
        if (!isFilesystemBackedScheme(targetUri.scheme)) {
          throw new Error('New documents require a filesystem-backed destination.');
        }
        selectedTargetUri = targetUri;
        return targetUri.fsPath;
      },
      flushActiveDocument: () => SdocEditorProvider.flushActiveDocument(),
      openDocument: async (targetPath) => {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          selectedTargetUri ?? vscode.Uri.file(targetPath),
          'structuredDocEditor.sdoc',
          { preview: false },
        );
      },
      reportDiagnostics: (diagnostics) => {
        outputChannel.appendLine(`Template discovery reported ${diagnostics.length} issue(s):`);
        diagnostics.forEach((diagnostic) => outputChannel.appendLine(describeDiagnostic(diagnostic)));
        void vscode.window.showWarningMessage(
          `${diagnostics.length} template(s) could not be loaded. See "Structured Doc Templates" output for details.`,
        );
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`Document creation failed: ${detail}`);
    await vscode.window.showErrorMessage(`Failed to create Structured Doc: ${detail}`);
  }
}

export function deactivate(): void {}
