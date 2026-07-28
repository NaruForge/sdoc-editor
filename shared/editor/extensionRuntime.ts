import type { ResolvedEditorSettings } from '../types';
import { EDITOR_SETTINGS_DEFAULTS } from '../settingsResolver';
import {
  DEFAULT_EDITOR_TRANSLATOR,
  type EditorTranslator,
} from './i18n/locale';
import {
  NOOP_HOST_DIAGRAM_RENDERER,
  type HostDiagramRenderer,
} from './diagram/editorRenderer';

export interface EditorExtensionRuntime {
  getSettings(): ResolvedEditorSettings;
  translate: EditorTranslator;
  flush(): void;
  openDocument(path: string, anchor?: string): void;
  openDrawio(path: string): void;
  openImageContextMenu(x: number, y: number, pos: number, src: string, alt: string): void;
  openMathDialog(latex: string, isBlock: boolean, pos: number): void;
  openDiagramDialog(code: string, language: string, pos: number): void;
  renderDiagram?: HostDiagramRenderer;
}

export interface EditorExtensionOptions {
  runtime: EditorExtensionRuntime;
}

export const NOOP_EDITOR_EXTENSION_RUNTIME: EditorExtensionRuntime = {
  getSettings: () => EDITOR_SETTINGS_DEFAULTS,
  translate: DEFAULT_EDITOR_TRANSLATOR,
  flush: () => {},
  openDocument: () => {},
  openDrawio: () => {},
  openImageContextMenu: () => {},
  openMathDialog: () => {},
  openDiagramDialog: () => {},
  renderDiagram: NOOP_HOST_DIAGRAM_RENDERER,
};
