import * as https from 'https';
import * as vscode from 'vscode';
import type { HtmlExportSettings } from '../../shared/types';

const CDN_URLS = {
  katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
  katexJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
  autoRenderJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js',
  mermaidJs: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
} as const;

function fetchText(url: string, redirects = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400
        && response.headers.location && redirects > 0) {
        response.resume();
        void fetchText(response.headers.location, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode ?? 'unknown'} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

export async function loadCachedCdnAssets(
  context: vscode.ExtensionContext,
): Promise<NonNullable<HtmlExportSettings['embeddedAssets']>> {
  const cacheDirectory = vscode.Uri.joinPath(context.globalStorageUri, 'cdn-cache');
  await vscode.workspace.fs.createDirectory(cacheDirectory);
  const load = async (key: string, url: string): Promise<string> => {
    const cacheFile = vscode.Uri.joinPath(cacheDirectory, key);
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(cacheFile));
    } catch {
      const content = await fetchText(url);
      await vscode.workspace.fs.writeFile(cacheFile, new TextEncoder().encode(content));
      return content;
    }
  };
  const [katexCss, katexJs, autoRenderJs, mermaidJs] = await Promise.all([
    load('katex.min.css', CDN_URLS.katexCss),
    load('katex.min.js', CDN_URLS.katexJs),
    load('auto-render.min.js', CDN_URLS.autoRenderJs),
    load('mermaid.min.js', CDN_URLS.mermaidJs),
  ]);
  return { katexCss, katexJs, autoRenderJs, mermaidJs };
}
