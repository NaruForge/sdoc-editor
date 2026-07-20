import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { JSONContent } from '@tiptap/react';
import type { DocumentSettings, ResolvedEditorSettings } from '@shared/types';
import { EDITOR_SETTINGS_DEFAULTS } from '@shared/settingsResolver';

export type EditorSettings = ResolvedEditorSettings;

export const defaultSettings: EditorSettings = EDITOR_SETTINGS_DEFAULTS;

interface EditorState {
  doc: JSONContent | null;
  isReady: boolean;
  settings: EditorSettings;
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
