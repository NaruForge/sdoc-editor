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

  // Register Setup AI Agent (all-in-one) command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'structuredDocEditor.setupAgent',
      () => setupAgent(context)
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

  // Also set up MCP server in .vscode/mcp.json
  await setupMcpServer(context);

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
