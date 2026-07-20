import type { ResolvedEditorSettings } from '../types';
import { EDITOR_SETTINGS_DEFAULTS } from '../settingsResolver';

export interface EditorExtensionRuntime {
  getSettings(): ResolvedEditorSettings;
  flush(): void;
  openDocument(path: string, anchor?: string): void;
  openDrawio(path: string): void;
  openImageContextMenu(x: number, y: number, pos: number, src: string, alt: string): void;
  openMathDialog(latex: string, isBlock: boolean, pos: number): void;
  openDiagramDialog(code: string, language: string, pos: number): void;
}

export interface EditorExtensionOptions {
  runtime: EditorExtensionRuntime;
}

export const NOOP_EDITOR_EXTENSION_RUNTIME: EditorExtensionRuntime = {
  getSettings: () => EDITOR_SETTINGS_DEFAULTS,
  flush: () => {},
  openDocument: () => {},
  openDrawio: () => {},
  openImageContextMenu: () => {},
  openMathDialog: () => {},
  openDiagramDialog: () => {},
};
