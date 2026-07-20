import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface VersionInfo {
  version: string;
  filename?: string;
}

const OPEN_SETTINGS = '설정 열기';
const INSTALL_UPDATE = '업데이트';
const LATER = '나중에';
const RELOAD = '다시 로드';

export async function checkForUpdateManual(context: vscode.ExtensionContext): Promise<void> {
  const sharedFolder = getSharedFolder();
  if (!sharedFolder) {
    const action = await vscode.window.showWarningMessage(
      '업데이트를 확인하려면 공유 폴더 경로를 설정하세요.',
      OPEN_SETTINGS,
    );
    if (action === OPEN_SETTINGS) {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'structuredDocEditor.update.sharedFolder',
      );
    }
    return;
  }

  await checkForUpdate(context, true);
}

export async function checkForUpdate(
  context: vscode.ExtensionContext,
  manual = false,
): Promise<void> {
  const sharedFolder = getSharedFolder();
  if (!sharedFolder) return;

  try {
    const versionFilePath = path.join(sharedFolder, 'version.json');
    let raw: string;
    try {
      // Node fs is used intentionally because VS Code URI handling can reject UNC hosts.
      raw = await fs.promises.readFile(versionFilePath, 'utf8');
    } catch (error: unknown) {
      console.warn('[sdoc-editor] Cannot read update metadata:', getErrorMessage(error));
      if (manual) {
        vscode.window.showWarningMessage(`업데이트 정보를 읽을 수 없습니다: ${versionFilePath}`);
      }
      return;
    }

    const remote = parseVersionInfo(raw);
    const currentVersion = context.extension.packageJSON.version as string;
    if (!isNewer(remote.version, currentVersion)) {
      if (manual) {
        vscode.window.showInformationMessage(
          `Structured Doc Editor v${currentVersion}은(는) 최신 버전입니다.`,
        );
      }
      return;
    }

    const vsixName = remote.filename ?? `sdoc-editor-${remote.version}.vsix`;
    const vsixPath = path.join(sharedFolder, vsixName);
    try {
      await fs.promises.access(vsixPath, fs.constants.R_OK);
    } catch {
      vscode.window.showWarningMessage(
        `v${remote.version} 업데이트 정보는 있지만 VSIX 파일을 찾을 수 없습니다: ${vsixName}`,
      );
      return;
    }

    const action = await vscode.window.showInformationMessage(
      `Structured Doc Editor v${remote.version} 업데이트가 있습니다. (현재 v${currentVersion})`,
      INSTALL_UPDATE,
      LATER,
    );
    if (action !== INSTALL_UPDATE) return;

    // Install from a local copy so UNC paths do not leak into the extension installer.
    const tempDir = path.join(context.globalStorageUri.fsPath, 'update-tmp');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const localVsix = path.join(tempDir, vsixName);
    await fs.promises.copyFile(vsixPath, localVsix);

    try {
      await vscode.commands.executeCommand(
        'workbench.extensions.installExtension',
        vscode.Uri.file(localVsix),
      );
    } finally {
      void fs.promises.rm(tempDir, { recursive: true, force: true });
    }

    const reload = await vscode.window.showInformationMessage(
      `v${remote.version} 설치가 완료되었습니다. VS Code를 다시 로드하면 적용됩니다.`,
      RELOAD,
    );
    if (reload === RELOAD) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch (error: unknown) {
    console.warn('[sdoc-editor] Update check failed:', getErrorMessage(error));
    if (manual) {
      vscode.window.showErrorMessage(`업데이트 확인에 실패했습니다: ${getErrorMessage(error)}`);
    }
  }
}

function getSharedFolder(): string {
  return vscode.workspace
    .getConfiguration('structuredDocEditor')
    .get<string>('update.sharedFolder', '')
    .trim();
}

function parseVersionInfo(raw: string): VersionInfo {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('version' in value)) {
    throw new Error('version.json does not contain a version');
  }
  const { version, filename } = value as Record<string, unknown>;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    throw new Error('version.json contains an invalid version');
  }
  if (filename !== undefined && typeof filename !== 'string') {
    throw new Error('version.json contains an invalid filename');
  }
  return { version, filename };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNewer(remote: string, current: string): boolean {
  const remoteParts = remote.split(/[.+-]/, 3).map(Number);
  const currentParts = current.split(/[.+-]/, 3).map(Number);
  for (let index = 0; index < 3; index++) {
    const remotePart = remoteParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (remotePart > currentPart) return true;
    if (remotePart < currentPart) return false;
  }
  return false;
}
