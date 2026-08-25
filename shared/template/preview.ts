import { convertJsonToHtmlFragment } from '../converter/jsonToHtml';
import { escapeStyleElementText } from '../converter/htmlSafety';
import { walkDocument } from '../document/walker';
import type { TiptapNode } from '../types';
import type {
  SdocTemplate,
  TemplateOutlinePreviewItem,
  TemplateStructuralCounts,
  TemplateStructuralPreview,
} from './types';
import { findUnsupportedTemplateAsset } from './validation';

export const TEMPLATE_PREVIEW_MAX_OUTLINE_ITEMS = 100;
export const TEMPLATE_PREVIEW_MAX_TEXT_LENGTH = 160;
export const TEMPLATE_PREVIEW_MAX_HTML_LENGTH = 24_000;

const TEMPLATE_HTML_PREVIEW_STYLES = escapeStyleElementText(`
body { margin: 12px; font: 15px/1.5 system-ui, sans-serif; color: #222; background: #fff; }
h1, h2, h3, h4, h5, h6 { margin: 0.9em 0 0.35em; line-height: 1.25; }
p { margin: 0.5em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
blockquote { margin: 0.75em 0; padding: 0.4em 0.8em; border-left: 4px solid #888; }
.callout { margin: 0.75em 0; padding: 0.6em 0.8em; border-left: 4px solid #64748b; background: #f8fafc; }
pre, code { font-family: ui-monospace, monospace; }
pre { overflow: auto; padding: 8px; background: #f4f4f4; }
`);

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

  const settingsKeys = Object.keys(template.envelope.meta.settings ?? {}).sort();
  const fragment = convertJsonToHtmlFragment(
    template.envelope.doc,
    template.envelope.meta.settings,
    { title: template.envelope.meta.title },
  );
  const htmlTruncated = fragment.length > TEMPLATE_PREVIEW_MAX_HTML_LENGTH;
  if (htmlTruncated) truncated = true;
  const cut = fragment.lastIndexOf('>', TEMPLATE_PREVIEW_MAX_HTML_LENGTH);
  const clipped = htmlTruncated
    ? fragment.slice(0, cut > 0 ? cut + 1 : TEMPLATE_PREVIEW_MAX_HTML_LENGTH)
    : fragment;
  const htmlPreview = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${TEMPLATE_HTML_PREVIEW_STYLES}</style></head><body>${clipped}</body></html>`;

  return {
    templateId: template.descriptor.id,
    outline,
    counts,
    settingsKeys,
    truncated,
    htmlPreview,
    replacement: {
      replacesBody: true,
      settingsKeys,
      assets: findUnsupportedTemplateAsset(template.envelope) ? 'unsupported' : 'none',
    },
  };
}
