import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { DocumentSettings, ResolvedEditorSettings, SdocMeta, TiptapNode } from '@shared/types';

export type ExportFormat = 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides';

interface AppThemeSettings {
  themeCompanyName?: string;
  themePrimaryColor?: string;
  themeAccentColor?: string;
  themeFontFamily?: string;
  themeCustomStyles?: string;
}

export async function exportDocument(
  format: ExportFormat,
  doc: TiptapNode,
  settings: ResolvedEditorSettings,
  docSettings: Partial<DocumentSettings> | null,
  meta: SdocMeta,
): Promise<void> {
  const exportSettings = {
    captionStyle: settings.captionStyle,
    headingNumbering: settings.headingNumbering,
    imageCaptionPrefix: settings.imageCaptionPrefix,
    tableCaptionPrefix: settings.tableCaptionPrefix,
    equationCaptionPrefix: settings.equationCaptionPrefix,
    captionSeparator: settings.captionSeparator,
    captionNumbering: settings.captionNumbering,
    equationNumbering: settings.equationNumbering,
    tableNumberStyle: settings.tableNumberStyle,
    equationParens: settings.equationParens,
    exportImagePath: settings.exportImagePath,
    pdfScale: docSettings?.pdfScale,
    selfContained: docSettings?.selfContained,
    outputDir: docSettings?.outputDir,
  };

  let content: string;
  let extension: string;
  let filterName: string;

  switch (format) {
    case 'html': {
      const { convertJsonToHtml } = await import('@shared/converter/jsonToHtml');
      const appSettings = await invoke<AppThemeSettings>('get_settings');
      let htmlCss = '';
      if (docSettings?.htmlCssPath) {
        try {
          const cssPath = await invoke<string>('resolve_document_relative_path', { path: docSettings.htmlCssPath });
          htmlCss = await invoke<string>('read_import_file', { path: cssPath });
        } catch (error: unknown) {
          console.warn('Failed to load document HTML CSS', error);
        }
      }
      content = convertJsonToHtml(doc, {
        companyName: appSettings.themeCompanyName,
        primaryColor: appSettings.themePrimaryColor,
        accentColor: appSettings.themeAccentColor,
        fontFamily: appSettings.themeFontFamily,
        customStyles: `${appSettings.themeCustomStyles ?? ''}${htmlCss}`,
      }, exportSettings, meta);
      extension = 'html';
      filterName = 'HTML';
      break;
    }
    case 'markdown': {
      const { convertJsonToMarkdown } = await import('@shared/converter/jsonToMarkdown');
      content = convertJsonToMarkdown(doc, exportSettings, meta);
      extension = 'md';
      filterName = 'Markdown';
      break;
    }
    case 'adoc': {
      const { convertJsonToAdoc } = await import('@shared/converter/jsonToAdoc');
      content = convertJsonToAdoc(doc, exportSettings, meta);
      extension = 'adoc';
      filterName = 'AsciiDoc';
      break;
    }
    case 'pdf':
    case 'slides':
      window.alert(`${format.toUpperCase()} export is not available in the desktop app yet.`);
      return;
  }

  const path = await save({ filters: [{ name: filterName, extensions: [extension] }] });
  if (path) await invoke('write_export_file', { path, content });
}
