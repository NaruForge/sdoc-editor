import * as vscode from 'vscode';
import { getWebviewUri } from './webviewHelper';

export const BUNDLED_FONTS: ReadonlyArray<{ file: string; weight: number }> = [];

export const FONT_WEIGHT_MAP: Record<string, number> = {
  Light: 300,
  Regular: 400,
  SemiBold: 600,
  Bold: 700,
};

export function resolveFontWeight(name: string): number {
  return FONT_WEIGHT_MAP[name] || 400;
}

export function generateFontFaceCSS(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  return BUNDLED_FONTS.map(({ file, weight }) => {
    const fontUri = getWebviewUri(webview, extensionUri, ['media', 'fonts', file]);
    return `@font-face {
  font-family: 'Structured Doc Embedded Font';
  font-weight: ${weight};
  font-style: normal;
  font-display: swap;
  src: url('${fontUri}') format('woff2');
}`;
  }).join('\n');
}

export async function loadBundledFontsAsBase64(
  extensionUri: vscode.Uri,
  weights?: Set<number>,
): Promise<{ weight: number; dataUri: string }[]> {
  const results: { weight: number; dataUri: string }[] = [];
  for (const { file, weight } of BUNDLED_FONTS) {
    if (weights && !weights.has(weight)) continue;
    try {
      const fontPath = vscode.Uri.joinPath(extensionUri, 'media', 'fonts', file);
      const fontData = await vscode.workspace.fs.readFile(fontPath);
      const base64 = Buffer.from(fontData).toString('base64');
      results.push({ weight, dataUri: `data:font/woff2;base64,${base64}` });
    } catch {
      // intentionally ignored: font file may be missing in dev
    }
  }
  return results;
}
