import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolve custom CSS content from a workspace-relative file path.
 * Falls back to the provided fallback string if the file doesn't exist or is unreadable.
 */
export async function resolveCustomCss(
  cssPath: string | undefined,
  workspacePath: string,
  fallbackCss: string,
): Promise<string> {
  if (!cssPath) {
    return fallbackCss;
  }

  const absolutePath = path.resolve(workspacePath, cssPath);
  try {
    return await fs.readFile(absolutePath, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    vscode.window.showWarningMessage(
      `Custom CSS 파일을 읽을 수 없어 기본 스타일로 내보냅니다: ${absolutePath} (${reason})`
    );
    return fallbackCss;
  }
}
