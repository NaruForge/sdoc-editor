/**
 * Type declarations for window globals used by vanilla DOM NodeViews.
 * These globals bridge vanilla DOM NodeViews ↔ React component communication.
 */

import type { EditorSettings } from '../context/EditorContext';

interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    /** VS Code webview API — set by useVSCodeMessaging hook */
    acquireVsCodeApi(): VSCodeAPI;

    /** VS Code API instance exposed for non-React NodeViews */
    vscode?: VSCodeAPI;

    /** Editor settings exposed for vanilla DOM NodeViews (CustomImage, CustomTable) */
    __editorSettings?: EditorSettings;

    /** Forces immediate document save (bypasses debounce) */
    __editorFlushUpdate?: () => void;

    /** Opens image properties dialog from NodeView context */
    __showImageProperties?: (pos: number, src: string, alt: string) => void;

    /** Shows custom context menu for images */
    __showImageContextMenu?: (x: number, y: number, pos: number, src: string, alt: string) => void;

    /** Opens math equation editor dialog */
    __showMathDialog?: (latex: string, isBlock: boolean, pos: number) => void;

    /** Opens diagram editor dialog */
    __showDiagramDialog?: (code: string, language: string, pos: number) => void;
  }
}

export {};
