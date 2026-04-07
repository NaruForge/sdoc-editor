import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface VersionInfo {
  version: string;
  filename?: string;
}

export async function checkForUpdateManual(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('structuredDocEditor');
  const sharedFolder = config.get<string>('update.sharedFolder', '');

  if (!sharedFolder) {
    const action = await vscode.window.showWarningMessage(
      '업데이트 확인을 위해 공유 폴더 경로를 설정해 주세요.',
      '설정 열기'
    );
    if (action === '설정 열기') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'structuredDocEditor.update.sharedFolder');
    }
    return;
  }

  await checkForUpdate(context, true);
}

export async function checkForUpdate(context: vscode.ExtensionContext, manual = false): Promise<void> {
  const config = vscode.workspace.getConfiguration('structuredDocEditor');
  const sharedFolder = config.get<string>('update.sharedFolder', '');

  if (!sharedFolder) {
    console.log('[sdoc-editor] Update check skipped: no sharedFolder configured');
    return;
  }

  try {
    const versionFilePath = path.join(sharedFolder, 'version.json');
    console.log('[sdoc-editor] Checking for updates at:', versionFilePath);

    // Use Node.js fs directly to bypass VS Code's UNC host security restrictions
    let raw: string;
    try {
      raw = await fs.promises.readFile(versionFilePath, 'utf-8');
    } catch (e) {
      console.log('[sdoc-editor] Cannot read version.json:', (e as Error).message || '');
      return;
    }

    const remote: VersionInfo = JSON.parse(raw);

    const currentVersion = context.extension.packageJSON.version as string;
    console.log(`[sdoc-editor] Current: v${currentVersion}, Remote: v${remote.version}`);

    if (!remote.version || remote.version === currentVersion) {
      if (manual) {
        vscode.window.showInformationMessage(`Structured Doc Editor v${currentVersion}은 최신 버전입니다.`);
      }
      return;
    }

    if (!isNewer(remote.version, currentVersion)) {
      if (manual) {
        vscode.window.showInformationMessage(`Structured Doc Editor v${currentVersion}은 최신 버전입니다.`);
      }
      return;
    }

    const vsixName = remote.filename || `sdoc-editor-${remote.version}.vsix`;
    const vsixPath = path.join(sharedFolder, vsixName);

    try {
      await fs.promises.access(vsixPath);
    } catch {
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

    // Copy VSIX to local temp to avoid any UNC issues during install
    const tmpDir = path.join(context.globalStorageUri.fsPath, 'update-tmp');
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const localVsix = path.join(tmpDir, vsixName);
    await fs.promises.copyFile(vsixPath, localVsix);

    try {
      await vscode.commands.executeCommand(
        'workbench.extensions.installExtension',
        vscode.Uri.file(localVsix)
      );
    } finally {
      // Clean up temp file
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    const reload = await vscode.window.showInformationMessage(
      `v${remote.version} 설치 완료. VS Code를 리로드해야 적용됩니다.`,
      '리로드'
    );

    if (reload === '리로드') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch (err) {
    console.warn('[sdoc-editor] Update check failed:', err);
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
