import * as vscode from 'vscode';
import { getCaptionPreset, resolveSettings } from '../../shared/settingsResolver';
import type { CaptionStyleName } from '../../shared/types';
import * as path from 'path';
import { resolveFontWeight } from './fontUtils';
import { MIME_MAP } from './imageUtils';

export async function resolveCompanyLogo(
  logoSetting: string,
  extensionPath: string,
): Promise<string> {
  if (!logoSetting) return '';
  if (logoSetting.startsWith('data:') || logoSetting.startsWith('http')) return logoSetting;

  try {
    const logoPath = path.join(extensionPath, 'media', logoSetting);
    const logoUri = vscode.Uri.file(logoPath);
    const logoData = await vscode.workspace.fs.readFile(logoUri);
    const base64 = Buffer.from(logoData).toString('base64');
    const ext = path.extname(logoSetting).toLowerCase().replace('.', '');
    const mime = ext === 'svg' ? 'image/svg+xml' : (MIME_MAP[ext] || `image/${ext || 'png'}`);
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
    primaryColor: config.get<string>('theme.primaryColor') || '#A50034',
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
    captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
    equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
  });
  const preset = getCaptionPreset(resolved.captionStyle);
  return {
    captionStyle: resolved.captionStyle,
    headingNumbering: resolved.headingNumbering,
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
