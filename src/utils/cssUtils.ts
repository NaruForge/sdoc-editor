import * as fs from 'fs/promises';
import * as path from 'path';

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
  } catch {
    console.warn(`Custom CSS file not found or unreadable: ${absolutePath}`);
    return fallbackCss;
  }
}
