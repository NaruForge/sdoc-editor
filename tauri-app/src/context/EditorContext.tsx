import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { JSONContent } from '@tiptap/react';

export interface EditorSettings {
  imageCaptionPrefix: string;
  tableCaptionPrefix: string;
  captionNumbering: 'simple' | 'hierarchical';
  headingNumbering: boolean;
  headingDecoration: boolean;
  headingH1Color: string;
  headingH2Color: string;
  headingH3Color: string;
  defaultImageAlignment: 'left' | 'center' | 'right';
  exportImagePath: 'relative' | 'absolute';
}

export const defaultSettings: EditorSettings = {
  imageCaptionPrefix: 'Image',
  tableCaptionPrefix: 'Table',
  captionNumbering: 'simple',
  headingNumbering: true,
  headingDecoration: true,
  headingH1Color: '#A50034',
  headingH2Color: '#A50034',
  headingH3Color: '#A50034',
  defaultImageAlignment: 'center',
  exportImagePath: 'relative',
};

interface EditorState {
  doc: JSONContent | null;
  isReady: boolean;
  settings: EditorSettings;
}

type EditorAction =
  | { type: 'SET_DOC'; payload: JSONContent }
  | { type: 'SET_READY'; payload: boolean }
  | { type: 'SET_SETTINGS'; payload: Partial<EditorSettings> };

const initialState: EditorState = {
  doc: null,
  isReady: false,
  settings: defaultSettings,
};

const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
  switch (action.type) {
    case 'SET_DOC':
      return { ...state, doc: action.payload };
    case 'SET_READY':
      return { ...state, isReady: action.payload };
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
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
