import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { JSONContent } from '@tiptap/react';
import type { DocumentSettings, CaptionStyleName } from '@shared/types';

export interface EditorSettings {
  captionStyle: CaptionStyleName;
  imageCaptionPrefix: string;
  tableCaptionPrefix: string;
  equationCaptionPrefix: string;
  captionSeparator: string;
  tableNumberStyle: 'arabic' | 'roman';
  equationParens: boolean;
  captionNumbering: 'sequential' | 'hierarchical';
  equationNumbering: 'sequential' | 'hierarchical';
  crossRefIncludeCaption: boolean;
  headingNumbering: boolean;
  headingDecoration: boolean;
  headingH1Color: string;
  headingH2Color: string;
  headingH3Color: string;
  defaultImageAlignment: 'left' | 'center' | 'right';
  exportImagePath: 'relative' | 'absolute';
  fontWeightBody: number;
  fontWeightBold: number;
  fontWeightH1: number;
  fontWeightH2: number;
  fontWeightH3: number;
}

const FONT_WEIGHT_MAP: Record<string, number> = {
  Light: 300,
  Regular: 400,
  SemiBold: 600,
  Bold: 700,
};

export function resolveFontWeight(name: string): number {
  return FONT_WEIGHT_MAP[name] || 400;
}

export const defaultSettings: EditorSettings = {
  captionStyle: 'modern',
  imageCaptionPrefix: 'Figure ',
  tableCaptionPrefix: 'Table ',
  equationCaptionPrefix: 'Equation ',
  captionSeparator: ': ',
  tableNumberStyle: 'arabic',
  equationParens: false,
  captionNumbering: 'sequential',
  equationNumbering: 'sequential',
  crossRefIncludeCaption: false,
  headingNumbering: true,
  headingDecoration: true,
  headingH1Color: '#A50034',
  headingH2Color: '#A50034',
  headingH3Color: '#A50034',
  defaultImageAlignment: 'center',
  exportImagePath: 'relative',
  fontWeightBody: 400,
  fontWeightBold: 700,
  fontWeightH1: 700,
  fontWeightH2: 600,
  fontWeightH3: 600,
};

interface EditorState {
  doc: JSONContent | null;
  isReady: boolean;
  settings: EditorSettings;
  /** Raw per-document settings (null = no overrides, falls back to VS Code). */
  docSettings: Partial<DocumentSettings> | null;
}

type EditorAction =
  | { type: 'SET_DOC'; payload: JSONContent }
  | { type: 'SET_READY'; payload: boolean }
  | { type: 'SET_SETTINGS'; payload: Partial<EditorSettings> }
  | { type: 'SET_DOC_SETTINGS'; payload: Partial<DocumentSettings> | null };

const initialState: EditorState = {
  doc: null,
  isReady: false,
  settings: defaultSettings,
  docSettings: null,
};

const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
  switch (action.type) {
    case 'SET_DOC':
      return { ...state, doc: action.payload };
    case 'SET_READY':
      return { ...state, isReady: action.payload };
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'SET_DOC_SETTINGS':
      return { ...state, docSettings: action.payload };
    default:
      return state;
  }
};

interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | undefined>(undefined);

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(editorReducer, initialState);

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      {children}
    </EditorContext.Provider>
  );
};

export const useEditorContext = () => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditorContext must be used within EditorProvider');
  }
  return context;
};
