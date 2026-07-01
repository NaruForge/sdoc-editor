import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SdocEditorProvider } from './SdocEditorProvider';
import { SdocBookProvider } from './SdocBookProvider';
import { exportToHtml } from './commands/exportToHtml';
import { exportToAdoc } from './commands/exportToAdoc';
import { exportToMarkdown } from './commands/exportToMarkdown';
import { exportToPdf } from './commands/exportToPdf';
import { exportToSlides } from './commands/exportToSlides';
import { checkForUpdate, checkForUpdateManual } from './updateChecker';
import { createEmptySdoc } from '../shared/mcp/sdocUtils';

/**
 * Show What's New (CHANGELOG) when extension is updated to a new version
 */
async function showWhatsNewIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  try {
    const packageJsonPath = path.join(context.extensionPath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
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

  // Check for updates from shared folder
  checkForUpdate(context);

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

  // Register export to PDF command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToPdf',
      () => exportToPdf(context)
    )
  );

  // Register export to Slides command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToSlides',
      () => exportToSlides(context)
    )
  );

  // Register Setup AI Agent (all-in-one) command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.checkForUpdate',
      () => checkForUpdateManual(context)
    )
  );

  // Register Setup AI Agent (all-in-one) command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.setupAgent',
      () => setupAgent(context)
    )
  );
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

function migrateVscodeMcpJson(workspaceFsPath: string): void {
  const vscodeMcpPath = path.join(workspaceFsPath, '.vscode', 'mcp.json');
  if (!fs.existsSync(vscodeMcpPath)) return;

  try {
    const content = fs.readFileSync(vscodeMcpPath, 'utf-8');
    const config = JSON.parse(content) as { servers?: Record<string, unknown> };
    if (!config.servers?.['sdoc']) return;

    delete config.servers['sdoc'];

    const { servers, ...rest } = config;
    if (Object.keys(servers).length === 0 && Object.keys(rest).length === 0) {
      fs.rmSync(vscodeMcpPath);
    } else {
      fs.writeFileSync(vscodeMcpPath, JSON.stringify({ ...rest, servers }, null, 2) + '\n', 'utf-8');
    }
  } catch {
    // intentionally ignored: malformed or unreadable .vscode/mcp.json
  }
}

function setupMcpInWorkspace(context: vscode.ExtensionContext, workspaceFsPath: string): void {
  const mcpServerPath = path.join(context.extensionPath, 'dist', 'mcp-server.js');
  const githubDir = path.join(workspaceFsPath, '.github');
  const mcpJsonPath = path.join(githubDir, 'mcp.json');

  migrateVscodeMcpJson(workspaceFsPath);

  let config: { servers: Record<string, unknown> } = { servers: {} };
  try {
    const existing = fs.readFileSync(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(existing);
    config = { servers: {}, ...parsed };
  } catch {
    // File doesn't exist — use default
  }

  config.servers['sdoc'] = {
    type: 'stdio',
    command: 'node',
    args: [mcpServerPath],
  };

  fs.mkdirSync(githubDir, { recursive: true });
  fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

async function setupAgent(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('워크스페이스 폴더가 열려 있지 않습니다.');
    return;
  }

  const workspaceFsPath = workspaceFolder.uri.fsPath;

  // 1. Copy slim instructions file (needed for applyTo auto-loading)
  const srcInstructionsDir = path.join(context.extensionPath, 'docs', 'agent', '.github', 'instructions');
  const destInstructionsDir = path.join(workspaceFsPath, '.github', 'instructions');
  const instructionsFile = 'sdoc-format.instructions.md';
  const srcPath = path.join(srcInstructionsDir, instructionsFile);
  const destPath = path.join(destInstructionsDir, instructionsFile);

  if (fs.existsSync(srcPath)) {
    if (fs.existsSync(destPath)) {
      const answer = await vscode.window.showWarningMessage(
        `${instructionsFile} 파일이 이미 존재합니다. 덮어쓰시겠습니까?`,
        '덮어쓰기', '건너뛰기'
      );
      if (answer === '덮어쓰기') {
        fs.mkdirSync(destInstructionsDir, { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    } else {
      fs.mkdirSync(destInstructionsDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // 2. Register MCP server
  setupMcpInWorkspace(context, workspaceFsPath);

  vscode.window.showInformationMessage(
    'AI Support 설정 완료! Instructions 복사 + MCP 서버 등록 완료.',
    '확인'
  );
}

export function deactivate() {}
