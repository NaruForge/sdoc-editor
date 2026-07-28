import {
  EN_EDITOR_MESSAGES,
  KO_EDITOR_MESSAGES,
  type EditorMessageCatalog,
  type EditorTranslationKey,
} from './catalogs';

export type EditorLocale = 'en' | 'ko';
export type EditorTranslationParams = Readonly<Record<string, string | number>>;
export type EditorTranslator = (
  key: EditorTranslationKey,
  params?: EditorTranslationParams,
) => string;

const CATALOGS: Readonly<Record<EditorLocale, EditorMessageCatalog>> = {
  en: EN_EDITOR_MESSAGES,
  ko: KO_EDITOR_MESSAGES,
};

export function resolveEditorLocale(value: unknown): EditorLocale {
  if (typeof value !== 'string') return 'en';
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return language === 'ko' ? 'ko' : 'en';
}

function interpolate(message: string, params?: EditorTranslationParams): string {
  if (!params) return message;
  return message.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (placeholder, name: string) => {
    const replacement = params[name];
    return replacement === undefined ? placeholder : String(replacement);
  });
}

export function createEditorTranslator(locale: EditorLocale): EditorTranslator {
  const catalog = CATALOGS[locale] ?? EN_EDITOR_MESSAGES;
  return (key, params) => {
    const message = catalog[key] ?? EN_EDITOR_MESSAGES[key] ?? key;
    return interpolate(message, params);
  };
}

export function formatEditorDate(
  value: string | number | Date | null | undefined,
  locale: EditorLocale,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const DEFAULT_EDITOR_TRANSLATOR = createEditorTranslator('en');
