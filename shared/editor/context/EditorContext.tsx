import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  ReactNode,
} from 'react';
import { JSONContent } from '@tiptap/react';
import type {
  DocumentSettings,
  ResolvedDocumentSettingsSnapshot,
  ResolvedEditorSettings,
  TemporaryDocumentViewPreferences,
} from '@shared/types';
import type { ContractDiagnostic } from '@shared/document/documentContract';
import type { InvalidDocumentReason } from '@shared/types/messages';
import {
  EDITOR_SETTINGS_DEFAULTS,
  resolveDocumentSettingsSnapshot,
  resolveEditorSettings,
} from '@shared/settingsResolver';
import {
  createDefaultViewPreferences,
  type SettingsSyncState,
} from '../designSettings';
import { EditorI18nProvider } from '../i18n/EditorI18nContext';
import {
  resolveEditorLocale,
  resolveUiLanguagePreference,
  type EditorLocale,
  type UiLanguagePreference,
} from '../i18n/locale';

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

export interface EditorCapabilities {
  editContent: boolean;
  editMetadata: boolean;
  editDocumentSettings: boolean;
  replaceDocument: boolean;
  manageAssets: boolean;
  exportDocument: boolean;
  inspectSource: boolean;
}

export type EditorDocumentAccess =
  | { status: 'loading'; capabilities: EditorCapabilities }
  | { status: 'editable'; capabilities: EditorCapabilities }
  | {
      status: 'invalid-initial' | 'invalid-external';
      capabilities: EditorCapabilities;
      reason: InvalidDocumentReason;
      diagnostics: ContractDiagnostic[];
      canRecoverFromLocal: boolean;
    };

const VIEW_ONLY_CAPABILITIES: EditorCapabilities = {
  editContent: false,
  editMetadata: false,
  editDocumentSettings: false,
  replaceDocument: false,
  manageAssets: false,
  exportDocument: false,
  inspectSource: true,
};

export const EDITABLE_CAPABILITIES: EditorCapabilities = {
  editContent: true,
  editMetadata: true,
  editDocumentSettings: true,
  replaceDocument: true,
  manageAssets: true,
  exportDocument: true,
  inspectSource: true,
};

export interface EditorState {
  doc: JSONContent | null;
  isReady: boolean;
  locale: EditorLocale;
  uiLanguagePreference: UiLanguagePreference;
  settings: EditorSettings;
  /** Raw per-document settings (null = no overrides, falls back to VS Code). */
  docSettings: Partial<DocumentSettings> | null;
  /** Portable values plus their source/scope metadata and session view overlay. */
  settingsSnapshot: ResolvedDocumentSettingsSnapshot;
  /** Screen-only preferences; never copied to `docSettings`. */
  viewPreferences: Required<TemporaryDocumentViewPreferences>;
  settingsSyncState?: SettingsSyncState;
  documentAccess: EditorDocumentAccess;
}

export type EditorAction =
  | { type: 'SET_DOC'; payload: JSONContent }
  | { type: 'SET_READY'; payload: boolean }
  | { type: 'SET_LOCALE'; payload: EditorLocale }
  | {
      type: 'SET_UI_LANGUAGE';
      payload: { preference: UiLanguagePreference; detectedLanguage: unknown };
    }
  | { type: 'SET_SETTINGS'; payload: Partial<EditorSettings> }
  | { type: 'SET_DOC_SETTINGS'; payload: Partial<DocumentSettings> | null }
  | {
      type: 'SET_VIEW_PREFERENCES';
      payload: Required<TemporaryDocumentViewPreferences>;
    }
  | { type: 'SET_SETTINGS_SYNC_STATE'; payload: SettingsSyncState | undefined }
  | { type: 'SET_DOCUMENT_ACCESS'; payload: EditorDocumentAccess };

const resolvePortableEditorState = (
  docSettings: Partial<DocumentSettings> | null,
  viewPreferences: Required<TemporaryDocumentViewPreferences>,
  currentSettings: EditorSettings,
  hostPatch?: Partial<EditorSettings>,
): Pick<EditorState, 'settings' | 'settingsSnapshot'> => {
  const settingsSnapshot = resolveDocumentSettingsSnapshot({
    context: 'editor',
    documentSettings: docSettings ?? undefined,
    temporaryView: viewPreferences,
  });
  const portable = resolveEditorSettings(settingsSnapshot.values);
  return {
    settingsSnapshot,
    settings: {
      ...portable,
      defaultImageAlignment: hostPatch?.defaultImageAlignment
        ?? currentSettings.defaultImageAlignment,
      exportImagePath: hostPatch?.exportImagePath ?? currentSettings.exportImagePath,
      fontWeightBody: hostPatch?.fontWeightBody ?? currentSettings.fontWeightBody,
      fontWeightBold: hostPatch?.fontWeightBold ?? currentSettings.fontWeightBold,
      fontWeightH1: hostPatch?.fontWeightH1 ?? currentSettings.fontWeightH1,
      fontWeightH2: hostPatch?.fontWeightH2 ?? currentSettings.fontWeightH2,
      fontWeightH3: hostPatch?.fontWeightH3 ?? currentSettings.fontWeightH3,
    },
  };
};

export const createInitialEditorState = (locale: EditorLocale): EditorState => {
  const viewPreferences = createDefaultViewPreferences();
  const portable = resolvePortableEditorState(null, viewPreferences, defaultSettings);
  return {
    doc: null,
    isReady: false,
    locale,
    uiLanguagePreference: 'auto',
    ...portable,
    docSettings: null,
    viewPreferences,
    documentAccess: { status: 'loading', capabilities: { ...VIEW_ONLY_CAPABILITIES, inspectSource: false } },
  };
};

export const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
  switch (action.type) {
    case 'SET_DOC':
      return { ...state, doc: action.payload };
    case 'SET_READY':
      return { ...state, isReady: action.payload };
    case 'SET_LOCALE':
      return { ...state, locale: action.payload };
    case 'SET_UI_LANGUAGE':
      return {
        ...state,
        locale: resolveUiLanguagePreference(
          action.payload.preference,
          action.payload.detectedLanguage,
        ),
        uiLanguagePreference: action.payload.preference,
      };
    case 'SET_SETTINGS': {
      const portable = resolvePortableEditorState(
        state.docSettings,
        state.viewPreferences,
        state.settings,
        action.payload,
      );
      return { ...state, ...portable };
    }
    case 'SET_DOC_SETTINGS': {
      const portable = resolvePortableEditorState(
        action.payload,
        state.viewPreferences,
        state.settings,
      );
      return { ...state, ...portable, docSettings: action.payload };
    }
    case 'SET_VIEW_PREFERENCES': {
      const portable = resolvePortableEditorState(
        state.docSettings,
        action.payload,
        state.settings,
      );
      return { ...state, ...portable, viewPreferences: action.payload };
    }
    case 'SET_SETTINGS_SYNC_STATE':
      return { ...state, settingsSyncState: action.payload };
    case 'SET_DOCUMENT_ACCESS':
      return { ...state, documentAccess: action.payload };
    default:
      return state;
  }
};

interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  retrySettingsSync: () => void;
  registerSettingsSyncRetry: (handler?: () => void) => void;
}

const EditorContext = createContext<EditorContextValue | undefined>(undefined);

export const EditorProvider: React.FC<{
  children: ReactNode;
  initialLocale?: string;
}> = ({ children, initialLocale = 'en' }) => {
  const [state, dispatch] = useReducer(
    editorReducer,
    resolveEditorLocale(initialLocale),
    createInitialEditorState,
  );
  const retrySettingsSyncRef = useRef<(() => void) | undefined>(undefined);
  const retrySettingsSync = useCallback(() => retrySettingsSyncRef.current?.(), []);
  const registerSettingsSyncRetry = useCallback((handler?: () => void) => {
    retrySettingsSyncRef.current = handler;
  }, []);
  const contextValue = useMemo<EditorContextValue>(() => ({
    state,
    dispatch,
    retrySettingsSync,
    registerSettingsSyncRetry,
  }), [dispatch, registerSettingsSyncRetry, retrySettingsSync, state]);

  return (
    <EditorContext.Provider value={contextValue}>
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
