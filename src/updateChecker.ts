import * as vscode from 'vscode';
import * as path from 'path';

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
    const versionFileUri = vscode.Uri.file(path.join(sharedFolder, 'version.json'));
    console.log('[sdoc-editor] Checking for updates at:', versionFileUri.fsPath);

    let raw: string;
    try {
      const data = await vscode.workspace.fs.readFile(versionFileUri);
      raw = Buffer.from(data).toString('utf-8');
    } catch (e) {
      const msg = (e as Error).message || '';
      console.log('[sdoc-editor] Cannot read version.json:', msg);

      if (msg.includes('UNC host') && msg.includes('not allowed')) {
        const hostname = sharedFolder.replace(/^\\\\/, '').split('\\')[0];
        const action = await vscode.window.showWarningMessage(
          `자동 업데이트를 위해 UNC 호스트 '${hostname}' 접근을 허용해야 합니다.`,
          '설정 열기'
        );
        if (action === '설정 열기') {
          const config = vscode.workspace.getConfiguration('security');
          const hosts = config.get<string[]>('allowedUNCHosts', []);
          if (!hosts.includes(hostname)) {
            hosts.push(hostname);
            await config.update('allowedUNCHosts', hosts, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(
              `'${hostname}'이(가) 허용 목록에 추가되었습니다. VS Code를 리로드하면 자동 업데이트가 작동합니다.`,
              '리로드'
            ).then(r => {
              if (r === '리로드') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
              }
            });
          }
        }
      }
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
    const vsixUri = vscode.Uri.file(path.join(sharedFolder, vsixName));

    try {
      await vscode.workspace.fs.stat(vsixUri);
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

    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      vsixUri
    );

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
