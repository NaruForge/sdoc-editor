import { walkDocument } from '../document/walker';
import type { TiptapNode } from '../types';
import type {
  SdocTemplate,
  TemplateOutlinePreviewItem,
  TemplateStructuralCounts,
  TemplateStructuralPreview,
} from './types';

export const TEMPLATE_PREVIEW_MAX_OUTLINE_ITEMS = 100;
export const TEMPLATE_PREVIEW_MAX_TEXT_LENGTH = 160;

const nodeText = (node: TiptapNode): string => {
  const fragments: string[] = [];
  const collect = (current: TiptapNode): void => {
    if (typeof current.text === 'string') fragments.push(current.text);
    current.content?.forEach(collect);
  };
  collect(node);
  return fragments.join('').replace(/\s+/g, ' ').trim();
};

const emptyCounts = (): TemplateStructuralCounts => ({
  headings: 0,
  paragraphs: 0,
  tables: 0,
  figures: 0,
  equations: 0,
  diagrams: 0,
  codeBlocks: 0,
});

export function buildTemplateStructuralPreview(
  template: SdocTemplate,
): TemplateStructuralPreview {
  const outline: TemplateOutlinePreviewItem[] = [];
  const counts = emptyCounts();
  let truncated = false;

  for (const { node } of walkDocument(template.envelope.doc)) {
    switch (node.type) {
      case 'heading': {
        counts.headings += 1;
        const rawText = nodeText(node);
        if (rawText.length > TEMPLATE_PREVIEW_MAX_TEXT_LENGTH) truncated = true;
        if (outline.length >= TEMPLATE_PREVIEW_MAX_OUTLINE_ITEMS) {
          truncated = true;
          break;
        }
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : undefined;
        const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
        outline.push({
          ...(id === undefined ? {} : { id }),
          level,
          text: rawText.slice(0, TEMPLATE_PREVIEW_MAX_TEXT_LENGTH),
          numbered: node.attrs?.numbered !== false,
          isTitle: id !== undefined && id === template.descriptor.titleNodeId,
        });
        break;
      }
      case 'paragraph':
        counts.paragraphs += 1;
        break;
      case 'table':
        counts.tables += 1;
        break;
      case 'image':
        counts.figures += 1;
        break;
      case 'mathBlock':
        counts.equations += 1;
        break;
      case 'diagram':
        counts.diagrams += 1;
        break;
      case 'codeBlock':
        counts.codeBlocks += 1;
        break;
      default:
        break;
    }
  }

  return {
    templateId: template.descriptor.id,
    outline,
    counts,
    settingsKeys: Object.keys(template.envelope.meta.settings ?? {}).sort(),
    truncated,
  };
}
