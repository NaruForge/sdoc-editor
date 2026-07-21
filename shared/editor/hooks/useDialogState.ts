import { useReducer, useCallback } from 'react';

export interface ImagePropertiesState {
  pos: number;
  src: string;
  alt: string;
  align: string;
  isDrawio: boolean;
  path?: string;
}

export interface ImageContextMenuState {
  x: number;
  y: number;
  pos: number;
  src: string;
  isDrawio: boolean;
}

export interface MathDialogState {
  latex: string;
  isBlock: boolean;
  pos: number | null;
}

export interface DiagramDialogState {
  code: string;
  language: string;
  pos: number | null;
}

export interface PendingImageState {
  blob: Blob;
  dataUrl: string;
}

interface DialogState {
  contextMenu: { x: number; y: number } | null;
  editorContextMenu: { x: number; y: number } | null;
  showTableProperties: boolean;
  pendingImage: PendingImageState | null;
  showDrawioActionDialog: boolean;
  showDrawioDialog: boolean;
  showLinkDialog: boolean;
  imageProperties: ImagePropertiesState | null;
  imageContextMenu: ImageContextMenuState | null;
  mathDialog: MathDialogState | null;
  showCrossRefDialog: boolean;
  diagramDialog: DiagramDialogState | null;
}

type DialogAction =
  | { type: 'OPEN_TABLE_CONTEXT_MENU'; payload: { x: number; y: number } }
  | { type: 'CLOSE_TABLE_CONTEXT_MENU' }
  | { type: 'OPEN_EDITOR_CONTEXT_MENU'; payload: { x: number; y: number } }
  | { type: 'CLOSE_EDITOR_CONTEXT_MENU' }
  | { type: 'OPEN_TABLE_PROPERTIES' }
  | { type: 'CLOSE_TABLE_PROPERTIES' }
  | { type: 'SET_PENDING_IMAGE'; payload: PendingImageState | null }
  | { type: 'OPEN_DRAWIO_ACTION_DIALOG' }
  | { type: 'CLOSE_DRAWIO_ACTION_DIALOG' }
  | { type: 'OPEN_DRAWIO_DIALOG' }
  | { type: 'CLOSE_DRAWIO_DIALOG' }
  | { type: 'OPEN_LINK_DIALOG' }
  | { type: 'CLOSE_LINK_DIALOG' }
  | { type: 'SET_IMAGE_PROPERTIES'; payload: ImagePropertiesState | null }
  | { type: 'SET_IMAGE_CONTEXT_MENU'; payload: ImageContextMenuState | null }
  | { type: 'SET_MATH_DIALOG'; payload: MathDialogState | null }
  | { type: 'OPEN_CROSSREF_DIALOG' }
  | { type: 'CLOSE_CROSSREF_DIALOG' }
  | { type: 'SET_DIAGRAM_DIALOG'; payload: DiagramDialogState | null };

const initialState: DialogState = {
  contextMenu: null,
  editorContextMenu: null,
  showTableProperties: false,
  pendingImage: null,
  showDrawioActionDialog: false,
  showDrawioDialog: false,
  showLinkDialog: false,
  imageProperties: null,
  imageContextMenu: null,
  mathDialog: null,
  showCrossRefDialog: false,
  diagramDialog: null,
};

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'OPEN_TABLE_CONTEXT_MENU':
      return { ...state, contextMenu: action.payload };
    case 'CLOSE_TABLE_CONTEXT_MENU':
      return { ...state, contextMenu: null };
    case 'OPEN_EDITOR_CONTEXT_MENU':
      return { ...state, editorContextMenu: action.payload };
    case 'CLOSE_EDITOR_CONTEXT_MENU':
      return { ...state, editorContextMenu: null };
    case 'OPEN_TABLE_PROPERTIES':
      return { ...state, showTableProperties: true };
    case 'CLOSE_TABLE_PROPERTIES':
      return { ...state, showTableProperties: false };
    case 'SET_PENDING_IMAGE':
      return { ...state, pendingImage: action.payload };
    case 'OPEN_DRAWIO_ACTION_DIALOG':
      return { ...state, showDrawioActionDialog: true };
    case 'CLOSE_DRAWIO_ACTION_DIALOG':
      return { ...state, showDrawioActionDialog: false };
    case 'OPEN_DRAWIO_DIALOG':
      return { ...state, showDrawioActionDialog: false, showDrawioDialog: true };
    case 'CLOSE_DRAWIO_DIALOG':
      return { ...state, showDrawioDialog: false };
    case 'OPEN_LINK_DIALOG':
      return { ...state, showLinkDialog: true };
    case 'CLOSE_LINK_DIALOG':
      return { ...state, showLinkDialog: false };
    case 'SET_IMAGE_PROPERTIES':
      return { ...state, imageProperties: action.payload };
    case 'SET_IMAGE_CONTEXT_MENU':
      return { ...state, imageContextMenu: action.payload };
    case 'SET_MATH_DIALOG':
      return { ...state, mathDialog: action.payload };
    case 'OPEN_CROSSREF_DIALOG':
      return { ...state, showCrossRefDialog: true };
    case 'CLOSE_CROSSREF_DIALOG':
      return { ...state, showCrossRefDialog: false };
    case 'SET_DIAGRAM_DIALOG':
      return { ...state, diagramDialog: action.payload };
    default:
      return state;
  }
}

export function useDialogState() {
  const [dialogs, dialogDispatch] = useReducer(dialogReducer, initialState);

  const openTableContextMenu = useCallback((x: number, y: number) => {
    dialogDispatch({ type: 'OPEN_TABLE_CONTEXT_MENU', payload: { x, y } });
  }, []);

  const openEditorContextMenu = useCallback((x: number, y: number) => {
    dialogDispatch({ type: 'OPEN_EDITOR_CONTEXT_MENU', payload: { x, y } });
  }, []);

  return { dialogs, dialogDispatch, openTableContextMenu, openEditorContextMenu };
}
