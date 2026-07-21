import type { TiptapNode } from '../types';

export function migrateAttributes(node: TiptapNode): TiptapNode {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (attrs) {
    if ('data-caption' in attrs) {
      attrs.caption = attrs['data-caption'];
      delete attrs['data-caption'];
    }
    if ('data-align' in attrs) {
      attrs.align = attrs['data-align'];
      delete attrs['data-align'];
    }
    if ('data-width' in attrs) {
      attrs.width = attrs['data-width'];
      delete attrs['data-width'];
    }
  }
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(migrateAttributes) } : {}),
  };
}
