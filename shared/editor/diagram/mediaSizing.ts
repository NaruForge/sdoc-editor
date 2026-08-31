export interface DiagramMediaSize {
  width: number;
  height: number;
}

export interface NormalizedDiagramSvg extends Partial<DiagramMediaSize> {
  markup: string;
}

interface SvgAttributeMatch {
  fullMatch: string;
  prefix: string;
  quote: string;
  value: string;
  index: number;
}

function readSvgAttribute(openingTag: string, name: string): SvgAttributeMatch | undefined {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(["'])(.*?)\\2`, 'i');
  const match = pattern.exec(openingTag);
  if (!match || match.index === undefined) return undefined;
  return {
    fullMatch: match[0],
    prefix: match[1],
    quote: match[2],
    value: match[3],
    index: match.index,
  };
}

function parseSvgLength(value: string): number | undefined {
  if (!/^\+?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?(?:px)?$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readSvgViewBoxSize(openingTag: string): DiagramMediaSize | undefined {
  const attribute = readSvgAttribute(openingTag, 'viewBox');
  if (!attribute) return undefined;
  const values = attribute.value.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return undefined;
  return resolveDiagramMediaSize(values[2], values[3]);
}

function replaceSvgDimension(
  openingTag: string,
  name: 'width' | 'height',
  value: number,
): string {
  const attribute = readSvgAttribute(openingTag, name);
  if (attribute) {
    const replacement = `${attribute.prefix}${attribute.quote}${value}${attribute.quote}`;
    return openingTag.slice(0, attribute.index)
      + replacement
      + openingTag.slice(attribute.index + attribute.fullMatch.length);
  }
  const closingOffset = openingTag.endsWith('/>') ? 2 : 1;
  const insertion = openingTag.length - closingOffset;
  return `${openingTag.slice(0, insertion)} ${name}="${value}"${openingTag.slice(insertion)}`;
}

export function resolveDiagramMediaSize(
  width: number | undefined,
  height: number | undefined,
): DiagramMediaSize | undefined {
  if (width === undefined || height === undefined
    || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/**
 * Mermaid emits responsive SVG roots with `width="100%"`. That is useful on a
 * standalone page, but it upscales narrow or tall diagrams to the full editor
 * width. Preserve the renderer's viewBox as the intrinsic canvas instead; CSS
 * can then shrink oversized results without enlarging smaller ones.
 */
export function normalizeDiagramSvgSize(markup: string): NormalizedDiagramSvg {
  const openingMatch = /<svg\b[^>]*>/i.exec(markup);
  if (!openingMatch || openingMatch.index === undefined) return { markup };

  const openingTag = openingMatch[0];
  const viewBoxSize = readSvgViewBoxSize(openingTag);
  const width = parseSvgLength(readSvgAttribute(openingTag, 'width')?.value ?? '');
  const height = parseSvgLength(readSvgAttribute(openingTag, 'height')?.value ?? '');
  const size = viewBoxSize ?? resolveDiagramMediaSize(width, height);
  if (!size) return { markup };

  const normalizedOpening = replaceSvgDimension(
    replaceSvgDimension(openingTag, 'width', size.width),
    'height',
    size.height,
  );
  return {
    markup: markup.slice(0, openingMatch.index)
      + normalizedOpening
      + markup.slice(openingMatch.index + openingTag.length),
    ...size,
  };
}
