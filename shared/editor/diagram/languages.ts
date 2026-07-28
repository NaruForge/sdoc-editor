export const KNOWN_DIAGRAM_LANGUAGES = [
  'mermaid',
  'plantuml',
  'd2',
  'graphviz',
] as const;

export type KnownDiagramLanguage = (typeof KNOWN_DIAGRAM_LANGUAGES)[number];

export const DEFAULT_DIAGRAM_LANGUAGE: KnownDiagramLanguage = 'mermaid';

export function getKnownDiagramLanguage(value: unknown): KnownDiagramLanguage | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return KNOWN_DIAGRAM_LANGUAGES.find((language) => language === normalized);
}

/**
 * Canonicalizes known language names while keeping unrecognized persisted
 * values intact so documents never lose a future or third-party language.
 */
export function resolveDiagramLanguage(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return DEFAULT_DIAGRAM_LANGUAGE;
  }
  return getKnownDiagramLanguage(value) ?? value;
}
