import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  createEditorTranslator,
  formatEditorDate,
  type EditorLocale,
  type EditorTranslator,
} from './locale';

export interface EditorI18nContextValue {
  locale: EditorLocale;
  t: EditorTranslator;
  formatDate(value: string | number | Date | null | undefined): string;
}

const EditorI18nContext = createContext<EditorI18nContextValue | undefined>(undefined);

export const EditorI18nProvider: React.FC<{
  locale: EditorLocale;
  children: ReactNode;
}> = ({ locale, children }) => {
  useEffect(() => {
    document.documentElement.lang = locale === 'ko' ? 'ko-KR' : 'en';
  }, [locale]);

  const value = useMemo<EditorI18nContextValue>(() => ({
    locale,
    t: createEditorTranslator(locale),
    formatDate: (dateValue) => formatEditorDate(dateValue, locale),
  }), [locale]);

  return (
    <EditorI18nContext.Provider value={value}>
      {children}
    </EditorI18nContext.Provider>
  );
};

export function useEditorI18n(): EditorI18nContextValue {
  const context = useContext(EditorI18nContext);
  if (!context) {
    throw new Error('useEditorI18n must be used within EditorI18nProvider');
  }
  return context;
}
