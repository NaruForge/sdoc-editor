import * as vscode from 'vscode';
import * as path from 'path';
import { convertJsonToSlides } from '../../shared/converter';

export async function exportToSlides(context: vscode.ExtensionContext) {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

  if (!activeTab || !activeTab.input) {
    vscode.window.showErrorMessage('No active document found');
    return;
  }

  let documentUri: vscode.Uri | undefined;
  if (activeTab.input instanceof vscode.TabInputCustom) {
    documentUri = activeTab.input.uri;
  } else if (activeTab.input instanceof vscode.TabInputText) {
    documentUri = activeTab.input.uri;
  }

  if (!documentUri) {
    vscode.window.showErrorMessage('Could not determine active document');
    return;
  }

  if (!documentUri.path.endsWith('.sdoc') && !documentUri.path.endsWith('.tiptap.json')) {
    vscode.window.showErrorMessage('This command only works with .sdoc or .tiptap.json files');
    return;
  }

  try {
    const documentBytes = await vscode.workspace.fs.readFile(documentUri);
    const text = new TextDecoder().decode(documentBytes);
    let parsed = JSON.parse(text);

    const meta = (parsed.sdoc && parsed.meta) ? parsed.meta : undefined;
    let json = (parsed.sdoc && parsed.doc) ? parsed.doc : parsed;

    // Convert webview URIs back to relative paths
    json = convertWebviewUrisToRelativePaths(json);

    // Embed images as base64
    const documentDir = path.dirname(documentUri.fsPath);
    json = await embedImagesAsBase64(json, documentDir);

    // Get settings
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const FONT_WEIGHT_MAP: Record<string, number> = { Light: 300, Regular: 400, SemiBold: 600, Bold: 700 };
    const resolveFw = (name: string) => FONT_WEIGHT_MAP[name] || 400;

    let companyLogo = config.get<string>('theme.companyLogo') || '';
    if (companyLogo && !companyLogo.startsWith('data:') && !companyLogo.startsWith('http')) {
      try {
        const logoPath = path.join(context.extensionPath, 'media', companyLogo);
        const logoUri = vscode.Uri.file(logoPath);
        const logoData = await vscode.workspace.fs.readFile(logoUri);
        const base64 = Buffer.from(logoData).toString('base64');
        const ext = path.extname(companyLogo).toLowerCase().replace('.', '');
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext || 'png'}`;
        companyLogo = `data:${mime};base64,${base64}`;
      } catch { companyLogo = ''; }
    }

    const theme = {
      companyLogo,
      companyName: config.get<string>('theme.companyName') || '',
      primaryColor: config.get<string>('slide.primaryColor') || config.get<string>('theme.primaryColor') || '#A50034',
      accentColor: config.get<string>('slide.accentColor') || config.get<string>('theme.accentColor') || '#6b6b6b',
      fontFamily: config.get<string>('theme.fontFamily') || "'Legacy Font 2.0', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      customStyles: config.get<string>('theme.customStyles') || '',
      fontWeights: {
        body: resolveFw(config.get<string>('font.body', 'Regular')),
        bold: resolveFw(config.get<string>('font.bold', 'Bold')),
        h1: resolveFw(config.get<string>('font.h1', 'Bold')),
        h2: resolveFw(config.get<string>('font.h2', 'SemiBold')),
        h3: resolveFw(config.get<string>('font.h3', 'SemiBold')),
      },
    };

    // Load bundled fonts as base64
    const fontsDir = path.join(context.extensionPath, 'media', 'fonts');
    const BUNDLED_FONTS = [
      { file: 'LegacyFontL.woff2', weight: 300 },
      { file: 'LegacyFontR.woff2', weight: 400 },
      { file: 'LegacyFontSB.woff2', weight: 600 },
      { file: 'LegacyFontB.woff2', weight: 700 },
    ];
    const usedWeights = new Set(Object.values(theme.fontWeights));
    const embeddedFonts: { weight: number; dataUri: string }[] = [];
    for (const f of BUNDLED_FONTS) {
      if (!usedWeights.has(f.weight)) continue;
      try {
        const fontPath = path.join(fontsDir, f.file);
        const fontData = await vscode.workspace.fs.readFile(vscode.Uri.file(fontPath));
        const b64 = Buffer.from(fontData).toString('base64');
        embeddedFonts.push({ weight: f.weight, dataUri: `data:font/woff2;base64,${b64}` });
      } catch { /* skip */ }
    }
    (theme as any).embeddedFonts = embeddedFonts;

    const slideSettings = {
      imageCaptionPrefix: config.get<string>('caption.imagePrefix', 'Image'),
      tableCaptionPrefix: config.get<string>('caption.tablePrefix', 'Table'),
      captionNumbering: config.get<'simple' | 'hierarchical'>('caption.numbering', 'simple'),
      slideBreak: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
      showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
      transition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
    };

    const htmlContent = convertJsonToSlides(json, theme, slideSettings, meta);

    const slideUri = documentUri.with({
      path: documentUri.path.replace(/(\.tiptap\.json|\.sdoc)$/, '.slides.html'),
    });

    await vscode.workspace.fs.writeFile(slideUri, new TextEncoder().encode(htmlContent));

    const action = await vscode.window.showInformationMessage(
      `Slides exported: ${slideUri.fsPath}`,
      'Open in Browser'
    );

    if (action === 'Open in Browser') {
      await vscode.env.openExternal(slideUri);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to export slides: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

function convertWebviewUrisToRelativePaths(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const cloned = Array.isArray(node) ? [...node] : { ...node };
  if (cloned.type === 'image' && cloned.attrs?.src) {
    const src = cloned.attrs.src;
    if (src.includes('vscode-webview') || src.includes('vscode-resource')) {
      const match = src.match(/images\/([^?#]+)/);
      if (match) {
        cloned.attrs = { ...cloned.attrs, src: `./images/${match[1]}` };
      }
    }
  }
  if (cloned.content && Array.isArray(cloned.content)) {
    cloned.content = cloned.content.map((child: any) => convertWebviewUrisToRelativePaths(child));
  }
  return cloned;
}

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

async function embedImagesAsBase64(node: any, documentDir: string): Promise<any> {
  if (!node || typeof node !== 'object') return node;
  const cloned = Array.isArray(node) ? [...node] : { ...node };
  if (cloned.type === 'image' && cloned.attrs?.src) {
    const src: string = cloned.attrs.src;
    if (!src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
      try {
        const imagePath = path.resolve(documentDir, src);
        const imageUri = vscode.Uri.file(imagePath);
        const imageData = await vscode.workspace.fs.readFile(imageUri);
        const base64 = Buffer.from(imageData).toString('base64');
        const ext = path.extname(src).toLowerCase().replace('.', '');
        const mime = getMimeType(ext);
        cloned.attrs = { ...cloned.attrs, src: `data:${mime};base64,${base64}` };
      } catch { /* keep original */ }
    }
  }
  if (cloned.content && Array.isArray(cloned.content)) {
    cloned.content = await Promise.all(
      cloned.content.map((child: any) => embedImagesAsBase64(child, documentDir))
    );
  }
  return cloned;
}
