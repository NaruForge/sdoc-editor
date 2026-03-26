import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface VersionInfo {
  version: string;
  filename?: string;
}

export async function checkForUpdate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('structuredDocEditor');
  const sharedFolder = config.get<string>('update.sharedFolder', '');

  if (!sharedFolder) {
    return;
  }

  try {
    const versionFilePath = path.join(sharedFolder, 'version.json');

    if (!fs.existsSync(versionFilePath)) {
      return;
    }

    const raw = fs.readFileSync(versionFilePath, 'utf-8');
    const remote: VersionInfo = JSON.parse(raw);

    const currentVersion = context.extension.packageJSON.version as string;

    if (!remote.version || remote.version === currentVersion) {
      return;
    }

    if (!isNewer(remote.version, currentVersion)) {
      return;
    }

    const vsixName = remote.filename || `sdoc-editor-${remote.version}.vsix`;
    const vsixPath = path.join(sharedFolder, vsixName);

    if (!fs.existsSync(vsixPath)) {
      vscode.window.showWarningMessage(
        `sdoc-editor v${remote.version} 업데이트가 있지만, VSIX 파일을 찾을 수 없습니다: ${vsixName}`
      );
      return;
    }

    const action = await vscode.window.showInformationMessage(
      `Structured Doc Editor v${remote.version} 업데이트가 있습니다. (현재: v${currentVersion})`,
      '업데이트',
      '나중에'
    );

    if (action !== '업데이트') {
      return;
    }

    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      vscode.Uri.file(vsixPath)
    );

    const reload = await vscode.window.showInformationMessage(
      `v${remote.version} 설치 완료. VS Code를 리로드해야 적용됩니다.`,
      '리로드'
    );

    if (reload === '리로드') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch {
    // Silently ignore — shared folder not accessible, network down, etc.
  }
}

function isNewer(remote: string, current: string): boolean {
  const r = remote.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] || 0;
    const cv = c[i] || 0;
    if (rv > cv) { return true; }
    if (rv < cv) { return false; }
  }
  return false;
}
