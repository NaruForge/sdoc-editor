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
import {
  cleanUpLegacySettings,
  formatLegacySettingsPreview,
  type LegacySettingsScope,
} from './legacySettingsCleanup';

const VIEW_CHANGELOG_ACTION = 'View Changelog';

/** Offer What's New without taking focus from the document that activated the extension. */
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
        const selected = await vscode.window.showInformationMessage(
          `Structured Doc Editor was updated to v${currentVersion}.`,
          VIEW_CHANGELOG_ACTION,
        );
        if (selected === VIEW_CHANGELOG_ACTION) {
          const changelogUri = vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md');
          await vscode.commands.executeCommand('markdown.showPreview', changelogUri);
        }
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
  if (process.env.SDOC_VSCODE_UI_TEST === '1') {
    context.subscriptions.push(vscode.commands.registerCommand(
      'structuredDocEditor.test.waitForEditorUiReady',
      () => SdocEditorProvider.waitForActiveEditorUiReady(),
    ));
  }
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
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.cleanUpLegacySettings',
      () => runLegacySettingsCleanup(),
    ),
  );
}

function getLegacySettingsScopes(): LegacySettingsScope[] {
  const configuration = vscode.workspace.getConfiguration();
  const scopes: LegacySettingsScope[] = [
    {
      id: 'user',
      kind: 'user',
      label: 'User',
      read: (key) => configuration.inspect<unknown>(key)?.globalValue,
      remove: async (key) => configuration.update(
        key,
        undefined,
        vscode.ConfigurationTarget.Global,
      ),
    },
    {
      id: 'workspace',
      kind: 'workspace',
      label: 'Workspace',
      read: (key) => configuration.inspect<unknown>(key)?.workspaceValue,
      remove: async (key) => configuration.update(
        key,
        undefined,
        vscode.ConfigurationTarget.Workspace,
      ),
    },
  ];

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderConfiguration = vscode.workspace.getConfiguration(undefined, folder.uri);
    scopes.push({
      id: `workspaceFolder:${folder.uri.toString()}`,
      kind: 'workspaceFolder',
      label: `Workspace Folder: ${folder.name}`,
      read: (key) => folderConfiguration.inspect<unknown>(key)?.workspaceFolderValue,
      remove: async (key) => folderConfiguration.update(
        key,
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      ),
    });
  }

  return scopes;
}

async function runLegacySettingsCleanup(): Promise<void> {
  const result = await cleanUpLegacySettings(
    getLegacySettingsScopes(),
    async (targets) => {
      const action = await vscode.window.showWarningMessage(
        `Remove ${targets.length} legacy Structured Doc Editor setting${targets.length === 1 ? '' : 's'}?`,
        {
          modal: true,
          detail: [
            'Only settings retired from older releases will be removed. Current settings are preserved.',
            '',
            formatLegacySettingsPreview(targets),
          ].join('\n'),
        },
        'Clean Up',
      );
      return action === 'Clean Up';
    },
  );

  if (result.status === 'none') {
    await vscode.window.showInformationMessage('No legacy Structured Doc Editor settings were found.');
    return;
  }
  if (result.status === 'cancelled') {
    await vscode.window.showInformationMessage('Legacy settings cleanup was cancelled.');
    return;
  }
  if (result.failures.length === 0) {
    await vscode.window.showInformationMessage(
      `Removed ${result.removed.length} legacy Structured Doc Editor setting${result.removed.length === 1 ? '' : 's'}.`,
    );
    return;
  }

  const failureDetails = result.failures.map(({ target, error }) => (
    `${target.scopeLabel}: ${target.key}\n${error instanceof Error ? error.message : String(error)}`
  )).join('\n\n');
  await vscode.window.showErrorMessage(
    `Removed ${result.removed.length} legacy setting${result.removed.length === 1 ? '' : 's'}, but ${result.failures.length} could not be removed.`,
    { modal: true, detail: failureDetails },
  );
}

async function dispatchExport(format: ExportFormat): Promise<void> {
  try {
    await SdocEditorProvider.exportActiveDocument(format);
  } catch (error) {
    console.error('Structured Doc export command failed', error);
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
            title: 'Create Structured Doc — Experimental Templates',
            placeHolder: 'Select an experimental document template',
            matchOnDescription: true,
            matchOnDetail: true,
          },
        );
        return selected?.template;
      },
      requestTitle: async () => vscode.window.showInputBox({
        title: 'Create Structured Doc — Experimental Templates',
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
