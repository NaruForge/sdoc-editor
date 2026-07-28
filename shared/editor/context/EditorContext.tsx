import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { JSONContent } from '@tiptap/react';
import type { DocumentSettings, ResolvedEditorSettings } from '@shared/types';
import { EDITOR_SETTINGS_DEFAULTS } from '@shared/settingsResolver';
import { EditorI18nProvider } from '../i18n/EditorI18nContext';
import { resolveEditorLocale, type EditorLocale } from '../i18n/locale';

export interface EditorSettings extends ResolvedEditorSettings {
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
  ...EDITOR_SETTINGS_DEFAULTS,
  fontWeightBody: 400,
  fontWeightBold: 700,
  fontWeightH1: 700,
  fontWeightH2: 600,
  fontWeightH3: 600,
};

interface EditorState {
  doc: JSONContent | null;
  isReady: boolean;
  locale: EditorLocale;
  settings: EditorSettings;
  /** Raw per-document settings (null = no overrides, falls back to VS Code). */
  docSettings: Partial<DocumentSettings> | null;
}

type EditorAction =
  | { type: 'SET_DOC'; payload: JSONContent }
  | { type: 'SET_READY'; payload: boolean }
  | { type: 'SET_LOCALE'; payload: EditorLocale }
  | { type: 'SET_SETTINGS'; payload: Partial<EditorSettings> }
  | { type: 'SET_DOC_SETTINGS'; payload: Partial<DocumentSettings> | null };

const createInitialState = (locale: EditorLocale): EditorState => ({
  doc: null,
  isReady: false,
  locale,
  settings: defaultSettings,
  docSettings: null,
});

const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
  switch (action.type) {
    case 'SET_DOC':
      return { ...state, doc: action.payload };
    case 'SET_READY':
      return { ...state, isReady: action.payload };
    case 'SET_LOCALE':
      return { ...state, locale: action.payload };
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

export const EditorProvider: React.FC<{
  children: ReactNode;
  initialLocale?: string;
}> = ({ children, initialLocale = 'en' }) => {
  const [state, dispatch] = useReducer(
    editorReducer,
    resolveEditorLocale(initialLocale),
    createInitialState,
  );

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      <EditorI18nProvider locale={state.locale}>
        {children}
      </EditorI18nProvider>
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
