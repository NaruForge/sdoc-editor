import * as vscode from 'vscode';
import { readContainedTextFile } from './containedFile';

export const MAX_CUSTOM_CSS_BYTES = 1024 * 1024;

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

  try {
    return await readContainedTextFile(workspacePath, cssPath, {
      extension: '.css',
      maximumBytes: MAX_CUSTOM_CSS_BYTES,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    vscode.window.showWarningMessage(
      `Custom CSS 파일을 안전하게 읽을 수 없어 기본 스타일로 내보냅니다: ${cssPath} (${reason})`
    );
    return fallbackCss;
  }
}
