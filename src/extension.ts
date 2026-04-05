import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SdocEditorProvider } from './SdocEditorProvider';
import { exportToHtml } from './commands/exportToHtml';
import { exportToAdoc } from './commands/exportToAdoc';
import { exportToMarkdown } from './commands/exportToMarkdown';
import { checkForUpdate } from './updateChecker';

export function activate(context: vscode.ExtensionContext) {
  console.log('Structured Doc Editor extension is now active');

  // Check for updates from shared folder
  checkForUpdate(context);

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

  // Register Setup MCP Server command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.setupMcp',
      () => setupMcpServer(context)
    )
  );
}

async function setupMcpServer(context: vscode.ExtensionContext): Promise<void> {
  const mcpServerPath = path.join(context.extensionPath, 'dist', 'mcp-server.js');

  // Choose scope: workspace or user profile
  const scope = await vscode.window.showQuickPick(
    [
      { label: '$(folder) 워크스페이스', description: '.vscode/mcp.json — 현재 프로젝트에만 적용', value: 'workspace' },
      { label: '$(account) 사용자 전체', description: '사용자 프로필 mcp.json — 모든 프로젝트에 적용', value: 'user' },
    ],
    { title: 'MCP 서버를 어디에 등록하시겠습니까?' }
  );
  if (!scope) { return; }

  if (scope.value === 'user') {
    // Open user MCP config via built-in command and show instruction
    await vscode.commands.executeCommand('workbench.mcp.openUserMcpConfig');
    await vscode.window.showInformationMessage(
      '열린 파일의 "servers" 블록에 아래 내용을 추가하세요.',
      { modal: true, detail: JSON.stringify({ sdoc: { type: 'stdio', command: 'node', args: [mcpServerPath] } }, null, 2) }
    );
    return;
  }

  // Workspace scope
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('워크스페이스 폴더가 열려 있지 않습니다.');
    return;
  }

  const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
  const mcpJsonPath = path.join(vscodeDir, 'mcp.json');

  // Read existing mcp.json or start fresh
  let config: { servers: Record<string, unknown> } = { servers: {} };
  try {
    const existing = fs.readFileSync(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(existing);
    config = { servers: {}, ...parsed };
  } catch {
    // File doesn't exist — use default
  }

  // Overwrite/add sdoc server entry
  config.servers['sdoc'] = {
    type: 'stdio',
    command: 'node',
    args: [mcpServerPath],
  };

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  const action = await vscode.window.showInformationMessage(
    `MCP 서버가 .vscode/mcp.json에 등록되었습니다.`,
    '파일 열기'
  );
  if (action === '파일 열기') {
    const doc = await vscode.workspace.openTextDocument(mcpJsonPath);
    await vscode.window.showTextDocument(doc);
  }
}

export function deactivate() {}
