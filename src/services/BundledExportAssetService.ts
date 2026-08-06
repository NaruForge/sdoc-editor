import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { HtmlExportSettings } from '../../shared/types';

type EmbeddedExportAssets = NonNullable<HtmlExportSettings['embeddedAssets']>;

const ASSET_DIRECTORY = path.join('dist', 'export-assets');
const FONT_URL_PATTERN = /url\((['"]?)(fonts\/([^)'"?]+\.woff2))\1\)/g;
const LEGACY_FONT_FALLBACK_PATTERN = /,url\((['"]?)fonts\/[^)'"?]+\.(?:woff|ttf)\1\) format\((['"]?)(?:woff|truetype)\2\)/g;

async function readText(extensionPath: string, name: string): Promise<string> {
  return readFile(path.join(extensionPath, ASSET_DIRECTORY, name), 'utf8');
}

async function inlineKatexFonts(extensionPath: string, css: string): Promise<string> {
  const names = [...css.matchAll(FONT_URL_PATTERN)].map((match) => match[3]);
  const encodedFonts = new Map<string, string>();
  await Promise.all([...new Set(names)].map(async (name) => {
    const value = await readFile(path.join(extensionPath, ASSET_DIRECTORY, 'fonts', name));
    encodedFonts.set(name, value.toString('base64'));
  }));
  return css
    .replace(FONT_URL_PATTERN, (_match, _quote, _relative, name: string) => (
      `url(data:font/woff2;base64,${encodedFonts.get(name) ?? ''})`
    ))
    .replace(LEGACY_FONT_FALLBACK_PATTERN, '');
}

/** Loads the export runtime shipped in the VSIX. This operation never uses the network. */
export async function loadBundledExportAssets(extensionPath: string): Promise<EmbeddedExportAssets> {
  const [rawKatexCss, katexJs, autoRenderJs, mermaidJs] = await Promise.all([
    readText(extensionPath, 'katex.min.css'),
    readText(extensionPath, 'katex.min.js'),
    readText(extensionPath, 'auto-render.min.js'),
    readText(extensionPath, 'mermaid.min.js'),
  ]);
  const katexCss = await inlineKatexFonts(extensionPath, rawKatexCss);
  return { katexCss, katexJs, autoRenderJs, mermaidJs };
}
