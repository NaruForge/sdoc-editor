import type { EditorSettings } from './context/EditorContext';

interface StyleTarget {
  style: { setProperty(name: string, value: string): void };
  dataset?: { [key: string]: string | undefined };
}

export function applyEditorSettingsCss(
  editorElement: StyleTarget | null,
  rootElement: StyleTarget,
  settings: EditorSettings,
): void {
  if (editorElement) {
    editorElement.style.setProperty('--image-caption-prefix', `'${settings.imageCaptionPrefix}'`);
    editorElement.style.setProperty('--table-caption-prefix', `'${settings.tableCaptionPrefix}'`);
    editorElement.style.setProperty('--caption-separator', `'${settings.captionSeparator}'`);
    if (editorElement.dataset) editorElement.dataset.tableNumberStyle = settings.tableNumberStyle;
    editorElement.style.setProperty('--heading-h1-color', settings.headingH1Color);
    editorElement.style.setProperty('--heading-h2-color', settings.headingH2Color);
    editorElement.style.setProperty('--heading-h3-color', settings.headingH3Color);
    editorElement.style.setProperty('--font-weight-body', String(settings.fontWeightBody));
    editorElement.style.setProperty('--font-weight-bold', String(settings.fontWeightBold));
    editorElement.style.setProperty('--font-weight-h1', String(settings.fontWeightH1));
    editorElement.style.setProperty('--font-weight-h2', String(settings.fontWeightH2));
    editorElement.style.setProperty('--font-weight-h3', String(settings.fontWeightH3));
  }
  rootElement.style.setProperty('--font-weight-h1', String(settings.fontWeightH1));
}
