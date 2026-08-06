import * as vscode from 'vscode';
import { getCaptionPreset, resolveSettings } from '../../shared/settingsResolver';
import type { CaptionStyleName } from '../../shared/types';
import * as path from 'path';
import { resolveFontWeight } from './fontUtils';
import { MIME_MAP } from './imageUtils';
import { parseImageExtension } from '../../shared/security/portableAssets';
import { MAX_ASSET_BYTES } from '../../shared/resourceLimits';
import {
  normalizeEmbeddedImageDataUrl,
  normalizeHttpImageUrl,
} from '../../shared/security/exportImageSource';
import { resolveContainedRegularFile } from './containedFile';

export async function resolveCompanyLogo(
  logoSetting: string,
  extensionPath: string,
): Promise<string> {
  if (!logoSetting) return '';
  if (logoSetting.startsWith('data:')) return normalizeEmbeddedImageDataUrl(logoSetting) ?? '';
  if (logoSetting.startsWith('http')) return normalizeHttpImageUrl(logoSetting) ?? '';

  try {
    const extension = parseImageExtension(path.extname(logoSetting).slice(1));
    if (!extension) return '';
    const mediaRoot = path.join(extensionPath, 'media');
    const { canonicalPath } = await resolveContainedRegularFile(mediaRoot, logoSetting, {
      extension: `.${extension}`,
      maximumBytes: MAX_ASSET_BYTES,
    });
    const logoUri = vscode.Uri.file(canonicalPath);
    const logoData = await vscode.workspace.fs.readFile(logoUri);
    if (logoData.byteLength > MAX_ASSET_BYTES) return '';
    const base64 = Buffer.from(logoData).toString('base64');
    const mime = extension === 'svg' ? 'image/svg+xml' : MIME_MAP[extension];
    if (!mime) return '';
    return `data:${mime};base64,${base64}`;
  } catch {
    return '';
  }
}

export interface FontWeights {
  body: number;
  bold: number;
  h1: number;
  h2: number;
  h3: number;
}

export function readFontWeights(config: vscode.WorkspaceConfiguration): FontWeights {
  return {
    body: resolveFontWeight(config.get<string>('font.body', 'Regular')),
    bold: resolveFontWeight(config.get<string>('font.bold', 'Bold')),
    h1: resolveFontWeight(config.get<string>('font.h1', 'Bold')),
    h2: resolveFontWeight(config.get<string>('font.h2', 'SemiBold')),
    h3: resolveFontWeight(config.get<string>('font.h3', 'SemiBold')),
  };
}

export function buildHtmlTheme(
  config: vscode.WorkspaceConfiguration,
  companyLogo: string,
  fontWeights: FontWeights,
  embeddedFonts: { weight: number; dataUri: string }[],
): Record<string, unknown> {
  return {
    companyLogo,
    companyName: config.get<string>('theme.companyName') || '',
    primaryColor: config.get<string>('theme.primaryColor') || '#2563EB',
    accentColor: config.get<string>('theme.accentColor') || '#6b6b6b',
    fontFamily: config.get<string>('theme.fontFamily') ||
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    customStyles: config.get<string>('theme.customStyles') || '',
    fontWeights,
    embeddedFonts,
  };
}

export function readExportSettings(config: vscode.WorkspaceConfiguration): Record<string, unknown> {
  const resolved = resolveSettings(undefined, {
    captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
    headingNumbering: config.get<boolean>('heading.numbering', true),
    headingStartNumber: config.get<number>('heading.startNumber', 1),
    captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
    equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
  });
  const preset = getCaptionPreset(resolved.captionStyle);
  return {
    captionStyle: resolved.captionStyle,
    headingNumbering: resolved.headingNumbering,
    headingStartNumber: resolved.headingStartNumber,
    imageCaptionPrefix: preset.figurePrefix,
    tableCaptionPrefix: preset.tablePrefix,
    equationCaptionPrefix: preset.equationPrefix,
    captionSeparator: preset.separator,
    tableNumberStyle: preset.tableNumberStyle,
    equationParens: preset.equationParens,
    captionNumbering: resolved.captionNumbering,
    equationNumbering: resolved.equationNumbering,
    exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
  };
}
