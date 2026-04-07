import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SdocEditorProvider } from './SdocEditorProvider';
import { SdocBookProvider } from './SdocBookProvider';
import { exportToHtml } from './commands/exportToHtml';
import { exportToAdoc } from './commands/exportToAdoc';
import { exportToMarkdown } from './commands/exportToMarkdown';
import { exportToPdf } from './commands/exportToPdf';
import { checkForUpdate, checkForUpdateManual } from './updateChecker';

export function activate(context: vscode.ExtensionContext) {
  console.log('Structured Doc Editor extension is now active');

  // Check for updates from shared folder
  checkForUpdate(context);

  // Register the custom editor providers
  context.subscriptions.push(SdocEditorProvider.register(context));
  context.subscriptions.push(SdocBookProvider.register(context));

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

  // Register export to PDF command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.exportToPdf',
      () => exportToPdf(context)
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

function setupMcpInWorkspace(context: vscode.ExtensionContext, workspaceFsPath: string): void {
  const mcpServerPath = path.join(context.extensionPath, 'dist', 'mcp-server.js');
  const vscodeDir = path.join(workspaceFsPath, '.vscode');
  const mcpJsonPath = path.join(vscodeDir, 'mcp.json');

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

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

async function setupAgent(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('워크스페이스 폴더가 열려 있지 않습니다.');
    return;
  }

  // Source: docs/agent/.github/ inside the extension
  const srcGithubDir = path.join(context.extensionPath, 'docs', 'agent', '.github');
  if (!fs.existsSync(srcGithubDir)) {
    vscode.window.showErrorMessage(
      `Agent 파일을 찾을 수 없습니다: ${srcGithubDir}\n확장을 재설치해 주세요.`
    );
    return;
  }

  const destGithubDir = path.join(workspaceFolder.uri.fsPath, '.github');

  // Collect files to copy and detect conflicts
  const filePairs = collectFilePairs(srcGithubDir, destGithubDir);
  const conflicts = filePairs.filter(([, dest]) => fs.existsSync(dest));

  if (conflicts.length > 0) {
    const conflictList = conflicts.map(([, dest]) => path.relative(workspaceFolder.uri.fsPath, dest)).join('\n');
    const answer = await vscode.window.showWarningMessage(
      `이미 존재하는 파일이 있습니다. 덮어쓰시겠습니까?`,
      { modal: true, detail: conflictList },
      '덮어쓰기', '취소'
    );
    if (answer !== '덮어쓰기') { return; }
  }

  // Copy files
  for (const [src, dest] of filePairs) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // Set up MCP server in .vscode/mcp.json
  setupMcpInWorkspace(context, workspaceFolder.uri.fsPath);

  vscode.window.showInformationMessage(
    `AI Agent 설정 완료! ${filePairs.length}개 파일이 .github/ 에 복사되었습니다.`,
    '확인'
  );
}

function collectFilePairs(srcDir: string, destDir: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      pairs.push(...collectFilePairs(srcPath, destPath));
    } else {
      pairs.push([srcPath, destPath]);
    }
  }
  return pairs;
}

export function deactivate() {}
