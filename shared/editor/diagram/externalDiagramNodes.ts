import type { TiptapNode } from '../../types';
import { getKnownDiagramLanguage, type KnownDiagramLanguage } from './languages';

export type ExternalDiagramLanguage = Exclude<KnownDiagramLanguage, 'mermaid'>;

const isExternalDiagramLanguage = (
  value: KnownDiagramLanguage | undefined,
): value is ExternalDiagramLanguage => value !== undefined && value !== 'mermaid';

/** Returns supported external diagram languages in first-document-occurrence order. */
export function getExternalDiagramLanguages(root: TiptapNode): ExternalDiagramLanguage[] {
  const found = new Set<ExternalDiagramLanguage>();
  const pending: TiptapNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node.type === 'diagram') {
      const language = getKnownDiagramLanguage(node.attrs?.language);
      if (isExternalDiagramLanguage(language)) found.add(language);
    }
    if (node.content) {
      for (let index = node.content.length - 1; index >= 0; index -= 1) {
        pending.push(node.content[index]);
      }
    }
  }
  return [...found];
}

export function hasExternalDiagramNodes(root: TiptapNode): boolean {
  return getExternalDiagramLanguages(root).length > 0;
}
